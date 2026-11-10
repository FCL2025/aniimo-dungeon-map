'use strict';
// Shared OpenCV helpers; each worker owns its own engine and reference data.
let detector,matcher;
const initialized=new Promise(resolve=>cv.then(()=>resolve()));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function features(imageData,circle=false,engine=detector){
  const rgba=cv.matFromImageData(imageData),gray=new cv.Mat(),mask=new cv.Mat(),points=new cv.KeyPointVector(),descriptors=new cv.Mat();
  try{
    cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);
    if(circle){
      mask.create(gray.rows,gray.cols,cv.CV_8UC1);mask.setTo(new cv.Scalar(0));
      const center=new cv.Point(gray.cols/2,gray.rows/2),r=Math.min(gray.cols,gray.rows)*.43;
      cv.circle(mask,center,Math.round(r),new cv.Scalar(255),-1);
      cv.circle(mask,center,Math.round(r*.24),new cv.Scalar(0),-1);
    }
    engine.detectAndCompute(gray,mask,points,descriptors);
    const coords=[];for(let i=0;i<points.size();i++){const p=points.get(i).pt;coords.push([p.x,p.y]);}
    return {points:coords,descriptors};
  }catch(error){descriptors.delete();throw error;}
  finally{rgba.delete();gray.delete();mask.delete();points.delete();}
}
// The start-room window: fog references cover 120 px around the entrance at
// 1080p; the margin keeps those keypoints clear of ORB's pyramid border.
const START_ROOM_WINDOW_1080=190;
function windowFeatures(pixels,center,radius,engine=detector){
  const x0=clamp(Math.round(center[0]-radius),0,pixels.width),y0=clamp(Math.round(center[1]-radius),0,pixels.height);
  const x1=clamp(Math.round(center[0]+radius),0,pixels.width),y1=clamp(Math.round(center[1]+radius),0,pixels.height);
  const width=x1-x0,height=y1-y0;if(width<48||height<48)return null;
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)data.set(pixels.data.subarray(((y0+y)*pixels.width+x0)*4,((y0+y)*pixels.width+x1)*4),y*width*4);
  const result=features({width,height,data},false,engine);
  result.points=result.points.map(([x,y])=>[x+x0,y+y0]);result.window=[x0,y0,width,height];
  return result;
}
async function decode(source){
  if(typeof ImageBitmap!=='undefined'&&source instanceof ImageBitmap)return source;
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
  if(!circle&&region[2]>.9){
    const right=Math.min(width,Math.round(height*.32)),bottom=Math.min(height,Math.round(height*.28)),data=pixels.data;
    for(let yy=0;yy<bottom;yy++)for(let i=yy*width*4,end=i+right*4;i<end;i+=4){data[i]=0x14;data[i+1]=0x21;data[i+2]=0x2c;data[i+3]=255;}
  }
  return {pixels,width,height,ratio,region:[x,y,w,h]};
}
function score(query,reference,estimate=MapRecognition.consensus,includeObserved=false){
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
  const result=estimate(pairs);
  if(!result)return null;
  const {model,inliers,cells,area,error}=result;
  const xs=inliers.map(p=>p.u),ys=inliers.map(p=>p.v);
  return {id:reference.id,model,inliers:inliers.length,cells,area,error,...(includeObserved?{observed:inliers.map(p=>[p.x,p.y])}:{}),support:inliers.length/query.points.length,score:inliers.length+Math.min(20,cells)*1.5,
    spread:Math.max(...xs)-Math.min(...xs),coverage:Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))};
}
