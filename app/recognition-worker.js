'use strict';
importScripts('vendor/opencv.js','recognition-core.js','map-header.js','recognition-screen.js');
let ready,detector,matcher,references=[],evidence=new MapRecognition.Evidence(),lastLocation=null,cachedMap=null;
const initialized=new Promise(resolve=>cv.then(()=>resolve()));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function features(imageData,circle=false){
  const rgba=cv.matFromImageData(imageData),gray=new cv.Mat(),mask=new cv.Mat(),points=new cv.KeyPointVector(),descriptors=new cv.Mat();
  try{
    cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);
    if(circle){
      mask.create(gray.rows,gray.cols,cv.CV_8UC1);mask.setTo(new cv.Scalar(0));
      const center=new cv.Point(gray.cols/2,gray.rows/2),r=Math.min(gray.cols,gray.rows)*.43;
      cv.circle(mask,center,Math.round(r),new cv.Scalar(255),-1);
      cv.circle(mask,center,Math.round(r*.24),new cv.Scalar(0),-1);
    }
    detector.detectAndCompute(gray,mask,points,descriptors);
    const coords=[];for(let i=0;i<points.size();i++){const p=points.get(i).pt;coords.push([p.x,p.y]);}
    return {points:coords,descriptors};
  }catch(error){descriptors.delete();throw error;}
  finally{rgba.delete();gray.delete();mask.delete();points.delete();}
}
async function decode(source){
  const blob=await (await fetch(source)).blob();return createImageBitmap(blob);
}
function crop(bitmap,region,maxWidth=1200,circle=false){
  const x=clamp(Math.round(region[0]*bitmap.width),0,bitmap.width-1),y=clamp(Math.round(region[1]*bitmap.height),0,bitmap.height-1);
  const w=clamp(Math.round(region[2]*bitmap.width),16,bitmap.width-x),h=clamp(Math.round(region[3]*bitmap.height),16,bitmap.height-y);
  const ratio=Math.min(1,maxWidth/w),width=Math.max(16,Math.round(w*ratio)),height=Math.max(16,Math.round(h*ratio));
  const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(bitmap,x,y,w,h,0,0,width,height);
  const pixels=ctx.getImageData(0,0,width,height);
  // Ignore HUD/minimap corners when looking for the full-screen M map.
  if(!circle&&region[2]>.9){ctx.fillStyle='#14212c';ctx.fillRect(0,0,width*.18,height*.28);}
  return {pixels:!circle?ctx.getImageData(0,0,width,height):pixels,width,height,ratio,region:[x,y,w,h]};
}
function score(query,reference){
  if(query.descriptors.rows<6)return null;
  const matches=new cv.DMatchVectorVector(),pairs=[],used=new Set();
  try{
    matcher.knnMatch(query.descriptors,reference.descriptors,matches,2);
    for(let i=0;i<matches.size();i++){
      const m=matches.get(i);
      if(m.size()>=2){const a=m.get(0),b=m.get(1);
        if(a.distance<62&&a.distance<b.distance*.77&&!used.has(a.trainIdx)){
          used.add(a.trainIdx);const p=query.points[a.queryIdx],q=reference.points[a.trainIdx];
          pairs.push({x:p[0],y:p[1],u:q[0],v:q[1]});
        }
      }m.delete();
    }
  }finally{matches.delete();}
  const result=MapRecognition.consensus(pairs);
  if(!result)return null;
  const {model,inliers,cells,area,error}=result;
  return {id:reference.id,model,inliers:inliers.length,cells,area,error,score:inliers.length+Math.min(20,cells)*1.5,
    spread:Math.max(...inliers.map(p=>p.u))-Math.min(...inliers.map(p=>p.u))};
}
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
      if(message.source==='import'||screen.mapOpen){
        postMessage({type:'result',request:message.request,source:message.source,isMap:true,
          ...evidence.observe([],'','none'),location:null,elapsedMs:Math.round(performance.now()-started),capturedAt:message.capturedAt});return;
      }
      const mini=crop(bitmap,message.miniRegion||[.0427,.0389,.1042,.1852],400,true);
      query=features(mini.pixels,true);
      const reference=references.find(r=>r.id===evidence.locked),match=reference&&score(query,reference);
      miniScore=match?{inliers:match.inliers,error:match.error,cells:match.cells}:null;
      if(match&&match.inliers>=8&&match.cells>=2&&match.error<5){
        const center=MapRecognition.transform(match.model,mini.width/2,mini.height/2).map(v=>v*2);
        const continuity=!lastLocation||Date.now()-lastLocation.at>4000||Math.hypot(center[0]-lastLocation.pixel[0],center[1]-lastLocation.pixel[1])<160;
        if(center.every(v=>v>=0&&v<=2048)&&continuity){
          location={mapId:evidence.locked,pixel:center,inliers:match.inliers,error:match.error,estimated:true};
          lastLocation={pixel:center,at:Date.now()};
        }
      }
      postMessage({type:'result',request:message.request,source:message.source,isMap:false,queryFeatures:query.points.length,
        ...evidence.observe([],'','none'),location,miniScore,elapsedMs:Math.round(performance.now()-started),capturedAt:message.capturedAt});return;
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
    const previousMap=evidence.locked;
    const state=evidence.observe(isMap?scores:[],signature,isMap?'map':'none');
    if(state.locked!==previousMap)lastLocation=null;
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
    else if(message.type==='reset'){evidence.reset();lastLocation=null;cachedMap=null;postMessage({type:'reset'});}
    else if(message.type==='pin'){evidence.pin(message.id);lastLocation=null;postMessage({type:'pinned',id:message.id});}
    else if(message.type==='analyze'){await ready;await analyze(message);}
  }catch(error){postMessage({type:'error',request:message.request,message:String(error?.message||error)});}
  });
};
