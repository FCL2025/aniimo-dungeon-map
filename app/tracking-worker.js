'use strict';
importScripts('vendor/opencv.js','recognition-core.js','map-header.js','recognition-screen.js','recognition-vision.js','tracking-core.js');
let reference,queryDetector,localReference,localCenter;
const gate=new MapTracking.PositionGate();
async function init(map){
  await initialized;
  detector=new cv.ORB(7000,1.2,8,12,0,2,cv.ORB_HARRIS_SCORE,31,9);
  queryDetector=new cv.ORB(1200,1.2,8,9,0,2,cv.ORB_HARRIS_SCORE,31,9);
  matcher=new cv.BFMatcher(cv.NORM_HAMMING,false);
  const bitmap=await decode(map.image),canvas=new OffscreenCanvas(1024,1024),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#172731';ctx.fillRect(0,0,1024,1024);ctx.drawImage(bitmap,0,0,1024,1024);bitmap.close();
  reference={id:map.id,...features(ctx.getImageData(0,0,1024,1024))};
  postMessage({type:'ready',mapId:map.id,features:reference.points.length});
}
function nearbyReference(){
  if(!gate.last)return null;
  const center=gate.last.pixel.map(v=>v/2);
  if(localCenter&&Math.hypot(center[0]-localCenter[0],center[1]-localCenter[1])<60)return localReference;
  localReference?.descriptors.delete();localReference=null;localCenter=center;
  const ids=[];reference.points.forEach((p,i)=>{if(Math.abs(p[0]-center[0])<210&&Math.abs(p[1]-center[1])<210)ids.push(i);});
  if(ids.length<12)return null;
  const descriptors=new cv.Mat(ids.length,32,cv.CV_8UC1),source=reference.descriptors.data;
  ids.forEach((id,i)=>descriptors.data.set(source.subarray(id*32,id*32+32),i*32));
  return localReference={id:reference.id,points:ids.map(i=>reference.points[i]),descriptors};
}
const usable=match=>match&&match.inliers>=8&&match.cells>=2&&match.error<5;
async function track(message){
  const started=performance.now(),bitmap=await decode(message.image);let query;
  try{
    const screen=MapScreen.inspect(bitmap,message.sourceRegion),at=message.capturedAt||Date.now();
    let location=null,match=null,local=false;
    if(!screen.mapOpen){
      const region=MapScreen.relativeRegion(message.miniRegion||[.0427,.0389,.1042,.1852],message.sourceRegion);
      const mini=crop(bitmap,region,400,true);query=features(mini.pixels,true,queryDetector);
      const nearby=gate.last&&at-gate.last.at<1500?nearbyReference():null;
      if(nearby){match=score(query,nearby);local=usable(match);}
      if(!local)match=score(query,reference);
      if(usable(match)){
        const pixel=MapRecognition.transform(match.model,mini.width/2,mini.height/2).map(v=>v*2);
        if(gate.accept(pixel,at))location={mapId:reference.id,pixel,inliers:match.inliers,error:match.error,estimated:true};
      }
    }
    postMessage({type:'result',request:message.request,mapId:reference.id,location,isMap:screen.mapOpen,local,
      miniScore:match?{inliers:match.inliers,error:match.error,cells:match.cells}:null,
      elapsedMs:Math.round(performance.now()-started),capturedAt:at});
  }finally{query?.descriptors.delete();bitmap.close();}
}
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(async()=>{
  try{
    if(data.type==='init')await init(data.map);
    else if(data.type==='reset'){gate.reset();localReference?.descriptors.delete();localReference=null;localCenter=null;}
    else if(data.type==='track')await track(data);
  }catch(error){postMessage({type:'error',request:data.request,message:String(error?.message||error)});}
});};
