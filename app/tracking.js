'use strict';
(() => {
  const { msg, bind } = I18n;
  const el = id => document.getElementById(id), invoke = window.__TAURI__?.core.invoke;
  const aspects = { '16:9': 16 / 9, '21:9': 3440 / 1440 };
  let resolution = '16:9', mini = null;
  try { const value = localStorage.getItem('aniimo-game-resolution-v1'); if (Object.hasOwn(aspects, value)) resolution = value; } catch {}
  try {
    const saved = JSON.parse(localStorage.getItem('aniimo-capture-regions-v1'))?.mini;
    if (Array.isArray(saved) && saved.length === 4 && saved.every(v => Number.isFinite(v) && v >= 0 && v <= 1) && saved[2] > .01 && saved[3] > .01 && saved[0] + saved[2] <= 1.001 && saved[1] + saved[3] <= 1.001 && !saved.every((v, i) => Math.abs(v - [.0427,.0389,.1042,.1852][i]) < 1e-6)) mini = saved;
  } catch {}
  const miniRegion = () => mini || MapScreen.defaultMini(aspects[resolution]);
  let enabled = false, busy = false, capturing = false, worker = null, ready = false, workerBusy = false;
  let pending = null, request = 0, sequence = 0, token = 0, timer = null, activeMap = null, lastGameId = '', lastLocationAt = 0;
  let configuration = Promise.resolve();
  let workerStartedAt=0,workerSentAt=0,lastFrameAt=0,lastPollAt=0,capturePaused=false,recoveringCapture=false;
  let lastDiagnostic=null,diagnosticPath=null,logError=null,logBusy=false,lastLogAt=0;
  const logQueue=[],history=[],restarts={worker:[],capture:[]};
  function record(event,detail={}) {
    const entry={at:Date.now(),event,mapId:activeMap,sequence,...detail};
    history.push(entry);if(history.length>120)history.shift();
    logQueue.push(entry);if(logQueue.length>60)logQueue.shift();
  }
  async function flushLog() {
    if(!invoke||logBusy||!logQueue.length)return;
    logBusy=true;lastLogAt=Date.now();
    const entries=logQueue.splice(0,20);
    try{diagnosticPath=await invoke('append_tracking_log',{entry:{events:entries}});logError=null;}
    catch(error){logError=String(error);}
    finally{logBusy=false;}
  }
  function allowRestart(kind) {
    const now=Date.now();restarts[kind]=restarts[kind].filter(at=>now-at<60000);
    if(restarts[kind].length>=3)return false;
    restarts[kind].push(now);return true;
  }
  function render() {
    bind(el('tracking-button'), msg('switch', { label:msg('tracking'), state:msg(enabled ? 'on' : 'off') }));
    bind(el('tracking-button'), msg(enabled ? 'tracking.disable' : 'tracking.enable'), 'title');
    el('tracking-button').setAttribute('aria-checked', String(enabled));
    el('tracking-button').disabled = busy || window.getGameMode?.() === 'pvp';
    window.dispatchEvent(new Event('tracking-ui'));
  }
  function clearPosition() {
    lastLocationAt = 0;
    window.dispatchEvent(new CustomEvent('tracking-update', { detail:null }));
  }
  function disposeWorker() {
    worker?.terminate(); worker = null; ready = false; workerBusy = false; pending = null; activeMap = null;
    workerStartedAt=0;workerSentAt=0;
  }
  function initializeWorker() {
    if (!enabled || window.getGameMode?.() === 'pvp') return;
    const map = DUNGEON_DATA.maps.find(item => item.id === Number(el('map').value));
    if (!map || worker && activeMap === map.id) return;
    disposeWorker(); clearPosition(); activeMap = map.id;
    const next = worker = new Worker('tracking-worker.js');
    workerStartedAt=Date.now();record('worker-start');
    next.onerror = event => { if (worker === next) fail(event.message); };
    next.onmessage = ({ data }) => {
      if (worker !== next) return;
      if (data.type === 'ready') { ready = true; record('worker-ready',{elapsedMs:Date.now()-workerStartedAt});pump(); return; }
      if (data.type === 'error') { fail(data.message); return; }
      if (data.type !== 'result' || data.request !== request) return;
      workerBusy = false;
      workerSentAt=0;
      lastDiagnostic={...data.diagnostic,request:data.request,frameSequence:data.frameSequence,elapsedMs:data.elapsedMs,capturedAt:data.capturedAt,latencyMs:Date.now()-data.capturedAt,
        local:data.local,match:data.miniScore,method:data.location?.method||null};
      record('result',lastDiagnostic);
      if (data.mapId === Number(el('map').value) && data.location && Date.now() - data.capturedAt < 1500) {
        lastLocationAt = data.capturedAt;
        window.dispatchEvent(new CustomEvent('tracking-update', { detail:{ ...data.location, at:data.capturedAt } }));
      }
      pump();
    };
    next.postMessage({ type:'init', map:{ id:map.id, image:new URL(map.image, location.href).href } });
  }
  function pump() {
    if (!enabled || !ready || workerBusy || !pending) return;
    const frame = pending; pending = null;
    if (Date.now() - frame.capturedAt > 1000) {record('stale-frame',{ageMs:Date.now()-frame.capturedAt});return;}
    workerBusy = true;
    workerSentAt=Date.now();
    worker.postMessage({ type:'track', request:++request, frameSequence:frame.sequence, image:frame.image, capturedAt:frame.capturedAt,
      sourceRegion:frame.sourceRegion, miniRegion:miniRegion(), aspect:aspects[resolution] });
  }
  function syncCapture(restart=false) {
    configuration = configuration.catch(() => {}).then(async () => {
      if (!invoke) return;
      if(restart&&capturing){capturing=false;token++;clearTimeout(timer);await invoke('stop_capture');}
      if (!enabled) {
        if (capturing) { capturing = false; token++; clearTimeout(timer); await invoke('stop_capture'); }
        return;
      }
      const starting = !capturing;
      if (starting) {
        const windows = await invoke('game_windows');
        const selected = windows.find(item => item.id === lastGameId) || windows[0];
        if (!selected) throw msg('game.missing');
        await invoke('start_capture', { windowId:selected.id });
        lastGameId = selected.id; sequence = 0; capturing = true;
        lastFrameAt=Date.now();lastPollAt=lastFrameAt;capturePaused=false;record('capture-start');
      }
      await invoke('configure_capture', { fast:true, watchMap:false, region:miniRegion() });
      if (starting) poll(++token);
    });
    return configuration;
  }
  async function poll(generation) {
    timer = null;
    if (!capturing || generation !== token) return;
    try {
      const reply = await invoke('capture_frame', { after:sequence, requestFrame:true });
      if (!capturing || generation !== token) return;
      if (!reply.running) throw reply.message || msg('capture.restart');
      lastPollAt=Date.now();capturePaused=!!reply.message&&!reply.frame;
      if(capturePaused)lastFrameAt=lastPollAt;
      if (reply.frame) {
        lastFrameAt=Date.now();capturePaused=false;
        sequence = reply.frame.sequence;
        if (enabled) { pending = reply.frame; pump(); }
      }
    } catch (error) { if (generation === token) fail(error); return; }
    if (capturing && generation === token) timer = setTimeout(() => poll(generation), 100);
  }
  async function fail(error) {
    record('error',{message:String(error)});void flushLog();
    enabled = false; disposeWorker(); clearPosition(); render();
    window.showMapNotice?.(msg('tracking.failed', { error:I18n.error(error) }));
    try { await syncCapture(); } catch {}
  }
  async function toggle() {
    if (busy || window.getGameMode?.() === 'pvp' && !enabled) return;
    busy = true; enabled = !enabled; render();
    record(enabled?'enabled':'disabled',{resolution,region:miniRegion()});
    if(enabled){restarts.worker=[];restarts.capture=[];}else void flushLog();
    try {
      if (!invoke) throw msg('error.desktop');
      if (enabled) initializeWorker(); else { disposeWorker(); clearPosition(); }
      await syncCapture();
    } catch (error) { await fail(error); }
    finally { busy = false; render(); if (enabled && window.getGameMode?.() === 'pvp') queueMicrotask(toggle); }
  }
  el('tracking-button').onclick = toggle;
  window.addEventListener('game-mode-change', () => { if (enabled && window.getGameMode?.() === 'pvp') void toggle(); else render(); });
  window.enterManualMode = async id => {
    if (id !== undefined && !DUNGEON_DATA.maps.some(map => map.id === Number(id))) throw msg('manual.retry');
    if (id !== undefined) {
      el('map').value = String(id);
      el('map').dispatchEvent(new Event('change', { bubbles:true }));
    } else { disposeWorker(); clearPosition(); if (enabled) initializeWorker(); }
  };
  el('map').addEventListener('change', () => { disposeWorker(); clearPosition(); if (enabled) initializeWorker(); });
  if (el('game-resolution')) {
    el('game-resolution').value = resolution;
    el('game-resolution').onchange = () => {
      resolution = Object.hasOwn(aspects, el('game-resolution').value) ? el('game-resolution').value : '16:9';
      try { localStorage.setItem('aniimo-game-resolution-v1', resolution); } catch {}
      disposeWorker(); clearPosition(); if (enabled) { initializeWorker(); syncCapture().catch(fail); }
    };
  }
  setInterval(() => {
    const now=Date.now();
    if(lastLocationAt&&now-lastLocationAt>1500)window.dispatchEvent(new Event('tracking-stale'));
    if(now-lastLogAt>=1000)void flushLog();
    if(!enabled||busy)return;
    // Missing terrain (menus or another floor) never restarts a healthy worker.
    const workerStuck=worker&&(!ready&&now-workerStartedAt>10000||workerBusy&&now-workerSentAt>3000);
    if(workerStuck&&allowRestart('worker')){
      record('worker-timeout',{ready,elapsedMs:now-(ready?workerSentAt:workerStartedAt)});
      disposeWorker();initializeWorker();
    }
    if(capturing&&!recoveringCapture&&!capturePaused&&now-lastFrameAt>5000&&allowRestart('capture')){
      record('capture-timeout',{frameAgeMs:now-lastFrameAt,pollAgeMs:now-lastPollAt});
      recoveringCapture=true;disposeWorker();initializeWorker();
      syncCapture(true).catch(fail).finally(()=>{recoveringCapture=false;});
    }
  },250);
  window.trackingStatus = () => ({ enabled, capturing, ready, gameWindowId:lastGameId, map:activeMap,workerBusy,capturePaused,
    diagnostic:lastDiagnostic,diagnosticPath,logError,history:history.slice(),restarts:{worker:restarts.worker.length,capture:restarts.capture.length} });
  render();
})();
