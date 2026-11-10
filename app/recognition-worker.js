'use strict';
importScripts('vendor/opencv.js','recognition-core.js','map-header.js','recognition-screen.js','recognition-vision.js','recognition-portals.js','recognition-search.js','recognition-fog.js');
let ready,references=[],priorityMaps=MapSearch.COMMON,evidence=new MapRecognition.Evidence(),cachedMap=null,portals=new MapPortals.Detector(),fog=new MapFog.References();
// Full-map features are only needed when the door check cannot decide. Load
// them while the worker is idle instead of before the first M frame.
const PRELOAD_DELAY_MS=8000;
let preloadTimer=null,pending=0;
function fingerprint(pixels){
  // Coarse image structure: compression noise must not count as a new observation.
  const {data,width,height}=pixels;let result='';
  for(let gy=0;gy<12;gy++)for(let gx=0;gx<16;gx++){
    let sum=0,n=0;
    for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++){
      const x=Math.min(width-1,Math.floor((gx+(dx+.5)/4)*width/16)),y=Math.min(height-1,Math.floor((gy+(dy+.5)/4)*height/12)),i=(y*width+x)*4;
      sum+=(data[i]+data[i+1]+data[i+2])/3;n++;
    }result+=Math.round(sum/n/20).toString(16);
  }return result;
}
async function loadReference(reference){
  if(reference.descriptors)return;
  const bitmap=await decode(reference.image);
  try{
    const canvas=new OffscreenCanvas(1024,1024),ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#172731';ctx.fillRect(0,0,1024,1024);ctx.drawImage(bitmap,0,0,1024,1024);
    Object.assign(reference,features(ctx.getImageData(0,0,1024,1024)));
  }finally{bitmap.close();}
}
function preloadOrder(){const {common,other}=MapSearch.partition(references,priorityMaps);return [...common,...other];}
function schedulePreload(delay){
  clearTimeout(preloadTimer);
  preloadTimer=setTimeout(()=>{
    if(evidence.locked)return;
    if(pending){schedulePreload(250);return;}
    const next=preloadOrder().find(r=>!r.descriptors);if(!next)return;
    pending++;
    queue=queue.then(()=>loadReference(next)).catch(()=>{}).finally(()=>{pending--;schedulePreload(50);});
  },delay);
}
async function init(maps,portalIcons,priority,useFog,preload='idle'){
  await initialized;detector=new cv.ORB(1800,1.2,8,15,0,2,cv.ORB_HARRIS_SCORE,31,12);matcher=new cv.BFMatcher(cv.NORM_HAMMING,false);
  priorityMaps=priority??MapSearch.COMMON;
  references=maps.map(map=>({id:map.id,image:map.image,portals:MapPortals.geometry(map)}));
  await portals.init(portalIcons);
  await fog.init(references,useFog);
  if(preload==='all'){
    const order=preloadOrder();
    for(let i=0;i<order.length;i++){await loadReference(order[i]);postMessage({type:'progress',loaded:i+1,total:order.length});}
  }
  postMessage({type:'ready',version:cv.getBuildInformation().match(/OpenCV ([\d.]+)/)?.[1],preload,
    loaded:references.filter(r=>r.descriptors).length,total:references.length,priority:MapSearch.partition(references,priorityMaps).common.map(r=>r.id),
    fogReferences:fog.items.length,features:references.reduce((n,r)=>n+(r.points?.length||0),0)});
  if(preload==='idle')schedulePreload(PRELOAD_DELAY_MS);
}
// Blue fog: the initial view shows only the start room; a door hypothesis whose
// front door lands in fog cannot be the visible start room.
function revealed(pixels,center,radius){
  const {width,height,data}=pixels;let open=0,total=0;
  for(let y=Math.round(center[1]-radius);y<=center[1]+radius;y+=3)for(let x=Math.round(center[0]-radius);x<=center[0]+radius;x+=3){
    if(x<0||y<0||x>=width||y>=height)continue;
    const i=(Math.round(y)*width+Math.round(x))*4;total++;if(data[i+2]-data[i]<=10)open++;
  }
  return total?open/total:0;
}
function doorCheck(pixels,observed,uiScale){
  if(!observed?.exit||!fog.items.length)return {best:null,evaluated:0,windows:0,hypotheses:0,matched:false};
  const sampled=new Set(fog.items.map(r=>r.id)),radius=START_ROOM_WINDOW_1080*uiScale;
  let {matched,items}=MapPortals.doorHypotheses(references,observed,uiScale);
  items=items.filter(h=>sampled.has(h.id));
  // The player's arrow covers the front door in the initial view, so its
  // detection is unreliable there (about 20 px high at 1080p). The side door is
  // not covered: each dungeon's vector then predicts where the start room must
  // be, and only predictions that land in revealed terrain are checked.
  if(!matched)items=items.filter(h=>h.entrance[0]>=0&&h.entrance[1]>=0&&h.entrance[0]<pixels.width&&h.entrance[1]<pixels.height)
    .map(h=>({...h,open:revealed(pixels,h.entrance,radius*.25)})).filter(h=>h.open>.5).sort((a,b)=>b.open-a.open).slice(0,4);
  const result=fog.confirm(items,observed.exit,uiScale,score,MapRecognition.compareCandidates,center=>windowFeatures(pixels,center,radius));
  return {...result,hypotheses:items.length,matched};
}
async function analyze(message){
  const started=performance.now(),stages={};let mark=started;
  const lap=name=>{const now=performance.now();stages[name]=Math.round((now-mark)*10)/10;mark=now;};
  if(evidence.locked){
    postMessage({type:'result',request:message.request,source:message.source,isMap:false,
      ...evidence.observe([],'','none'),location:null,search:{strategy:'locked',evaluated:0},elapsedMs:0,capturedAt:message.capturedAt});return;
  }
  const bitmap=await decode(message.image);lap('decode');
  let query;
  try{
    // Live frames reach the worker only after the controller found the M map.
    const screen=message.source==='live'&&message.mapOpen===true?{mapOpen:true,headerScore:message.headerScore??null}:MapScreen.inspect(bitmap,undefined,message.aspect);
    lap('inspect');
    let location=null,miniScore=null;
    if(message.source!=='import'&&!screen.mapOpen){
      postMessage({type:'result',request:message.request,source:message.source,isMap:false,
        ...evidence.observe([],'','none'),location:null,elapsedMs:Math.round(performance.now()-started),capturedAt:message.capturedAt});return;
    }
    const region=message.bigRegion||[0,0,1,1],regionAspect=region[2]*bitmap.width/(region[3]*bitmap.height);
    // A full-width ultrawide M map keeps the same UI scale as 16:9 after downscaling.
    const big=crop(bitmap,region,Math.round(1200*Math.max(1,regionAspect/(16/9)))),signature=[big.width,big.height,...big.region,fingerprint(big.pixels)].join(':');
    lap('crop');
    const cached=!!cachedMap&&signature===cachedMap.signature;
    let scores,search;
    if(cached){scores=cachedMap.scores;search={...cachedMap.search,reused:true,evaluated:0,evaluatedOrder:[],fogEvaluated:0,newlyLoadedReferences:0,referenceLoadMs:0};}
    else {
      const uiScale=Math.min(bitmap.width/1920,bitmap.height/1080)*big.ratio;
      const partial=screen.mapOpen?portals.detect(big.pixels,uiScale,true,{image:bitmap,region:big.region,maskHud:region[2]>.9}):null;
      const observed=partial?.entrance&&partial?.exit?partial:null;
      lap('portals');
      const door=doorCheck(big.pixels,partial,uiScale);lap('door');
      // Door centres in 1080p screen pixels, for diagnostics.
      const doors=partial?Object.fromEntries(['entrance','exit'].filter(k=>partial[k]).map(k=>[k,partial[k].map((v,i)=>Math.round((v+(i?big.region[1]:big.region[0])*big.ratio)/uiScale*10)/10)])):null;
      if(door.best){
        scores=[door.best];
        search={strategy:'fog-reference',method:'door-vector',doors,filter:'terrain-and-side-door',fogEvaluated:door.evaluated,doorHypotheses:door.hypotheses,doorMatched:door.matched,
          confirmation:{id:door.best.id,method:'terrain-and-side-door'},candidates:door.hypotheses,priorityGroup:null,evaluatedOrder:[],evaluated:0,total:references.length,
          loadedReferences:references.filter(r=>r.descriptors).length,newlyLoadedReferences:0,referenceLoadMs:0,fallback:null};
      }else{
        query=features(big.pixels);lap('features');
        const candidates=MapPortals.shortlist(references,observed),near=MapPortals.defaultShortlist(references,observed,uiScale);
        const sparse=MapFog.sparse(big.pixels);
        let referenceLoadMs=0,newlyLoadedReferences=0;
        const result=await MapSearch.search({references,near,direction:candidates,priority:priorityMaps,exhaustive:!sparse,
          evaluate:async r=>{const start=performance.now();if(!r.descriptors)newlyLoadedReferences++;await loadReference(r);referenceLoadMs+=performance.now()-start;return score(query,r);},
          agrees:(best,r)=>MapPortals.agrees(best,r,observed,references),compare:MapRecognition.compareCandidates});
        lap('search');
        const {confirmed,filter}=result;scores=result.scores;
        let confirmation=confirmed?{id:result.confirmedId,method:'terrain-and-portals'}:
          MapRecognition.terrainConfirmation(scores,result.order.length===references.length);
        // Reliable doors contradicting a terrain candidate are evidence against
        // locking, even if that candidate has a broad terrain match.
        if(confirmation?.method==='terrain'&&observed&&
          !MapPortals.agrees(scores.find(s=>s.id===confirmation.id),references.find(r=>r.id===confirmation.id),observed,references))confirmation=null;
        search={strategy:confirmed?'portals':'full',method:sparse?'initial-view':'explored',doors,filter:confirmed?filter:null,fogEvaluated:door.evaluated,
          doorHypotheses:door.hypotheses,doorMatched:door.matched,confirmation,
          candidates:confirmed&&filter==='default-distance'?near.length:candidates.length,
          priorityGroup:result.group,evaluatedOrder:result.order,
          defaultCandidates:near.length,directionCandidates:candidates.length,evaluated:result.order.length,total:references.length,
          loadedReferences:references.filter(r=>r.descriptors).length,newlyLoadedReferences,referenceLoadMs:Math.round(referenceLoadMs),
          fallback:confirmed?null:observed?'terrain-disagrees':'portals-unavailable'};
      }
      search.featureMs=stages.features??0;search.portalMs=stages.portals;search.matchMs=Math.round(((stages.door||0)+(stages.search||0))*10)/10;
      cachedMap={signature,scores,search};
    }
    const isMap=true;
    const state=evidence.observe(isMap?scores:[],signature,isMap?'map':'none',search.confirmation);
    if(state.locked)clearTimeout(preloadTimer);
    postMessage({type:'result',request:message.request,source:message.source,isMap,queryFeatures:query?.points.length||0,...state,location,miniScore,
      cached,search,stages,portalTiming:portals.timing,headerScore:screen.headerScore,elapsedMs:Math.round(performance.now()-started),capturedAt:message.capturedAt});
  }finally{query?.descriptors.delete();bitmap.close();}
}
let queue=Promise.resolve();
self.onmessage=event=>{
  const message=event.data;pending++;
  queue=queue.then(async()=>{
  try{
    if(message.type==='init'){ready=init(message.maps,message.portalIcons,message.priorityMaps,message.fogReferences,message.preload);await ready;}
    else if(message.type==='reset'){evidence.reset();cachedMap=null;postMessage({type:'reset'});}
    else if(message.type==='pin'){evidence.pin(message.id);postMessage({type:'pinned',id:message.id});}
    else if(message.type==='analyze'){await ready;await analyze(message);}
  }catch(error){postMessage({type:'error',request:message.request,message:String(error?.message||error)});}
  finally{pending--;}
  });
};
