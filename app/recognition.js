'use strict';
(()=>{
  const {msg:m,bind:b}=window.I18n;
  const el=id=>document.getElementById(id),invoke=window.__TAURI__?.core.invoke;
  const defaults={mini:[.0427,.0389,.1042,.1852],map:[0,0,1,1]},frames=new MapScreen.FrameQueue();
  let regions=structuredClone(defaults),running=false,trackingRunning=false,capturing=false,changing=false;
  let mapWorker=null,mapReady=false,mapBusy=false,mapRequest=0,mapWatchdog=null,trackWorker=null,trackReady=false,trackBusy=false,trackRequest=0,trackMap=null,pendingTrack=null;
  let pollTimer,sessionToken=0,sequence=0,nextCaptureAt=0,lastFrame=null,lastResult=null,lastTrackingResult=null,lastLocationAt=0,lastScreen=null,nonMapFrames=0;
  let mapAttemptStartedAt=0,nextDiagnosticAt=0,diagnosticCount=0,attemptCaptured=0,attemptAnalyzed=0,mapProgress=null,mapRequestStartedAt=0,lastCaptureMessage=null,diagnosticPath=null;
  let previewImage=null,regionDrag=null,pinned=null,selected=null,lastGameId='',lastGameWindow=null,selectingMap=false,importToken=0;
  let burstUntil=0,mapKeyAt=0,lastNoticeKey='',configuration=Promise.resolve();
  const stats={captured:0,analyzed:0,tracked:0,duplicates:0,queuePeak:0,replacedTrackingFrames:0},preview=el('capture-preview'),context=preview.getContext('2d');
  try{const saved=JSON.parse(localStorage.getItem('aniimo-capture-regions-v1'));if(saved&&['mini','map'].every(k=>Array.isArray(saved[k])&&saved[k].length===4&&saved[k].every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&saved[k][2]>.01&&saved[k][3]>.01&&saved[k][0]+saved[k][2]<=1.001&&saved[k][1]+saved[k][3]<=1.001))regions=saved;}catch{}
  function message(title,text,state='waiting'){
    b(el('recognition-state'),title);b(el('recognition-message'),text);
    const badge=el('live-status');badge.dataset.statusKey=pinned?'status.locked':state==='preview'?'status.preview':running?'status.recognizing':'status.manual';b(badge,m(badge.dataset.statusKey));
    b(badge,m('combined',{title,text}),'title');badge.dataset.state=pinned?'locked':state;
    const key=JSON.stringify([title,state,pinned||selected||'']);if(key!==lastNoticeKey){lastNoticeKey=key;window.showMapNotice?.(m('combined',{title,text}));}
    window.dispatchEvent(new Event('recognition-ui'));
    window.dispatchEvent(new Event('tracking-ui'));
  }
  function trackingMessage(text){b(el('tracking-message'),I18n.error(text));}
  function diagnosis(){
    if(!mapReady)return {code:'worker_initializing',text:'辨識引擎仍在載入地圖資料。'};
    if(!capturing&&!lastFrame)return {code:'capture_not_started',text:'遊戲畫面擷取尚未開始。'};
    if(!lastFrame)return {code:'no_frame',text:lastCaptureMessage||'已連接遊戲視窗，但尚未收到擷取畫面。'};
    if(lastResult?.locked)return {code:'recognized',text:`已鎖定地宮 ${lastResult.locked}。`};
    if(lastResult?.selected)return {code:'confirmation_pending',text:`目前候選地宮 ${lastResult.selected} 有 ${lastResult.previewMatches} 個吻合點，尚待門位交叉確認或更明確的地形。`};
    if(lastScreen&&!lastScreen.mapOpen)return {code:'m_map_not_detected',text:'畫面已擷取，但 M 地圖標題與返回圖示均未通過檢查；可能是語系、UI 比例或擷取範圍不同。'};
    if(mapBusy)return {code:'matching_in_progress',text:'已收到 M 地圖畫面，辨識引擎仍在比對地形。'};
    if(lastResult)return {code:'no_terrain_match',text:'已偵測到 M 地圖，但沒有候選同時達到 6 個吻合點與 2 個地形區塊；也請確認目前地宮屬於支援的 7 張。'};
    return {code:'waiting_for_match',text:'已偵測到 M 地圖，正在等待辨識引擎處理畫面。'};
  }
  async function recordDiagnostic(event,error=null){
    if(!invoke||!mapAttemptStartedAt||!el('debug-log')?.checked)return;
    const now=Date.now(),reason=error?{code:'error',text:I18n.format(I18n.error(error))}:diagnosis();
    const entry={at:new Date(now).toISOString(),event,elapsedMs:now-mapAttemptStartedAt,reason,
      capture:{active:capturing,window:lastGameWindow,frames:stats.captured-attemptCaptured,lastMessage:lastCaptureMessage,
        frame:lastFrame?{width:lastFrame.width,height:lastFrame.height,source:lastFrame.source}:null,mapRegion:regions.map},
      screen:lastScreen?{mapOpen:lastScreen.mapOpen,headerScore:Number(lastScreen.headerScore.toFixed(3)),backScore:Number(lastScreen.backScore.toFixed(3)),backOffset:lastScreen.backOffset}:null,
      worker:{ready:mapReady,initializing:!!mapWorker&&!mapReady,busy:mapBusy,busyMs:mapBusy?now-mapRequestStartedAt:0,
        progress:mapProgress,analyzed:stats.analyzed-attemptAnalyzed,queued:frames.items.length},
      result:lastResult?{selected:lastResult.selected,locked:lastResult.locked,lockReason:lastResult.lockReason,previewMatches:lastResult.previewMatches,queryFeatures:lastResult.queryFeatures,
        candidates:lastResult.ranked?.slice(0,3).map(c=>({id:c.id,inliers:c.inliers,cells:c.cells})),
        search:lastResult.search?{strategy:lastResult.search.strategy,evaluated:lastResult.search.evaluated,total:lastResult.search.total,fallback:lastResult.search.fallback}:null}:null};
    try{diagnosticPath=await invoke('append_recognition_log',{entry});b(el('recognition-log'),m('log.path',{path:diagnosticPath}));}
    catch(writeError){b(el('recognition-log'),m('error.operation',{error:I18n.error(writeError)}));}
  }
  function renderSwitch(){
    for(const [id,on,label] of [['recognition-button',running,'recognition'],['tracking-button',trackingRunning,'tracking']]){
      b(el(id),m('switch',{label:m(label),state:m(on?'on':'off')}));b(el(id),m(label+'.'+(on?'disable':'enable')),'title');
      el(id).setAttribute('aria-checked',String(on));el(id).disabled=changing;
    }
    el('game-window').disabled=capturing||changing;el('map').disabled=running&&!!pinned;el('import-map').disabled=changing;
    window.dispatchEvent(new Event('recognition-ui'));
    window.dispatchEvent(new Event('tracking-ui'));
  }
  function clearTracking(){lastLocationAt=0;lastTrackingResult=null;window.dispatchEvent(new CustomEvent('tracking-update',{detail:null}));}
  function disposeMap(){clearTimeout(mapWatchdog);mapWatchdog=null;mapWorker?.terminate();mapWorker=null;mapReady=false;mapBusy=false;frames.clear();}
  function watchMapWorker(worker){
    clearTimeout(mapWatchdog);
    mapWatchdog=setTimeout(()=>{
  const {msg:m,bind:b}=window.I18n;if(mapWorker===worker)workerFailure('map',m('error.timeout'));},30000);
  }
  function disposeTracker(){trackWorker?.terminate();trackWorker=null;trackReady=false;trackBusy=false;pendingTrack=null;trackMap=null;}
  function workerFailure(kind,error){
    if(kind==='map'){void recordDiagnostic('worker_failure',error);running=false;disposeMap();message(m('recognition.failed'),I18n.error(error));}
    else{trackingRunning=false;disposeTracker();clearTracking();trackingMessage(m('tracking.failed',{error:I18n.error(error)}));window.showMapNotice?.(m('tracking.failed',{error:I18n.error(error)}));}
    renderSwitch();syncCapture().catch(captureFailure);
  }
  function initializeMap(){
    if(mapWorker)return;message(m('recognition.loading'),m('recognition.loadingMaps'));
    lastResult=null;lastScreen=null;lastFrame=null;diagnosticPath=null;el('recognition-log').textContent='';
    mapAttemptStartedAt=Date.now();nextDiagnosticAt=mapAttemptStartedAt+5000;diagnosticCount=0;
    attemptCaptured=stats.captured;attemptAnalyzed=stats.analyzed;mapProgress=null;mapRequestStartedAt=0;lastCaptureMessage=null;
    const worker=mapWorker=new Worker('recognition-worker.js');
    worker.onerror=e=>{if(mapWorker===worker)workerFailure('map',e.message);};
    worker.onmessageerror=()=>{if(mapWorker===worker)workerFailure('map',m('error.workerData'));};
    worker.onmessage=({data:r})=>{
      if(mapWorker!==worker)return;
      if(r.type==='progress'){mapProgress={loaded:r.loaded,total:r.total};watchMapWorker(worker);message(m('recognition.loading'),m('recognition.progress',{loaded:r.loaded,total:r.total}));return;}
      if(r.type==='ready'){clearTimeout(mapWatchdog);mapWatchdog=null;mapReady=true;message(m('recognition.wait'),m('recognition.ready'));pumpMap();return;}
      if(r.type==='error'){workerFailure('map',r.message);return;}
      if(r.type!=='result'||r.request!==mapRequest)return;
      clearTimeout(mapWatchdog);mapWatchdog=null;
      mapBusy=false;lastResult=r;renderResult(r);if(pinned||!running)disposeMap();else pumpMap();
    };
    worker.postMessage({type:'init',maps:DUNGEON_DATA.maps.map(m=>({id:m.id,size:m.size,portalGeometry:m.portalGeometry,image:new URL(m.image,location.href).href})),
      portalIcons:Object.fromEntries(['entrance','exit'].map(kind=>[kind,new URL(DUNGEON_DATA.icons.assets[DUNGEON_DATA.icons.categories[kind]].image,location.href).href]))});
    watchMapWorker(worker);
  }
  function initializeTracker(){
    if(!trackingRunning)return;const map=DUNGEON_DATA.maps.find(m=>m.id===Number(el('map').value));
    if(!map||(trackWorker&&trackMap===map.id))return;
    disposeTracker();clearTracking();trackMap=map.id;trackingMessage(m('tracking.loading',{id:map.id}));
    const worker=trackWorker=new Worker('tracking-worker.js');
    worker.onerror=e=>{if(trackWorker===worker)workerFailure('track',e.message);};
    worker.onmessage=({data:r})=>{
      if(trackWorker!==worker)return;
      if(r.type==='ready'){trackReady=true;trackingMessage(m('tracking.waitMap',{id:trackMap}));pumpTrack();return;}
      if(r.type==='error'){workerFailure('track',r.message);return;}
      if(r.type!=='result'||r.request!==trackRequest)return;trackBusy=false;
      if(trackingRunning&&r.mapId===Number(el('map').value)){
        lastTrackingResult=r;
        if(r.location&&Date.now()-r.capturedAt<1500){lastLocationAt=r.capturedAt;window.dispatchEvent(new CustomEvent('tracking-update',{detail:{...r.location,at:r.capturedAt}}));trackingMessage(m('combined',{title:m('recognition.matches',{id:r.mapId,count:r.location.inliers}),text:r.elapsedMs+' ms'}));}
        else trackingMessage(r.isMap?m('tracking.closeMap'):m('tracking.waitMap',{id:r.mapId}));
      }pumpTrack();
    };
    worker.postMessage({type:'init',map:{id:map.id,image:new URL(map.image,location.href).href}});
  }
  function pumpMap(){
    if(!mapWorker||!mapReady||mapBusy)return;const frame=frames.shift();if(!frame)return;mapBusy=true;stats.analyzed++;
    mapRequestStartedAt=Date.now();mapWorker.postMessage({type:'analyze',request:++mapRequest,image:frame.image,capturedAt:frame.capturedAt,source:frame.source,bigRegion:regions.map});
    watchMapWorker(mapWorker);
  }
  function pumpTrack(){
    if(!trackingRunning||!trackReady||trackBusy||!pendingTrack)return;const frame=pendingTrack;pendingTrack=null;
    if(Date.now()-frame.capturedAt>1000)return;trackBusy=true;stats.tracked++;
    trackWorker.postMessage({type:'track',request:++trackRequest,image:frame.image,capturedAt:frame.capturedAt,sourceRegion:frame.sourceRegion,miniRegion:regions.mini});
  }
  const previewOpen=()=>el('recognition-settings').open&&el('capture-details').open;
  function drawPreview(){
    if(!previewImage)return;preview.width=previewImage.width;preview.height=previewImage.height;context.drawImage(previewImage,0,0);
    for(const [kind,color] of [['mini','#79e1c0'],['map','#dfb65b']]){if(kind==='map'&&regions.map[2]===1)continue;const r=regions[kind];context.strokeStyle=color;context.lineWidth=Math.max(2,preview.width/500);context.setLineDash(kind==='mini'?[]:[8,5]);context.strokeRect(r[0]*preview.width,r[1]*preview.height,r[2]*preview.width,r[3]*preview.height);}context.setLineDash([]);
  }
  async function offer(frame){
    lastFrame=frame;
    if(trackingRunning&&frame.source!=='import'){if(pendingTrack)stats.replacedTrackingFrames++;pendingTrack=frame;pumpTrack();}
    const full=!frame.sourceRegion||frame.sourceRegion[2]===1&&frame.sourceRegion[3]===1;
    const analyzeMap=(running&&!pinned||frame.source==='import')&&full;if(!analyzeMap&&!previewOpen())return;
    const worker=mapWorker,token=importToken,img=new Image();img.src=frame.image;await img.decode();if(token!==importToken)return;
    if(previewOpen()&&full){previewImage=img;el('capture-empty').hidden=true;drawPreview();}
    if(!analyzeMap||worker!==mapWorker)return;lastScreen=MapScreen.inspect(img);Object.assign(frame,lastScreen);if(frame.source==='import')frame.mapOpen=true;
    if(!frame.mapOpen){
      if(++nonMapFrames>=2&&!selected)message(m('recognition.wait'),m('recognition.notMap'));
      return;
    }
    nonMapFrames=0;
    if(!frames.push(frame)){stats.duplicates++;return;}stats.queuePeak=Math.max(stats.queuePeak,frames.items.length);pumpMap();
  }
  function selectMap(id){if(el('map').value!==String(id)){selectingMap=true;el('map').value=String(id);el('map').dispatchEvent(new Event('change',{bubbles:true}));selectingMap=false;}}
  function renderResult(r){
    if(r.ranked.length){el('recognition-candidates').replaceChildren();for(const c of r.ranked){const li=document.createElement('li');b(li,m('recognition.matches',{id:c.id,count:c.inliers}));el('recognition-candidates').append(li);}}
    b(el('recognition-timing'),m('recognition.timing',{seconds:(r.elapsedMs/1000).toFixed(2),count:r.observations}));
    const lockedBefore=pinned;pinned=r.locked;if(r.selected){selected=r.selected;selectMap(selected);}renderSwitch();
    if(r.locked&&diagnosticCount)void recordDiagnostic('recognized');
    if(r.locked)message(m('status.locked'),m('recognition.locked',{id:r.locked}),'locked');
    else if(r.selected)message(m('status.preview'),m('recognition.matches',{id:r.selected,count:r.previewMatches}),'preview');
    else message(m('recognition.insufficient'),m('recognition.explore'));
    if(pinned!==lockedBefore)syncCapture().catch(captureFailure);
  }
  async function refresh(){
    if(!invoke){const option=new Option('','');b(option,m('error.desktop'));el('game-window').replaceChildren(option);return [];}
    const windows=await invoke('game_windows'),select=el('game-window'),old=select.value;select.replaceChildren();for(const w of windows)select.add(new Option(w.title,w.id));
    if(!windows.length){const option=new Option('','');b(option,m('game.missing'));select.add(option);}else if(windows.some(w=>w.id===old))select.value=old;return windows;
  }
  function syncCapture(){
    configuration=configuration.catch(()=>{
  const {msg:m,bind:b}=window.I18n;}).then(async()=>{
      if(!invoke)return;
      if(!running&&!trackingRunning||pinned&&!trackingRunning&&!previewOpen()){
        if(capturing){capturing=false;sessionToken++;clearTimeout(pollTimer);await invoke('stop_capture');}renderSwitch();return;
      }
      const starting=!capturing;
      if(starting){
        lastGameWindow=null;
        const windows=await refresh(),id=el('game-window').value;if(!id)throw m('game.missing');
        if(lastGameId&&lastGameId!==id){pinned=null;selected=null;disposeMap();disposeTracker();clearTracking();if(running)initializeMap();if(trackingRunning)initializeTracker();}
        await invoke('start_capture',{windowId:id});lastGameId=id;lastGameWindow=windows.find(w=>w.id===id)||null;sequence=0;capturing=true;lastFrame=null;
      }
      const watchMap=running&&!pinned;
      await invoke('configure_capture',{fast:trackingRunning,watchMap,region:trackingRunning&&!watchMap&&!previewOpen()?regions.mini:null});
      nextCaptureAt=0;renderSwitch();if(starting)poll(++sessionToken);
    });return configuration;
  }
  function captureFailure(error){
    if(running||mapWorker)void recordDiagnostic('capture_failure',error);
    running=false;trackingRunning=false;disposeMap();disposeTracker();clearTracking();renderSwitch();message(m('capture.stopped'),I18n.error(error));trackingMessage(m('capture.restart'));syncCapture().catch(()=>{
  const {msg:m,bind:b}=window.I18n;});
  }
  async function poll(token){
    if(!capturing||token!==sessionToken)return;
    try{
      const now=Date.now(),requestFrame=(trackingRunning||running&&!pinned||previewOpen())&&now>=nextCaptureAt;if(requestFrame)nextCaptureAt=now+(trackingRunning?100:1000);
      const generation=importToken;
      const reply=await invoke('capture_frame',{after:sequence,requestFrame});if(!capturing||token!==sessionToken)return;burstUntil=reply.burstUntil||0;mapKeyAt=reply.mapKeyAt||0;
      if(reply.message)lastCaptureMessage=reply.message;else if(reply.frame)lastCaptureMessage=null;
      if(!reply.running)throw reply.message?I18n.error(reply.message):m('capture.restart');
      if(reply.frame){sequence=reply.frame.sequence;if(generation===importToken){stats.captured++;await offer({...reply.frame,source:'live'});}}if(reply.message&&trackingRunning)trackingMessage(reply.message);
    }catch(error){if(token===sessionToken)captureFailure(error);return;}
    if(capturing&&token===sessionToken)pollTimer=setTimeout(()=>poll(token),trackingRunning?25:100);
  }
  async function toggle(kind){
    if(changing)return;changing=true;renderSwitch();
    try{
      if(!invoke)throw m('error.desktop');
      if(kind==='map'){
        running=!running;importToken++;
        if(running){
          pinned=null;selected=null;lastResult=null;lastFrame=null;lastScreen=null;nonMapFrames=0;burstUntil=0;mapKeyAt=0;nextCaptureAt=0;
          diagnosticPath=null;el('recognition-log').textContent='';
          disposeMap();disposeTracker();clearTracking();
          el('recognition-candidates').replaceChildren();el('recognition-timing').textContent='';
          initializeMap();if(trackingRunning)initializeTracker();
          message(m('recognition.reset'),m('recognition.resetHint'));
        }else{disposeMap();message(m('recognition.off'),pinned?m('recognition.retained',{id:pinned}):m('recognition.manualHint'),pinned?'locked':'waiting');}
      }else{trackingRunning=!trackingRunning;if(trackingRunning)initializeTracker();else{disposeTracker();clearTracking();trackingMessage(m('tracking.off'));}}
      await syncCapture();
    }catch(error){captureFailure(error);}finally{changing=false;renderSwitch();}
  }
  el('recognition-button').onclick=()=>toggle('map');el('tracking-button').onclick=()=>toggle('track');
  el('map').addEventListener('change',()=>{
    if(!selectingMap){pinned=null;selected=Number(el('map').value);disposeMap();if(running)initializeMap();}
    clearTracking();if(trackingRunning)initializeTracker();nextCaptureAt=0;renderSwitch();if(capturing)syncCapture().catch(captureFailure);
  });
  el('refresh-game').onclick=()=>refresh().catch(e=>message(m('recognition.failed'),I18n.error(e)));
  el('recognition-settings').ontoggle=()=>{if(el('recognition-settings').open){refresh().catch(()=>{
  const {msg:m,bind:b}=window.I18n;});drawPreview();}if(capturing)syncCapture().catch(captureFailure);};
  el('capture-details').ontoggle=()=>{drawPreview();if(capturing)syncCapture().catch(captureFailure);};
  el('import-map').onclick=()=>el('map-screenshot').click();
  el('map-screenshot').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;if(file.size>30*1024*1024){message(m('import.large'),m('import.limit'));return;}
    const token=++importToken;running=false;disposeMap();renderSwitch();
    try{await syncCapture();const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});if(token!==importToken)return;initializeMap();await offer({image,capturedAt:Date.now(),source:'import'});}
    catch(error){message(m('import.failed'),I18n.error(error));}
  };
  function regionsChanged(){importToken++;pinned=null;disposeMap();if(running)initializeMap();disposeTracker();clearTracking();if(trackingRunning)initializeTracker();if(capturing)syncCapture().catch(captureFailure);renderSwitch();}
  el('capture-region').onchange=()=>preview.classList.toggle('selecting',el('capture-region').value!=='view');
  function normalized(event){const box=preview.getBoundingClientRect();return [Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)),Math.max(0,Math.min(1,(event.clientY-box.top)/box.height))];}
  preview.onpointerdown=event=>{if(!previewImage||el('capture-region').value==='view')return;regionDrag={start:normalized(event),kind:el('capture-region').value};preview.setPointerCapture(event.pointerId);};
  preview.onpointermove=event=>{if(!regionDrag)return;const [x,y]=normalized(event),[sx,sy]=regionDrag.start;drawPreview();context.strokeStyle='#ffffff';context.lineWidth=3;context.strokeRect(sx*preview.width,sy*preview.height,(x-sx)*preview.width,(y-sy)*preview.height);};
  preview.onpointerup=event=>{if(!regionDrag)return;const [x,y]=normalized(event),[sx,sy]=regionDrag.start,kind=regionDrag.kind;regionDrag=null;
    if(Math.abs(x-sx)>.025&&Math.abs(y-sy)>.025){regions[kind]=[Math.min(x,sx),Math.min(y,sy),Math.abs(x-sx),Math.abs(y-sy)];try{localStorage.setItem('aniimo-capture-regions-v1',JSON.stringify(regions));}catch{}regionsChanged();}
    drawPreview();
  };
  preview.onpointercancel=()=>{regionDrag=null;drawPreview();};
  el('reset-regions').onclick=()=>{regions=structuredClone(defaults);try{localStorage.removeItem('aniimo-capture-regions-v1');}catch{}regionsChanged();drawPreview();};
  setInterval(()=>{
  const {msg:m,bind:b}=window.I18n;if(lastLocationAt&&Date.now()-lastLocationAt>1500)window.dispatchEvent(new CustomEvent('tracking-stale'));},250);
  setInterval(()=>{
  const {msg:m,bind:b}=window.I18n;
    const now=Date.now();if(!el('debug-log')?.checked||!mapWorker||pinned||!mapAttemptStartedAt||now<nextDiagnosticAt)return;
    diagnosticCount++;nextDiagnosticAt=now+10000;void recordDiagnostic('slow');
  },250);
  window.recognitionStatus=()=>({ready:mapReady,initializing:!!mapWorker&&!mapReady,busy:mapBusy,running,trackingRunning,capturing,lastScreen,nonMapFrames,
    trackingReady:trackReady,trackingBusy:trackBusy,trackingMap:trackMap,pinned,selected,lastResult,lastTrackingResult,regions,diagnosticPath,
    queueLength:frames.items.length,trackingQueueLength:pendingTrack?1:0,burstUntil,mapKeyAt,stats:{...stats}});
  renderSwitch();
})();
