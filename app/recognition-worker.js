'use strict';
importScripts('vendor/opencv.js','recognition-core.js','map-header.js','recognition-screen.js','recognition-vision.js','recognition-portals.js','recognition-search.js','recognition-fog.js');
let ready,references=[],priorityMaps=MapSearch.COMMON,evidence=new MapRecognition.Evidence(),cachedMap=null,portals=new MapPortals.Detector(),fog=new MapFog.References();
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
async function init(maps,portalIcons,priority,useFog){
  await initialized;detector=new cv.ORB(1800,1.2,8,15,0,2,cv.ORB_HARRIS_SCORE,31,12);matcher=new cv.BFMatcher(cv.NORM_HAMMING,false);
  priorityMaps=priority??MapSearch.COMMON;
  references=maps.map(map=>({id:map.id,image:map.image,portals:MapPortals.geometry(map)}));
  const common=MapSearch.partition(references,priorityMaps).common,preload=common.length?common:references;
  for(let i=0;i<preload.length;i++){
    await loadReference(preload[i]);
    postMessage({type:'progress',loaded:i+1,total:preload.length});
  }
  await portals.init(portalIcons);
  await fog.init(references,useFog);
  postMessage({type:'ready',version:cv.getBuildInformation().match(/OpenCV ([\d.]+)/)?.[1],
    loaded:preload.length,total:references.length,priority:common.map(r=>r.id),fogReferences:fog.items.length,features:preload.reduce((n,r)=>n+r.points.length,0)});
}
async function analyze(message){
  const started=performance.now(),bitmap=await decode(message.image);
  let query;
  try{
    const screen=MapScreen.inspect(bitmap);
    // Once locked, never search or switch maps again in this session.
    let location=null,miniScore=null;
    if(evidence.locked){
      postMessage({type:'result',request:message.request,source:message.source,isMap:screen.mapOpen,
        ...evidence.observe([],'','none'),location:null,elapsedMs:Math.round(performance.now()-started),capturedAt:message.capturedAt});return;
    }
    if(message.source!=='import'&&!screen.mapOpen){
      postMessage({type:'result',request:message.request,source:message.source,isMap:false,
        ...evidence.observe([],'','none'),location:null,elapsedMs:Math.round(performance.now()-started),capturedAt:message.capturedAt});return;
    }
    const big=crop(bitmap,message.bigRegion||[0,0,1,1]),signature=[big.width,big.height,...big.region,fingerprint(big.pixels)].join(':');
    const cached=!!cachedMap&&signature===cachedMap.signature;
    let scores,search;
    if(cached){scores=cachedMap.scores;search={...cachedMap.search,reused:true,evaluated:0,evaluatedOrder:[],fogEvaluated:0,newlyLoadedReferences:0,referenceLoadMs:0};}
    else {
      const featureStart=performance.now();query=features(big.pixels);
      const featureMs=performance.now()-featureStart,portalStart=performance.now();
      const uiScale=Math.min(bitmap.width/1920,bitmap.height/1080)*big.ratio;
      const partial=screen.mapOpen?portals.detect(big.pixels,uiScale,true):null;
      const observed=partial?.entrance&&partial?.exit?partial:null;
      const candidates=MapPortals.shortlist(references,observed),near=MapPortals.defaultShortlist(references,observed,uiScale);
      const portalMs=performance.now()-portalStart,matchStart=performance.now();
      const fogResult=fog.match(query,big.pixels,partial?.exit,uiScale,score,MapRecognition.compareCandidates);
      let referenceLoadMs=0,newlyLoadedReferences=0;
      const result=fogResult.best?{scores:[fogResult.best],confirmed:true,filter:'terrain-and-side-door',group:'common',order:[]}:await MapSearch.search({references,near,direction:candidates,priority:priorityMaps,
        evaluate:async r=>{const start=performance.now();if(!r.descriptors)newlyLoadedReferences++;await loadReference(r);referenceLoadMs+=performance.now()-start;return score(query,r);},
        agrees:(best,r)=>MapPortals.agrees(best,r,observed),compare:MapRecognition.compareCandidates});
      const {confirmed,filter}=result;scores=result.scores;
      search={strategy:fogResult.best?'fog-reference':confirmed?'portals':'full',filter:confirmed?filter:null,fogEvaluated:fogResult.evaluated,
        candidates:confirmed&&filter==='default-distance'?near.length:candidates.length,
        priorityGroup:result.group,evaluatedOrder:result.order,
        defaultCandidates:near.length,directionCandidates:candidates.length,evaluated:result.order.length,total:references.length,
        loadedReferences:references.filter(r=>r.descriptors).length,newlyLoadedReferences,referenceLoadMs:Math.round(referenceLoadMs),
        fallback:confirmed?null:observed?'terrain-disagrees':'portals-unavailable',
        featureMs:Math.round(featureMs),portalMs:Math.round(portalMs),matchMs:Math.round(performance.now()-matchStart)};
      cachedMap={signature,scores,search};
    }
    const isMap=true;
    const state=evidence.observe(isMap?scores:[],signature,isMap?'map':'none');
    postMessage({type:'result',request:message.request,source:message.source,isMap,queryFeatures:query?.points.length||0,...state,location,miniScore,
      cached,search,headerScore:screen.headerScore,elapsedMs:Math.round(performance.now()-started),capturedAt:message.capturedAt});
  }finally{query?.descriptors.delete();bitmap.close();}
}
let queue=Promise.resolve();
self.onmessage=event=>{
  const message=event.data;
  queue=queue.then(async()=>{
  try{
    if(message.type==='init'){ready=init(message.maps,message.portalIcons,message.priorityMaps,message.fogReferences);await ready;}
    else if(message.type==='reset'){evidence.reset();cachedMap=null;postMessage({type:'reset'});}
    else if(message.type==='pin'){evidence.pin(message.id);postMessage({type:'pinned',id:message.id});}
    else if(message.type==='analyze'){await ready;await analyze(message);}
  }catch(error){postMessage({type:'error',request:message.request,message:String(error?.message||error)});}
  });
};
