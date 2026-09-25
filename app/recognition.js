'use strict';
(()=>{
  const el=id=>document.getElementById(id),invoke=window.__TAURI__?.core.invoke;
  const defaults={mini:[.0427,.0389,.1042,.1852],map:[0,0,1,1]},frames=new MapScreen.FrameQueue();
  let regions=structuredClone(defaults),worker,ready=false,initializing=false,busy=false,running=false,pollTimer,sequence=0,request=0,generation=0,pendingGeneration=0;
  let lastFrame=null,lastResult=null,lastLocationAt=0,previewImage=null,regionDrag=null,pinned=null,selected=null,lastGameId='',sessionToken=0,nextCaptureAt=0,burstUntil=0,mapKeyAt=0;
  const stats={captured:0,analyzed:0,duplicates:0,queuePeak:0},preview=el('capture-preview'),context=preview.getContext('2d');
  let lastNoticeKey='';
  try{const saved=JSON.parse(localStorage.getItem('aniimo-capture-regions-v1'));if(saved&&['mini','map'].every(k=>Array.isArray(saved[k])&&saved[k].length===4&&saved[k].every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&saved[k][2]>.01&&saved[k][3]>.01&&saved[k][0]+saved[k][2]<=1.001&&saved[k][1]+saved[k][3]<=1.001))regions=saved;}catch{}
  function message(title,text,state='waiting'){
    el('recognition-state').textContent=title;el('recognition-message').textContent=text;
    const badge=el('live-status');
    badge.textContent=state==='locked'?'已鎖定':state==='preview'?'候選預覽':running?'辨識中':'未鎖定';
    badge.title=title+' · '+text;badge.dataset.state=state;
    const noticeKey=[title,state,pinned||selected||''].join(':');
    if(noticeKey!==lastNoticeKey){lastNoticeKey=noticeKey;window.showMapNotice?.(title+' · '+text);}
    window.dispatchEvent(new Event('recognition-ui'));
  }
  function renderSwitch(){el('recognition-button').textContent=running?'辨識：開':'辨識：關';el('recognition-button').title=running?'關閉辨識':'開啟辨識';el('recognition-button').setAttribute('aria-checked',String(running));el('game-window').disabled=running;el('map').disabled=running&&!!pinned;window.dispatchEvent(new Event('recognition-ui'));}
  function clearTracking(){lastLocationAt=0;window.dispatchEvent(new CustomEvent('tracking-update',{detail:null}));}
  function initialize(){
    if(worker)return;
    initializing=true;message('準備辨識資料','首次使用正在載入 31 張地形。');
    worker=new Worker('recognition-worker.js');
    worker.onerror=e=>{busy=false;initializing=false;ready=false;worker.terminate();worker=null;message('辨識無法啟動',e.message||'請重新啟動應用。');};
    worker.onmessage=event=>{
      const result=event.data;
      if(result.type==='progress'){if(running||frames.items.length)message('準備辨識資料',`${result.loaded} / ${result.total} 張地宮`);return;}
      if(result.type==='ready'){ready=true;initializing=false;pump();return;}
      if(result.type==='reset')return;
      if(result.type==='error'&&result.request==null){worker.terminate();worker=null;ready=false;initializing=false;busy=false;message('辨識資料無法載入',result.message);return;}
      if(result.request!==request)return;
      busy=false;
      if(pendingGeneration===generation){
        if(result.type==='error')message('本次辨識失敗',result.message);
        else {lastResult=result;renderResult(result);}
      }
      pump();
    };
    worker.postMessage({type:'init',maps:window.DUNGEON_DATA.maps.map(m=>({id:m.id,image:new URL(m.image,location.href).href}))});
  }
  function drawPreview(){
    if(!previewImage)return;
    preview.width=previewImage.width;preview.height=previewImage.height;context.drawImage(previewImage,0,0);
    for(const [kind,color] of [['mini','#79e1c0'],['map','#dfb65b']]){
      if(kind==='map'&&regions.map[2]===1)continue;
      const r=regions[kind];context.strokeStyle=color;context.lineWidth=Math.max(2,preview.width/500);context.setLineDash(kind==='mini'?[]:[8,5]);
      context.strokeRect(r[0]*preview.width,r[1]*preview.height,r[2]*preview.width,r[3]*preview.height);
    }context.setLineDash([]);
  }
  async function showFrame(frame){
    const token=generation,img=new Image();img.src=frame.image;await img.decode();if(token!==generation)return false;
    const screen=MapScreen.inspect(img);Object.assign(frame,screen);if(frame.source==='import')frame.mapOpen=true;
    lastFrame=frame;previewImage=img;el('capture-empty').hidden=true;
    if(el('recognition-settings').open&&el('capture-details').open)drawPreview();return true;
  }
  function offer(frame){
    if(frame.source!=='import'&&!pinned&&!frame.mapOpen)return;
    if(!frames.push(frame)){stats.duplicates++;return;}
    stats.queuePeak=Math.max(stats.queuePeak,frames.items.length);pump();
  }
  function pump(){
    if(!ready||busy)return;
    const frame=frames.shift();if(!frame)return;
    busy=true;pendingGeneration=generation;request++;stats.analyzed++;
    worker.postMessage({type:'analyze',request,image:frame.image,capturedAt:frame.capturedAt,source:frame.source||'live',bigRegion:regions.map,miniRegion:regions.mini});
  }
  function selectMap(id){const select=el('map');if(select.value!==String(id)){select.value=String(id);select.dispatchEvent(new Event('change',{bubbles:true}));}}
  function renderResult(r){
    if(r.ranked.length){
      el('recognition-candidates').replaceChildren();
      for(const c of r.ranked){const li=document.createElement('li');li.textContent=`地宮 ${c.id} · ${c.inliers} 個吻合點`;el('recognition-candidates').append(li);}
    }
    el('recognition-timing').textContent=`本次比對 ${(r.elapsedMs/1000).toFixed(2)} 秒 · ${r.observations} 組畫面${r.cached?' · 重用相同畫面':''}`;
    pinned=r.locked;
    if(r.selected){if(selected!==r.selected)clearTracking();selected=r.selected;selectMap(selected);}
    renderSwitch();
    if(r.locked){
      if(r.location){lastLocationAt=r.capturedAt||Date.now();window.dispatchEvent(new CustomEvent('tracking-update',{detail:{...r.location,at:lastLocationAt}}));message('本場已鎖定',`地宮 ${r.locked} · ${r.lockedMatches} 個吻合點 · 位置已更新`,'locked');}
      else message('本場已鎖定',`地宮 ${r.locked} · ${r.lockedMatches} 個吻合點；換地宮請按「新一場」。`,'locked');
    }else if(r.selected)message('候選預覽',`地宮 ${r.selected} · ${r.previewMatches} / 200 點；目前第一名，會隨排名更新。`,'preview');
    else message('等待 M 地圖','開啟遊戲地圖後會先顯示最相似的地宮。');
  }
  async function refresh(){
    if(!invoke){el('game-window').replaceChildren(new Option('視窗擷取需桌面版',''));return [];}
    const windows=await invoke('game_windows'),select=el('game-window'),old=select.value;select.replaceChildren();
    for(const w of windows)select.add(new Option(w.title,w.id));
    if(!windows.length)select.add(new Option('找不到遊戲，請先啟動伊莫',''));
    else if(windows.some(w=>w.id===old))select.value=old;
    return windows;
  }
  async function stop(){
    running=false;sessionToken++;generation++;clearTimeout(pollTimer);frames.clear();lastFrame=null;burstUntil=0;renderSwitch();
    if(invoke)await invoke('stop_capture');
    window.dispatchEvent(new CustomEvent('tracking-stale'));
  }
  async function poll(token){
    if(!running||token!==sessionToken)return;
    try{
      const now=Date.now(),requestFrame=now>=nextCaptureAt;
      if(requestFrame)nextCaptureAt=now+(pinned?250:1000);
      const reply=await invoke('capture_frame',{after:sequence,requestFrame});if(!running||token!==sessionToken)return;
      burstUntil=reply.burstUntil||0;mapKeyAt=reply.mapKeyAt||0;
      if(!reply.running){await stop();message('辨識已停止',reply.message||'請重新開啟辨識。');return;}
      if(reply.message)message('等待遊戲畫面',reply.message);
      if(reply.frame){sequence=reply.frame.sequence;stats.captured++;const frame={...reply.frame,source:'live'};
        if(await showFrame(frame)&&running&&token===sessionToken)offer(frame);
      }else if(lastFrame&&Date.now()-lastFrame.capturedAt>3500){message('等待新畫面','請還原遊戲視窗。');window.dispatchEvent(new CustomEvent('tracking-stale'));}
    }catch(error){if(token!==sessionToken)return;await stop().catch(()=>{});message('擷取失敗',String(error));return;}
    if(running&&token===sessionToken)pollTimer=setTimeout(()=>poll(token),100);
  }
  el('recognition-button').onclick=async()=>{
    const button=el('recognition-button');button.disabled=true;
    try{
      if(running){await stop();message('辨識已關閉',pinned?`地宮 ${pinned} 的本場鎖定已保留。`:'候選已保留，可繼續同一場。');return;}
      if(!invoke){message('請使用桌面版','網頁模式可在側欄匯入截圖。');return;}
      await refresh();const id=el('game-window').value;
      if(!id){message('找不到伊莫','啟動遊戲後，再開啟辨識開關。');return;}
      if(lastGameId&&lastGameId!==id)reset();initialize();await invoke('start_capture',{windowId:id});
      lastGameId=id;sequence=0;nextCaptureAt=0;running=true;lastFrame=null;renderSwitch();
      if(selected)selectMap(selected);message('辨識已開啟','在遊戲按 M；先預覽第一名，達 200 點後鎖定。');poll(++sessionToken);
    }catch(error){running=false;renderSwitch();message('無法開啟辨識',String(error));}
    finally{button.disabled=false;window.dispatchEvent(new Event('recognition-ui'));}
  };
  function reset(){generation++;pinned=null;selected=null;lastResult=null;lastFrame=null;frames.clear();clearTracking();worker?.postMessage({type:'reset'});el('recognition-candidates').replaceChildren();el('recognition-timing').textContent='';nextCaptureAt=0;renderSwitch();message('新一場','已解除鎖定，下一張 M 地圖會重新排名。');}
  el('new-session').onclick=reset;
  el('refresh-game').onclick=()=>refresh().catch(e=>message('無法尋找遊戲',String(e)));
  el('recognition-settings').ontoggle=()=>{if(el('recognition-settings').open){refresh().catch(()=>{});drawPreview();}};
  el('capture-details').ontoggle=drawPreview;
  el('import-map').onclick=()=>el('map-screenshot').click();
  el('map-screenshot').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    if(file.size>30*1024*1024){message('截圖過大','請使用小於 30 MB 的 PNG、JPG 或 WebP。');return;}
    try{
      if(running)await stop();const token=generation;
      const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
      if(token!==generation)return;
      const frame={image,capturedAt:Date.now(),source:'import'};
      if(await showFrame(frame)){initialize();offer(frame);}
    }catch(error){message('無法匯入截圖',String(error));}
  };
  el('capture-region').onchange=()=>preview.classList.toggle('selecting',el('capture-region').value!=='view');
  function normalized(event){const box=preview.getBoundingClientRect();return [Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)),Math.max(0,Math.min(1,(event.clientY-box.top)/box.height))];}
  preview.onpointerdown=event=>{if(!previewImage||el('capture-region').value==='view')return;regionDrag={start:normalized(event),kind:el('capture-region').value};preview.setPointerCapture(event.pointerId);};
  preview.onpointermove=event=>{if(!regionDrag)return;const [x,y]=normalized(event),[sx,sy]=regionDrag.start;drawPreview();context.strokeStyle='#ffffff';context.lineWidth=3;context.strokeRect(sx*preview.width,sy*preview.height,(x-sx)*preview.width,(y-sy)*preview.height);};
  preview.onpointerup=event=>{if(!regionDrag)return;const [x,y]=normalized(event),[sx,sy]=regionDrag.start,kind=regionDrag.kind;regionDrag=null;
    if(Math.abs(x-sx)>.025&&Math.abs(y-sy)>.025){regions[kind]=[Math.min(x,sx),Math.min(y,sy),Math.abs(x-sx),Math.abs(y-sy)];try{localStorage.setItem('aniimo-capture-regions-v1',JSON.stringify(regions));}catch{}reset();}
    drawPreview();
  };
  preview.onpointercancel=()=>{regionDrag=null;drawPreview();};
  el('reset-regions').onclick=()=>{regions=structuredClone(defaults);try{localStorage.removeItem('aniimo-capture-regions-v1');}catch{}reset();drawPreview();};
  setInterval(()=>{if(lastLocationAt&&Date.now()-lastLocationAt>4000)window.dispatchEvent(new CustomEvent('tracking-stale'));},1000);
  window.recognitionStatus=()=>({ready,initializing,busy,running,pinned,selected,lastResult,regions,queueLength:frames.items.length,burstUntil,mapKeyAt,stats:{...stats}});
})();
