'use strict';
importScripts('vendor/opencv.js','recognition-core.js','map-header.js','recognition-screen.js','recognition-vision.js','tracking-core.js','tracking-flow.js');
let reference,queryDetector,localReference,localCenter,localRadius=0,lastModel=null,lastSize=null,flow=null;
const gate=new MapTracking.PositionGate();
async function init(map){
  await initialized;
  detector=new cv.ORB(7000,1.2,8,12,0,2,cv.ORB_HARRIS_SCORE,31,9);
  queryDetector=new cv.ORB(1200,1.2,8,9,0,2,cv.ORB_HARRIS_SCORE,31,9);
  matcher=new cv.BFMatcher(cv.NORM_HAMMING,false);
  flow=new MapTrackingFlow.TerrainFlow(cv,MapRecognition);
  const bitmap=await decode(map.image),canvas=new OffscreenCanvas(1024,1024),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#172731';ctx.fillRect(0,0,1024,1024);ctx.drawImage(bitmap,0,0,1024,1024);bitmap.close();
  reference={id:map.id,...features(ctx.getImageData(0,0,1024,1024))};
  postMessage({type:'ready',mapId:map.id,features:reference.points.length});
}
function nearbyReference(radius,predictedCenter){
  if(!gate.last)return null;
  const center=predictedCenter||gate.last.pixel.map(v=>v/2);
  if(localCenter&&Math.hypot(center[0]-localCenter[0],center[1]-localCenter[1])<radius*.25&&Math.abs(radius-localRadius)<20)return localReference;
  localReference?.descriptors.delete();localReference=null;localCenter=center;localRadius=radius;
  const ids=[];reference.points.forEach((p,i)=>{if(Math.abs(p[0]-center[0])<radius&&Math.abs(p[1]-center[1])<radius)ids.push(i);});
  if(ids.length<12)return null;
  const descriptors=new cv.Mat(ids.length,32,cv.CV_8UC1),source=reference.descriptors.data;
  ids.forEach((id,i)=>descriptors.data.set(source.subarray(id*32,id*32+32),i*32));
  return localReference={id:reference.id,points:ids.map(i=>reference.points[i]),descriptors};
}
async function track(message){
  const started=performance.now(),bitmap=await decode(message.image);let query;
  try{
    const screen=MapScreen.inspect(bitmap,message.sourceRegion,message.aspect),at=message.capturedAt||Date.now();
    let location=null,match=null,local=false,relocalizing=false,motion=null,reason='map-open',featureCount=0,jump=null,candidate=null;
    const frameDeltaMs=gate.last?at-gate.last.at:null;
    if(!screen.mapOpen){
      const region=MapScreen.relativeRegion(message.miniRegion||MapScreen.defaultMini(message.aspect),message.sourceRegion);
      const mini=crop(bitmap,region,400,true);query=features(mini.pixels,true,queryDetector);
      featureCount=query.points?.length||0;
      motion=flow?.begin(mini.pixels,at);
      const age=gate.last?at-gate.last.at:Infinity;
      const sameSize=lastSize&&Math.abs(mini.width-lastSize[0])<2&&Math.abs(mini.height-lastSize[1])<2;
      const prediction=motion?.valid?motion.model:sameSize&&age<1500?lastModel:null;
      const radius=prediction?Math.min(210,Math.max(90,Math.max(mini.width,mini.height)*Math.hypot(prediction.a,prediction.b)*.65+50)):210;
      const nearby=age<1500?nearbyReference(radius,motion?.valid?motion.pixel.map(v=>v/2):null):null;
      if(nearby){
        const movement=motion?.valid?16:Math.min(80,24+Math.max(0,age)*.12);
        match=score(query,nearby,pairs=>MapRecognition.consensus(MapTracking.nearbyPairs(pairs,prediction,movement),4),true);
        local=MapTracking.validMatch(match)&&MapTracking.consistentModel(match.model,prediction);
      }
      if(!local)match=score(query,reference,pairs=>MapRecognition.consensus(pairs,4),true);
      reason=featureCount<8?'insufficient-terrain':'no-map-match';
      if(MapTracking.validMatch(match,!local)){
        const pixel=MapRecognition.transform(match.model,mini.width/2,mini.height/2).map(v=>v*2);
        candidate=pixel;
        jump=gate.last?Math.round(Math.hypot(pixel[0]-gate.last.pixel[0],pixel[1]-gate.last.pixel[1])):null;
        relocalizing=!local&&!!lastModel&&(!sameSize||!MapTracking.consistentModel(match.model,lastModel));
        reason=relocalizing?'transform-confirmation':'jump-rejected';
        if(gate.accept(pixel,at,relocalizing,motion)){
          lastModel={...match.model};lastSize=[mini.width,mini.height];
          location={mapId:reference.id,pixel,inliers:match.inliers,error:match.error,estimated:true,method:'map'};
          reason='map-match';flow?.commit(match.model,match.observed,at);
        }
      }else if(motion?.valid&&gate.accept(motion.pixel,at,false,motion)){
        lastModel={...motion.model};lastSize=[mini.width,mini.height];
        location={mapId:reference.id,pixel:motion.pixel,inliers:motion.inliers,error:motion.error,estimated:true,method:'flow'};
        reason='optical-flow';flow.commit(motion.model,motion.observed,motion.anchorAt);
      }
    }
    if(!location)flow?.reset();
    if(screen.mapOpen||reason==='insufficient-terrain')gate.pending=null;
    postMessage({type:'result',request:message.request,frameSequence:message.frameSequence,mapId:reference.id,location,isMap:screen.mapOpen,local,
      miniScore:match?{inliers:match.inliers,error:match.error,cells:match.cells,area:match.area}:null,relocalizing,
      diagnostic:{reason,featureCount,jump,frameDeltaMs,candidate,position:location?.pixel||null,
        flow:motion?{valid:motion.valid,reason:motion.reason,inliers:motion.inliers,ratio:motion.ratio,error:motion.error}:null},
      elapsedMs:Math.round(performance.now()-started),capturedAt:at});
  }finally{query?.descriptors.delete();bitmap.close();}
}
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(async()=>{
  try{
    if(data.type==='init')await init(data.map);
    else if(data.type==='reset'){gate.reset();flow?.reset();localReference?.descriptors.delete();localReference=null;localCenter=null;lastModel=null;lastSize=null;localRadius=0;}
    else if(data.type==='track')await track(data);
  }catch(error){flow?.reset();postMessage({type:'error',request:data.request,message:String(error?.message||error)});}
});};
