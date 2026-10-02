// Browser integration test of the real controller with deterministic capture/worker boundaries.
(async()=>{
  const iframe=document.createElement('iframe');iframe.hidden=true;document.body.append(iframe);
  const w=iframe.contentWindow,d=w.document;d.body.innerHTML=document.body.innerHTML;d.querySelectorAll('iframe,script').forEach(e=>e.remove());
  const el=id=>d.getElementById(id),assert=(ok,msg)=>{if(!ok)throw Error(msg);},pause=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async condition=>{for(let i=0;i<100;i++){if(condition())return;await pause(20);}throw Error('Timed out');};
  const workers=[],calls=[],frames=[],positions=[];let active=false,holdWindows=false,releaseWindows;
  w.DUNGEON_DATA=DUNGEON_DATA;w.MapScreen=MapScreen;w.I18n=I18n;w.showMapNotice=()=>{};
  w.URL=class extends URL {constructor(url,base){super(url,base==='about:blank'?location.href:base);}};
  w.Worker=class {
    constructor(url){this.url=url;this.messages=[];workers.push(this);}
    postMessage(message){this.messages.push(message);if(message.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));}
    terminate(){this.terminated=true;}
    reply(data){this.onmessage({data});}
  };
  w.__TAURI__={core:{invoke:async(name,args)=>{
    calls.push({name,args});if(name==='game_windows')return holdWindows?new Promise(resolve=>{releaseWindows=resolve;}):[{id:'fixture',title:'Fixture'}];
    if(name==='start_capture'){active=true;return;}if(name==='stop_capture'){active=false;return;}
    if(name==='capture_frame')return {running:active,frame:frames.shift()||null};
  }}};
  w.addEventListener('tracking-update',e=>positions.push(e.detail));
  try{
    await new Promise((resolve,reject)=>{
      const script=d.createElement('script');script.src=new URL('recognition.js',location.href).href;
      script.onload=resolve;script.onerror=()=>reject(Error('Controller script failed to load'));d.body.append(script);
    });
    const state=()=>w.recognitionStatus(),count=name=>calls.filter(c=>c.name===name).length;
    await el('tracking-button').onclick();await until(()=>state().trackingReady);
    assert(state().trackingRunning&&!state().running&&state().capturing,'Tracking-only startup failed');
    assert(workers.length===1&&workers[0].url==='tracking-worker.js','Tracking startup initialized 31-map recognition');
    let tracker=workers[0];const mapId=Number(el('map').value),time=Date.now();
    frames.push(...[0,1,2].map(i=>({sequence:i+1,capturedAt:time+i,image:'tracking-only-frame',sourceRegion:[.04,.03,.11,.20]})));
    await until(()=>state().stats.captured===3);
    assert(state().trackingQueueLength===1,'Tracking queue grew beyond latest frame');
    const first=tracker.messages.find(m=>m.type==='track');tracker.reply({type:'result',request:first.request,mapId,capturedAt:first.capturedAt,location:null});
    const latest=tracker.messages.filter(m=>m.type==='track').at(-1);
    assert(latest.capturedAt===time+2,'Tracker analyzed an outdated queued frame');
    tracker.reply({type:'result',request:latest.request,mapId,capturedAt:latest.capturedAt,elapsedMs:20,location:{mapId,pixel:[850,1250],inliers:20}});
    await el('recognition-button').onclick();await until(()=>state().ready);
    assert(state().running&&state().trackingRunning&&count('start_capture')===1,'Modes did not share one capture session');
    const activeWorkers=workers.length,activeCalls=calls.filter(c=>c.name!=='capture_frame').length,previousLocale=I18n.locale;
    for(const locale of ['ja','de','zh-TW','en']){
      I18n.setLocale(locale);
      assert(state().running&&state().trackingRunning&&state().capturing,'Language change stopped capture');
      assert(workers.length===activeWorkers&&calls.filter(c=>c.name!=='capture_frame').length===activeCalls,'Language change restarted a worker or capture');
      assert(el('recognition-button').textContent===I18n.t('switch',{label:I18n.msg('recognition'),state:I18n.msg('on')}),'Active switch did not translate');
    }
    I18n.setLocale(previousLocale);
    assert(tracker.terminated&&positions.at(-1)===null,'Restart kept the previous tracker or position');
    tracker=workers.filter(x=>x.url==='tracking-worker.js').at(-1);
    const recognizer=workers.find(x=>x.url==='recognition-worker.js');
    recognizer.reply({type:'result',request:0,ranked:[],locked:mapId,selected:mapId,observations:1,elapsedMs:1});
    await until(()=>recognizer.terminated&&calls.filter(c=>c.name==='configure_capture').at(-1)?.args.watchMap===false);
    assert(!state().ready&&!state().busy&&state().queueLength===0,'Lock did not release recognition worker and queued frames');
    assert(state().trackingRunning&&state().capturing,'Automatic lock stopped independent tracking');
    await el('recognition-button').onclick();
    assert(!state().running&&state().trackingRunning&&state().capturing&&count('stop_capture')===0,'Turning recognition off stopped tracking');
    assert(state().pinned===mapId,'Recognized map was lost');
    assert(calls.filter(c=>c.name==='configure_capture').at(-1).args.region!==null,'Tracking-only capture was not cropped');
    const received=positions.filter(Boolean).length;
    frames.push({sequence:4,capturedAt:Date.now(),image:'tracking-only-frame',sourceRegion:[.04,.03,.11,.2]});
    await until(()=>tracker.messages.filter(m=>m.type==='track').length===1);
    const next=tracker.messages.at(-1);tracker.reply({type:'result',request:next.request,mapId,capturedAt:next.capturedAt,elapsedMs:20,location:{mapId,pixel:[860,1250],inliers:20}});
    assert(positions.filter(Boolean).length===received+1,'No positions after recognition was closed');
    await el('tracking-button').onclick();assert(!state().capturing&&count('stop_capture')===1,'Both off did not stop capture');
    await el('recognition-button').onclick();await until(()=>state().ready);
    assert(state().pinned===null&&state().selected===null&&state().lastResult===null,'Recognition restart retained the old lock/results');
    assert(!el('recognition-settings')&&!el('recognition-candidates'),'Removed recognition settings remain in the sidebar');
    recognizer.reply({type:'result',request:0,ranked:[],locked:mapId,selected:mapId,observations:1,elapsedMs:1});
    assert(state().pinned===null,'A terminated recognizer relocked the previous map');
    await el('tracking-button').onclick();await el('tracking-button').onclick();
    assert(state().running&&!state().trackingRunning&&state().capturing&&count('stop_capture')===1,'Turning tracking off stopped recognition');
    await el('recognition-button').onclick();el('map').value='20036';el('map').dispatchEvent(new w.Event('change'));
    await el('tracking-button').onclick();await until(()=>state().trackingReady);
    assert(state().trackingMap===20036&&!state().running,'Manual map tracking failed');
    await el('recognition-button').onclick();await until(()=>state().ready&&state().trackingReady);
    assert(state().trackingRunning&&positions.at(-1)===null,'Restart failed to clear position while preserving tracking toggle');
    assert(!el('new-session'),'Removed new-session button remains');
    await el('tracking-button').onclick();
    const finalRecognizer=workers.filter(x=>x.url==='recognition-worker.js').at(-1);
    finalRecognizer.reply({type:'result',request:0,ranked:[],locked:20036,selected:20036,observations:1,elapsedMs:1});
    await until(()=>!state().capturing&&finalRecognizer.terminated);
    assert(state().pinned===20036&&state().queueLength===0,'Recognition-only lock did not stop capture and retain the map');
    await el('recognition-button').onclick();
    await until(()=>!state().capturing);
    await el('tracking-button').onclick();await el('recognition-button').onclick();
    const superseded=workers.filter(x=>x.url==='recognition-worker.js').at(-1);
    const oldTracker=workers.filter(x=>x.url==='tracking-worker.js').at(-1);
    await w.enterManualMode(20040);
    assert(!state().running&&state().trackingRunning&&state().trackingMap===20040,'Manual selection did not preserve independent tracking');
    assert(superseded.terminated&&oldTracker.terminated&&positions.at(-1)===null,'Manual selection retained workers or a stale position');
    superseded.reply({type:'result',request:0,ranked:[],locked:20036,selected:20036,observations:1,elapsedMs:1});
    assert(el('map').value==='20040'&&state().pinned===null&&state().lastResult===null,'Late automatic result overwrote the manual map');
    const sameMapTracker=workers.filter(x=>x.url==='tracking-worker.js').at(-1);
    await w.enterManualMode(20040);
    assert(sameMapTracker.terminated&&state().trackingMap===20040,'Same-map reselection did not reset tracking');
    assert(calls.filter(c=>c.name==='configure_capture').at(-1).args.watchMap===false,'Manual mode still watches M for recognition');
    await el('tracking-button').onclick();
    holdWindows=true;
    const startup=el('recognition-button').onclick();await until(()=>!!releaseWindows);
    const manual=w.enterManualMode(20035);
    assert(!state().running&&!state().ready&&!state().initializing,'Manual mode waited for native startup before cancelling recognition');
    releaseWindows([{id:'fixture',title:'Fixture'}]);await Promise.all([startup,manual]);
    assert(!state().capturing&&el('map').value==='20035'&&!state().running,'Native startup race restarted capture after manual choice');
    holdWindows=false;
    const resolution=el('game-resolution'),previousResolution=resolution.value;
    assert(resolution&&!el('recognition-settings'),'Resolution must be available without diagnostic controls');
    const setResolution=value=>{resolution.value=value;resolution.dispatchEvent(new w.Event('change'));};
    const checkRegion=expected=>{
      const region=calls.filter(c=>c.name==='configure_capture').at(-1).args.region;
      assert(region&&region.every((v,i)=>Math.abs(v-expected[i])<1e-9),'Native capture used the wrong resolution region');
    };
    try{
      setResolution('16:9');await el('tracking-button').onclick();await until(()=>state().trackingReady);
      checkRegion(state().regions.mini||[82/1920,42/1080,200/1920,200/1080]);
      const oldResolutionTracker=workers.filter(x=>x.url==='tracking-worker.js').at(-1);
      setResolution('21:9');await until(()=>state().trackingReady);await pause(30);
      assert(oldResolutionTracker.terminated&&state().trackingRunning,'Resolution change must restart active tracking');
      checkRegion(state().regions.mini||[82/2580,42/1080,200/2580,200/1080]);
      frames.push({sequence:1,capturedAt:Date.now(),image:'tracking-only-frame',sourceRegion:[.02,.02,.1,.2]});
      const wideTracker=workers.filter(x=>x.url==='tracking-worker.js').at(-1);
      await until(()=>wideTracker.messages.some(m=>m.type==='track'));
      const wideFrame=wideTracker.messages.find(m=>m.type==='track');
      assert(wideFrame.aspect===3440/1440,'Tracking worker did not receive the selected aspect ratio');
      await el('recognition-button').onclick();await until(()=>state().ready);
      const wideRecognizer=workers.filter(x=>x.url==='recognition-worker.js').at(-1);
      wideRecognizer.reply({type:'result',request:0,ranked:[],locked:20035,selected:20035,observations:1,elapsedMs:1});
      await until(()=>state().pinned===20035);
      setResolution('16:9');await until(()=>state().ready&&state().trackingReady);
      assert(state().pinned===null&&state().lastResult===null,'Resolution change retained an old recognition lock');
      wideRecognizer.reply({type:'result',request:0,ranked:[],locked:20040,selected:20040,observations:1,elapsedMs:1});
      assert(state().pinned===null,'Old resolution worker overwrote the new session');
      await el('recognition-button').onclick();await el('tracking-button').onclick();
      await el('recognition-button').onclick();await until(()=>state().ready);
      workers.filter(x=>x.url==='recognition-worker.js').at(-1).reply({type:'result',request:0,ranked:[],locked:20035,selected:20035,observations:1,elapsedMs:1});
      await until(()=>state().pinned===20035&&!state().capturing);
      setResolution('21:9');await until(()=>state().ready&&state().capturing);
      assert(state().pinned===null&&state().running&&!state().trackingRunning,'Changing resolution after a recognition-only lock did not resume capture');
      await el('recognition-button').onclick();
    }finally{setResolution(previousResolution);}
    return {passed:true,languagePreservesWorkers:true,independentSwitches:true,oneCaptureSession:true,latestFrameOnly:true,positionsAfterRecognitionOff:true,manualMap:true,restartClearsLockAndPosition:true,lateResultIgnored:true,lockStopsCapture:true,manualOverridesAutomatic:true,sameMapResetsTracking:true,manualCancelsPendingStartup:true,resolutionRestartsWorkers:true,resolutionUpdatesNativeCrop:true};
  }catch(error){throw Error(String(error)+' '+JSON.stringify({state:w.recognitionStatus?.(),calls,workers:workers.map(x=>({url:x.url,messages:x.messages,terminated:x.terminated})),message:el('recognition-message')?.textContent}));}
  finally{iframe.remove();}
})()
