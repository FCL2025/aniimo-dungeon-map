'use strict';
const data=window.DUNGEON_DATA;
const categories=Object.fromEntries(Object.entries(data.categories).filter(([key])=>!['pot','cache'].includes(key)));
const $=id=>document.getElementById(id);
const colors={egg:'#f3d76d',chest:'#c39fe5',pot:'#cfa881',cache:'#aebfc5',stellarys_boss:'#87dcff',entrance:'#79e1c0',exit:'#ff8798',key_blue:'#7fbbff',key_purple:'#c78aff',key_orange:'#ffb46e',challenge:'#82d2e5'};
const canvas=$('map-canvas'), ctx=canvas.getContext('2d');
const mapLayer=document.createElement('canvas'),mapContext=mapLayer.getContext('2d');
let mapDirty=true,frameRequest=0;
let current, image, visible=[], selected=null, scale=1, tx=0, ty=0, width=1, height=1, drag=null;
let loadToken=0;
let tracking=null;
window.getTrackingSnapshot=()=>tracking?structuredClone(tracking):null;
function renderTrackingStatus(){
  const label=$('player-status'),button=$('locate-player');if(!label||!button)return;
  const valid=tracking&&tracking.mapId===current?.id;
  button.disabled=!valid;
  label.dataset.state=valid?(tracking.stale?'stale':'live'):'waiting';
  label.textContent=valid?(tracking.stale?'最後位置 · 追蹤中斷':'人物位置（估計）'):$('tracking-button')?.getAttribute('aria-checked')==='true'?'等待人物定位':'追蹤已關閉';
  button.title=!valid?'尚未取得人物位置':tracking.stale?'置中到最後位置':'置中到人物位置';
}
window.addEventListener('tracking-update',event=>{
  const next=event.detail;
  if(!next){tracking=null;renderTrackingStatus();draw(false);return;}
  if(!Array.isArray(next.pixel)||next.pixel.length!==2||!next.pixel.every(v=>Number.isFinite(v)&&v>=0&&v<=2048)||!Number.isFinite(next.at))return;
  if(tracking&&next.mapId===tracking.mapId&&next.at<tracking.at)return;
  tracking={...next,stale:!!next.stale||Date.now()-next.at>1500};
  renderTrackingStatus();draw(false);
});
window.addEventListener('tracking-stale',()=>{if(tracking&&!tracking.stale){tracking.stale=true;renderTrackingStatus();draw(false);}});
window.addEventListener('tracking-ui',renderTrackingStatus);
$('locate-player')?.addEventListener('click',()=>{if(tracking&&tracking.mapId===current?.id){tx=width/2-tracking.pixel[0]*scale;ty=height/2-tracking.pixel[1]*scale;draw();}});
const iconImages=new Map();
for(const [key,asset] of Object.entries(data.icons.assets)){
  const icon=new Image();icon.onload=()=>draw();
  icon.onerror=()=>{$('icon-status').textContent='部分圖示載入失敗，請重新解壓完整的應用檔案。';};
  iconImages.set(key,icon);icon.src=asset.image;
}
function iconElement(key){const icon=document.createElement('img');icon.className='marker-icon';icon.src=data.icons.assets[key].image;icon.alt='';icon.setAttribute('aria-hidden','true');return icon;}
function pinSize(pin){const primary=['egg','entrance','exit','stellarys_boss'].includes(pin.category);return primary?28:Math.min(22,Math.max(14,20*Math.sqrt(scale)));}
for(const map of data.maps){const option=document.createElement('option');option.value=map.id;option.textContent=`地宮 ${map.id}`;$('map').append(option);}
for(const [key,name] of Object.entries(categories)){
  const label=document.createElement('label');label.className='check';
  const input=document.createElement('input');input.type='checkbox';input.checked=true;input.dataset.category=key;input.addEventListener('change',update);
  const swatch=iconElement(data.icons.categories[key]);
  const text=document.createElement('span');text.textContent=name;
  const count=document.createElement('span');count.className='count';count.id='count-'+key;
  label.append(input,swatch,text,count);$('filters').append(label);
}
function candidatePins(){return current.pins.filter(p=>p.difficultyCandidates.includes(Number($('difficulty').value))&&($('supplements').checked||p.provenance==='scene_reference')&&(p.category!=='chest'||p.quality>=Number($('quality').value)));}
function update(){
  if(!current)return;
  const enabled=new Set([...document.querySelectorAll('[data-category]:checked')].map(x=>x.dataset.category));
  const candidates=candidatePins();visible=candidates.filter(p=>enabled.has(p.category)).sort((a,b)=>(a.category==='chest'?-1:0)-(b.category==='chest'?-1:0));
  for(const key of Object.keys(categories))$('count-'+key).textContent=candidates.filter(p=>p.category===key).length;
  $('filter-total').textContent=visible.length+' 個候選';$('visible-count').textContent=`（${visible.length}）`;
  if(selected&&!visible.some(p=>p.id===selected.id)){selected=null;$('selected').textContent='點選地圖上的標記，查看名稱、位置與候選群組。';}
  const prefix=$('difficulty').value==='5'?'Nightmare':'Chaos', room=data.rewardRules[prefix+'-room'], hall=data.rewardRules[prefix+'-hallway'];
  $('rules').replaceChildren();
  const p=document.createElement('p');p.textContent=`蛋巢設定：EggCount ${room.EggCount} / EggProbability ${room.EggProbability}。`;$('rules').append(p);
  const table=document.createElement('table');table.innerHTML='<thead><tr><th>群組</th><th>房間</th><th>通道</th></tr></thead>';
  const body=document.createElement('tbody');for(const key of ['G-All','G0','G1','G2','G3','G4','G5','G6']){const tr=document.createElement('tr');for(const value of [key,room[key]??'—',hall[key]??'—']){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);}table.append(body);$('rules').append(table);
  if($('list').open)renderList();draw();
}
function renderList(){
  $('pin-list').replaceChildren();
  for(const pin of visible){const button=document.createElement('button');button.textContent=pin.name;const subtitle=document.createElement('span');subtitle.textContent=`房間 ${pin.roomId} · ${pin.provenance==='template_supplement'?'模組補充':'地圖引用'}${pin.sandboxConfigType===2?' · G'+pin.sandboxLevel:''}`;button.append(subtitle);button.onclick=()=>selectPin(pin);$('pin-list').append(button);}
}
function fit(){if(!current)return;const [x1,y1,x2,y2]=current.bounds,padding=document.body.classList.contains('overlay')?28:64;scale=Math.min((width-padding)/(x2-x1),(height-padding)/(y2-y1));scale=Math.max(.05,scale);tx=(width-(x1+x2)*scale)/2;ty=(height-(y1+y2)*scale)/2;draw();}
function zoom(factor,cx=width/2,cy=height/2){const next=Math.min(5,Math.max(.05,scale*factor));tx=cx-(cx-tx)*next/scale;ty=cy-(cy-ty)*next/scale;scale=next;draw();}
function draw(mapChanged=true){
  mapDirty=mapDirty||mapChanged;
  if(!frameRequest)frameRequest=requestAnimationFrame(renderFrame);
}
function paintMap(ctx){
  ctx.clearRect(0,0,width,height);
  if(image)ctx.drawImage(image,tx,ty,current.size[0]*scale,current.size[1]*scale);
  for(const pin of visible){
    const x=pin.pixel[0]*scale+tx,y=pin.pixel[1]*scale+ty;
    const size=pinSize(pin),r=size/2,icon=iconImages.get(pin.iconKey);
    if(x<-size||y<-size||x>width+size||y>height+size)continue;
    if(icon?.complete&&icon.naturalWidth){
      const ratio=Math.min(size/icon.naturalWidth,size/icon.naturalHeight),w=icon.naturalWidth*ratio,h=icon.naturalHeight*ratio;
      ctx.save();ctx.shadowColor='#07131f';ctx.shadowBlur=3;ctx.shadowOffsetY=1;
      ctx.drawImage(icon,x-w/2,y-h/2,w,h);ctx.restore();
    }
    ctx.lineWidth=1.2;
    if(pin.provenance==='template_supplement'){ctx.strokeStyle=colors[pin.category];ctx.setLineDash([2,2]);ctx.beginPath();ctx.arc(x,y,r+3,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
  }
  if(selected){ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(selected.pixel[0]*scale+tx,selected.pixel[1]*scale+ty,pinSize(selected)/2+4,0,Math.PI*2);ctx.stroke();}
}
function renderFrame(){
  frameRequest=0;
  if(mapDirty){
    if(mapLayer.width!==canvas.width||mapLayer.height!==canvas.height){mapLayer.width=canvas.width;mapLayer.height=canvas.height;}
    const ratio=window.devicePixelRatio||1;mapContext.setTransform(ratio,0,0,ratio,0,0);
    paintMap(mapContext);mapDirty=false;
  }
  ctx.clearRect(0,0,width,height);
  if(mapLayer.width&&mapLayer.height)ctx.drawImage(mapLayer,0,0,mapLayer.width,mapLayer.height,0,0,width,height);
  if(tracking&&tracking.mapId===current?.id){
    ctx.save();
    const x=tracking.pixel[0]*scale+tx,y=tracking.pixel[1]*scale+ty;
    ctx.setLineDash([]);ctx.fillStyle='#102127';ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=tracking.stale?'#a5bac4':'#79e1c0';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.stroke();
    if(!tracking.stale){ctx.fillStyle='#79e1c0';ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();}
    const label=tracking.stale?'最後位置':document.body.classList.contains('overlay')?'你':'人物位置（估計）';
    ctx.font='12px "Microsoft JhengHei", sans-serif';const labelWidth=ctx.measureText(label).width+10;
    const labelX=Math.max(0,Math.min(width-labelWidth,x+15)),labelY=Math.max(15,Math.min(height-7,y));
    if(!document.body.classList.contains('overlay')){ctx.fillStyle='#172731e8';ctx.fillRect(labelX,labelY-14,labelWidth,21);}
    else{ctx.shadowColor='#07131f';ctx.shadowBlur=3;}
    ctx.fillStyle=tracking.stale?'#a5bac4':'#79e1c0';ctx.fillText(label,labelX+5,labelY+1);ctx.restore();
  }
}
function selectPin(pin){
  selected=pin;$('selected').replaceChildren();
  const strong=document.createElement('strong');strong.textContent=pin.name;
  if(pin.category==='stellarys_boss')strong.textContent+='（首領候選）';
  const info=document.createElement('span');info.textContent=` · 房間 ${pin.roomId} · ${pin.provenance==='template_supplement'?'房間模組補充，待核對':'地圖直接引用'}${pin.sandboxConfigType===2?' · 候選群組 G'+pin.sandboxLevel:''}${pin.graphId?' · 有關卡觸發條件':''}`;
  const coords=document.createElement('div');coords.className='coords';coords.textContent=`像素 (${pin.pixel.map(v=>v.toFixed(1)).join(', ')}) · 世界 (${pin.world.map(v=>v.toFixed(2)).join(', ')}) · 來源 ${pin.sourceId}`;
  $('selected').append(iconElement(pin.iconKey),strong,info,coords);draw();
}
function loadMap(){
  current=data.maps.find(m=>m.id===Number($('map').value));selected=null;image=null;
  if(tracking&&tracking.mapId!==current.id)tracking=null;renderTrackingStatus();
  $('map-id').textContent='搶蛋大作戰';$('map-title').textContent='地宮 '+current.id;
  $('selected').textContent='點選地圖上的標記，查看名稱、位置與候選群組。';
  const missing=data.validation.missingReferences.filter(v=>v[0]===current.id).length;
  $('gaps').textContent=missing?`此圖有 ${missing} 筆房間引用，在目前資料中缺少對應模組；這些項目尚無法解析。`:'此圖的房間引用均找到對應資料。';
  $('load-status').textContent='載入底圖…';const token=++loadToken;const nextImage=new Image();
  nextImage.onload=()=>{if(token!==loadToken)return;image=nextImage;$('load-status').textContent='';fit();};
  nextImage.onerror=()=>{if(token!==loadToken)return;$('load-status').textContent='找不到底圖，請保留 grab-eggs-dungeons 與本資料夾的相對位置。';};
  nextImage.src=current.image;update();fit();
}
$('map').addEventListener('change',loadMap);
for(const id of ['difficulty','quality','supplements'])$(id).addEventListener('change',update);
for(const [id,checked] of [['all',true],['none',false]])$(id).onclick=()=>{for(const x of document.querySelectorAll('[data-category]'))x.checked=checked;update();};
$('zoom-in').onclick=()=>zoom(1.35);$('zoom-out').onclick=()=>zoom(1/1.35);$('fit').onclick=fit;$('list').ontoggle=()=>{if($('list').open)renderList();};
canvas.addEventListener('wheel',event=>{event.preventDefault();const box=canvas.getBoundingClientRect();zoom(event.deltaY<0?1.12:1/1.12,event.clientX-box.left,event.clientY-box.top);},{passive:false});
canvas.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY,tx,ty};canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging');});
canvas.addEventListener('pointermove',event=>{if(!drag)return;tx=drag.tx+event.clientX-drag.x;ty=drag.ty+event.clientY-drag.y;draw();});
canvas.addEventListener('pointerup',event=>{
  if(!drag)return;const moved=Math.hypot(event.clientX-drag.x,event.clientY-drag.y);drag=null;canvas.classList.remove('dragging');
  if(moved>4)return;const box=canvas.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;
  const nearest=visible.map(p=>[p,Math.hypot(p.pixel[0]*scale+tx-x,p.pixel[1]*scale+ty-y)]).filter(v=>v[1]<Math.max(13,pinSize(v[0])/2)).sort((a,b)=>a[1]-b[1]);
  if(nearest.length)selectPin(nearest[0][0]);
});
canvas.addEventListener('pointercancel',()=>{drag=null;canvas.classList.remove('dragging');});
canvas.addEventListener('keydown',event=>{if(['+','=','-','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','0'].includes(event.key))event.preventDefault();if(event.key==='+'||event.key==='=')zoom(1.2);else if(event.key==='-')zoom(1/1.2);else if(event.key==='0')fit();else if(event.key==='ArrowUp')ty+=30;else if(event.key==='ArrowDown')ty-=30;else if(event.key==='ArrowLeft')tx+=30;else if(event.key==='ArrowRight')tx-=30;draw();});
new ResizeObserver(()=>{const box=canvas.getBoundingClientRect();width=box.width;height=box.height;const ratio=window.devicePixelRatio||1;canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);fit();}).observe(canvas);
loadMap();
