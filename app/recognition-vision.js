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
function score(query,reference,estimate=MapRecognition.consensus){
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
  return {id:reference.id,model,inliers:inliers.length,cells,area,error,support:inliers.length/query.points.length,score:inliers.length+Math.min(20,cells)*1.5,
    spread:Math.max(...xs)-Math.min(...xs),coverage:Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))};
}
