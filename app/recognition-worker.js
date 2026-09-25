'use strict';
importScripts('vendor/opencv.js','recognition-core.js','map-header.js','recognition-screen.js','recognition-vision.js');
let ready,references=[],evidence=new MapRecognition.Evidence(),cachedMap=null;
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
async function init(maps){
  await initialized;detector=new cv.ORB(1800,1.2,8,15,0,2,cv.ORB_HARRIS_SCORE,31,12);matcher=new cv.BFMatcher(cv.NORM_HAMMING,false);
  for(const map of maps){
    const bitmap=await decode(map.image),canvas=new OffscreenCanvas(1024,1024),ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#172731';ctx.fillRect(0,0,1024,1024);ctx.drawImage(bitmap,0,0,1024,1024);bitmap.close();
    references.push({id:map.id,...features(ctx.getImageData(0,0,1024,1024))});
    postMessage({type:'progress',loaded:references.length,total:maps.length});
  }
  postMessage({type:'ready',version:cv.getBuildInformation().match(/OpenCV ([\d.]+)/)?.[1],features:references.reduce((n,r)=>n+r.points.length,0)});
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
    const big=crop(bitmap,message.bigRegion||[0,0,1,1]),signature=fingerprint(big.pixels);
    const cached=!!cachedMap&&signature===cachedMap.signature;
    let scores;
    if(cached)scores=cachedMap.scores;
    else {query=features(big.pixels);scores=references.map(r=>score(query,r)).filter(Boolean).sort(MapRecognition.compareCandidates);cachedMap={signature,scores};}
    const isMap=true;
    const state=evidence.observe(isMap?scores:[],signature,isMap?'map':'none');
    postMessage({type:'result',request:message.request,source:message.source,isMap,queryFeatures:query?.points.length||0,...state,location,miniScore,
      cached,headerScore:screen.headerScore,elapsedMs:Math.round(performance.now()-started),capturedAt:message.capturedAt});
  }finally{query?.descriptors.delete();bitmap.close();}
}
let queue=Promise.resolve();
self.onmessage=event=>{
  const message=event.data;
  queue=queue.then(async()=>{
  try{
    if(message.type==='init'){ready=init(message.maps);await ready;}
    else if(message.type==='reset'){evidence.reset();cachedMap=null;postMessage({type:'reset'});}
    else if(message.type==='pin'){evidence.pin(message.id);postMessage({type:'pinned',id:message.id});}
    else if(message.type==='analyze'){await ready;await analyze(message);}
  }catch(error){postMessage({type:'error',request:message.request,message:String(error?.message||error)});}
  });
};
