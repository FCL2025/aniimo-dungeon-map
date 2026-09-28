'use strict';
(()=>{
  const el=id=>document.getElementById(id),invoke=window.__TAURI__?.core.invoke;
  const defaults={mini:[.0427,.0389,.1042,.1852],map:[0,0,1,1]},frames=new MapScreen.FrameQueue();
  let regions=structuredClone(defaults),running=false,trackingRunning=false,capturing=false,changing=false;
  let mapWorker=null,mapReady=false,mapBusy=false,mapRequest=0,trackWorker=null,trackReady=false,trackBusy=false,trackRequest=0,trackMap=null,pendingTrack=null;
  let pollTimer,sessionToken=0,sequence=0,nextCaptureAt=0,lastFrame=null,lastResult=null,lastTrackingResult=null,lastLocationAt=0;
  let previewImage=null,regionDrag=null,pinned=null,selected=null,lastGameId='',selectingMap=false,importToken=0;
  let burstUntil=0,mapKeyAt=0,lastNoticeKey='',configuration=Promise.resolve();
  const stats={captured:0,analyzed:0,tracked:0,duplicates:0,queuePeak:0,replacedTrackingFrames:0},preview=el('capture-preview'),context=preview.getContext('2d');
  try{const saved=JSON.parse(localStorage.getItem('aniimo-capture-regions-v1'));if(saved&&['mini','map'].every(k=>Array.isArray(saved[k])&&saved[k].length===4&&saved[k].every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&saved[k][2]>.01&&saved[k][3]>.01&&saved[k][0]+saved[k][2]<=1.001&&saved[k][1]+saved[k][3]<=1.001))regions=saved;}catch{}
  function message(title,text,state='waiting'){
    el('recognition-state').textContent=title;el('recognition-message').textContent=text;
    const badge=el('live-status');badge.textContent=pinned?'已鎖定':state==='preview'?'候選預覽':running?'辨識中':'手動選圖';
    badge.title=title+' · '+text;badge.dataset.state=pinned?'locked':state;
    const key=[title,state,pinned||selected||''].join(':');if(key!==lastNoticeKey){lastNoticeKey=key;window.showMapNotice?.(title+' · '+text);}
    window.dispatchEvent(new Event('recognition-ui'));
    window.dispatchEvent(new Event('tracking-ui'));
  }
  function trackingMessage(text){el('tracking-message').textContent=text;}
  function renderSwitch(){
    for(const [id,on,label] of [['recognition-button',running,'辨識'],['tracking-button',trackingRunning,'追蹤']]){
      el(id).textContent=label+'：'+(on?'開':'關');el(id).title=label==='辨識'?(on?'關閉地圖辨識':'重新辨識本場地宮'):(on?'關閉':'開啟')+'小地圖人物追蹤';
      el(id).setAttribute('aria-checked',String(on));el(id).disabled=changing;
    }
    el('game-window').disabled=capturing||changing;el('map').disabled=running&&!!pinned;el('import-map').disabled=changing;
    window.dispatchEvent(new Event('recognition-ui'));
    window.dispatchEvent(new Event('tracking-ui'));
  }
  function clearTracking(){lastLocationAt=0;lastTrackingResult=null;window.dispatchEvent(new CustomEvent('tracking-update',{detail:null}));}
  function disposeMap(){mapWorker?.terminate();mapWorker=null;mapReady=false;mapBusy=false;frames.clear();}
  function disposeTracker(){trackWorker?.terminate();trackWorker=null;trackReady=false;trackBusy=false;pendingTrack=null;trackMap=null;}
  function workerFailure(kind,error){
    if(kind==='map'){running=false;disposeMap();message('辨識失敗',String(error));}
    else{trackingRunning=false;disposeTracker();clearTracking();trackingMessage('追蹤失敗：'+String(error));window.showMapNotice?.('追蹤失敗：'+String(error));}
    renderSwitch();syncCapture().catch(captureFailure);
  }
  function initializeMap(){
    if(mapWorker)return;message('準備辨識資料','正在載入常見地宮，未吻合時會繼續搜尋其他地圖。');
    const worker=mapWorker=new Worker('recognition-worker.js');
    worker.onerror=e=>{if(mapWorker===worker)workerFailure('map',e.message);};
    worker.onmessage=({data:r})=>{
      if(mapWorker!==worker)return;
      if(r.type==='progress'){message('準備辨識資料',`${r.loaded} / ${r.total} 張地宮`);return;}
      if(r.type==='ready'){mapReady=true;pumpMap();return;}
      if(r.type==='error'){workerFailure('map',r.message);return;}
      if(r.type!=='result'||r.request!==mapRequest)return;
      mapBusy=false;lastResult=r;renderResult(r);if(pinned||!running)disposeMap();else pumpMap();
    };
    worker.postMessage({type:'init',maps:DUNGEON_DATA.maps.map(m=>({id:m.id,size:m.size,portalGeometry:m.portalGeometry,image:new URL(m.image,location.href).href})),
      portalIcons:Object.fromEntries(['entrance','exit'].map(kind=>[kind,new URL(DUNGEON_DATA.icons.assets[DUNGEON_DATA.icons.categories[kind]].image,location.href).href]))});
  }
  function initializeTracker(){
    if(!trackingRunning)return;const map=DUNGEON_DATA.maps.find(m=>m.id===Number(el('map').value));
    if(!map||(trackWorker&&trackMap===map.id))return;
    disposeTracker();clearTracking();trackMap=map.id;trackingMessage(`準備追蹤地宮 ${map.id}，只載入目前地圖。`);
    const worker=trackWorker=new Worker('tracking-worker.js');
    worker.onerror=e=>{if(trackWorker===worker)workerFailure('track',e.message);};
    worker.onmessage=({data:r})=>{
      if(trackWorker!==worker)return;
      if(r.type==='ready'){trackReady=true;trackingMessage(`追蹤地宮 ${trackMap}：等待小地圖畫面。`);pumpTrack();return;}
      if(r.type==='error'){workerFailure('track',r.message);return;}
      if(r.type!=='result'||r.request!==trackRequest)return;trackBusy=false;
      if(trackingRunning&&r.mapId===Number(el('map').value)){
        lastTrackingResult=r;
        if(r.location&&Date.now()-r.capturedAt<1500){lastLocationAt=r.capturedAt;window.dispatchEvent(new CustomEvent('tracking-update',{detail:{...r.location,at:r.capturedAt}}));trackingMessage(`地宮 ${r.mapId} · ${r.elapsedMs} ms · ${r.location.inliers} 個吻合點`);}
        else trackingMessage(r.isMap?'請關閉 M 地圖，回到遊玩畫面追蹤人物。':`追蹤地宮 ${r.mapId}：等待足夠的小地圖地形。`);
      }pumpTrack();
    };
    worker.postMessage({type:'init',map:{id:map.id,image:new URL(map.image,location.href).href}});
  }
  function pumpMap(){
    if(!mapWorker||!mapReady||mapBusy)return;const frame=frames.shift();if(!frame)return;mapBusy=true;stats.analyzed++;
    mapWorker.postMessage({type:'analyze',request:++mapRequest,image:frame.image,capturedAt:frame.capturedAt,source:frame.source,bigRegion:regions.map});
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
    if(!analyzeMap||worker!==mapWorker)return;Object.assign(frame,MapScreen.inspect(img));if(frame.source==='import')frame.mapOpen=true;
    if(!frame.mapOpen)return;if(!frames.push(frame)){stats.duplicates++;return;}stats.queuePeak=Math.max(stats.queuePeak,frames.items.length);pumpMap();
  }
  function selectMap(id){if(el('map').value!==String(id)){selectingMap=true;el('map').value=String(id);el('map').dispatchEvent(new Event('change',{bubbles:true}));selectingMap=false;}}
  function renderResult(r){
    if(r.ranked.length){el('recognition-candidates').replaceChildren();for(const c of r.ranked){const li=document.createElement('li');li.textContent=`地宮 ${c.id} · ${c.inliers} 個吻合點`;el('recognition-candidates').append(li);}}
    el('recognition-timing').textContent=`本次地圖比對 ${(r.elapsedMs/1000).toFixed(2)} 秒 · ${r.observations} 組畫面`;
    const lockedBefore=pinned;pinned=r.locked;if(r.selected){selected=r.selected;selectMap(selected);}renderSwitch();
    if(r.locked)message('本場已鎖定',`地宮 ${r.locked} · 可關閉辨識，使用「追蹤」獨立更新人物位置。`,'locked');
    else if(r.selected)message('候選預覽',`地宮 ${r.selected} · ${r.previewMatches} / 200 點。`,'preview');
    else message('等待 M 地圖','開啟遊戲地圖後會顯示最相似的地宮。');
    if(pinned!==lockedBefore)syncCapture().catch(captureFailure);
  }
  async function refresh(){
    if(!invoke){el('game-window').replaceChildren(new Option('視窗擷取需桌面版',''));return [];}
    const windows=await invoke('game_windows'),select=el('game-window'),old=select.value;select.replaceChildren();for(const w of windows)select.add(new Option(w.title,w.id));
    if(!windows.length)select.add(new Option('找不到遊戲，請先啟動伊莫',''));else if(windows.some(w=>w.id===old))select.value=old;return windows;
  }
  function syncCapture(){
    configuration=configuration.catch(()=>{}).then(async()=>{
      if(!invoke)return;
      if(!running&&!trackingRunning){if(capturing){capturing=false;sessionToken++;clearTimeout(pollTimer);await invoke('stop_capture');}renderSwitch();return;}
      const starting=!capturing;
      if(starting){
        await refresh();const id=el('game-window').value;if(!id)throw Error('找不到伊莫，請啟動遊戲後再開啟。');
        if(lastGameId&&lastGameId!==id){pinned=null;selected=null;disposeMap();disposeTracker();clearTracking();if(running)initializeMap();if(trackingRunning)initializeTracker();}
        await invoke('start_capture',{windowId:id});lastGameId=id;sequence=0;capturing=true;lastFrame=null;
      }
      const watchMap=running&&!pinned;
      await invoke('configure_capture',{fast:trackingRunning,watchMap,region:trackingRunning&&!watchMap&&!previewOpen()?regions.mini:null});
      nextCaptureAt=0;renderSwitch();if(starting)poll(++sessionToken);
    });return configuration;
  }
  function captureFailure(error){
    running=false;trackingRunning=false;disposeMap();disposeTracker();clearTracking();renderSwitch();message('擷取已停止',String(error));trackingMessage('擷取已停止，可重新開啟追蹤。');syncCapture().catch(()=>{});
  }
  async function poll(token){
    if(!capturing||token!==sessionToken)return;
    try{
      const now=Date.now(),requestFrame=(trackingRunning||running&&!pinned||previewOpen())&&now>=nextCaptureAt;if(requestFrame)nextCaptureAt=now+(trackingRunning?100:1000);
      const generation=importToken;
      const reply=await invoke('capture_frame',{after:sequence,requestFrame});if(!capturing||token!==sessionToken)return;burstUntil=reply.burstUntil||0;mapKeyAt=reply.mapKeyAt||0;
      if(!reply.running)throw Error(reply.message||'遊戲擷取已結束，請重新開啟。');
      if(reply.frame){sequence=reply.frame.sequence;if(generation===importToken){stats.captured++;await offer({...reply.frame,source:'live'});}}if(reply.message&&trackingRunning)trackingMessage(reply.message);
    }catch(error){if(token===sessionToken)captureFailure(error);return;}
    if(capturing&&token===sessionToken)pollTimer=setTimeout(()=>poll(token),trackingRunning?25:100);
  }
  async function toggle(kind){
    if(changing)return;changing=true;renderSwitch();
    try{
      if(!invoke)throw Error('即時擷取需桌面版；可在側欄匯入 M 地圖截圖。');
      if(kind==='map'){
        running=!running;importToken++;
        if(running){
          pinned=null;selected=null;lastResult=null;lastFrame=null;burstUntil=0;mapKeyAt=0;nextCaptureAt=0;
          disposeMap();disposeTracker();clearTracking();
          el('recognition-candidates').replaceChildren();el('recognition-timing').textContent='';
          initializeMap();if(trackingRunning)initializeTracker();
          message('重新辨識本場','已清除上一場鎖定，請開啟遊戲 M 地圖。');
        }else{disposeMap();message('辨識已關閉',pinned?`保留地宮 ${pinned}供追蹤；再次開啟辨識會重新判斷本場。`:'可手動選圖，或再次開啟辨識。',pinned?'locked':'waiting');}
      }else{trackingRunning=!trackingRunning;if(trackingRunning)initializeTracker();else{disposeTracker();clearTracking();trackingMessage('人物追蹤已關閉。');}}
      await syncCapture();
    }catch(error){captureFailure(error);}finally{changing=false;renderSwitch();}
  }
  el('recognition-button').onclick=()=>toggle('map');el('tracking-button').onclick=()=>toggle('track');
  el('map').addEventListener('change',()=>{
    if(!selectingMap){pinned=null;selected=Number(el('map').value);disposeMap();if(running)initializeMap();}
    clearTracking();if(trackingRunning)initializeTracker();nextCaptureAt=0;renderSwitch();if(capturing)syncCapture().catch(captureFailure);
  });
  el('refresh-game').onclick=()=>refresh().catch(e=>message('無法尋找遊戲',String(e)));
  el('recognition-settings').ontoggle=()=>{if(el('recognition-settings').open){refresh().catch(()=>{});drawPreview();}if(capturing)syncCapture().catch(captureFailure);};
  el('capture-details').ontoggle=()=>{drawPreview();if(capturing)syncCapture().catch(captureFailure);};
  el('import-map').onclick=()=>el('map-screenshot').click();
  el('map-screenshot').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;if(file.size>30*1024*1024){message('截圖過大','請使用小於 30 MB 的 PNG、JPG 或 WebP。');return;}
    const token=++importToken;running=false;disposeMap();renderSwitch();
    try{await syncCapture();const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});if(token!==importToken)return;initializeMap();await offer({image,capturedAt:Date.now(),source:'import'});}
    catch(error){message('無法匯入截圖',String(error));}
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
  setInterval(()=>{if(lastLocationAt&&Date.now()-lastLocationAt>1500)window.dispatchEvent(new CustomEvent('tracking-stale'));},250);
  window.recognitionStatus=()=>({ready:mapReady,initializing:!!mapWorker&&!mapReady,busy:mapBusy,running,trackingRunning,capturing,
    trackingReady:trackReady,trackingBusy:trackBusy,trackingMap:trackMap,pinned,selected,lastResult,lastTrackingResult,regions,
    queueLength:frames.items.length,trackingQueueLength:pendingTrack?1:0,burstUntil,mapKeyAt,stats:{...stats}});
  renderSwitch();
})();
