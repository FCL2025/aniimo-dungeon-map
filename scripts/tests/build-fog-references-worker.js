/* Offline extraction from user-labelled screenshots; never run by the app. */
importScripts('../../app/vendor/opencv.js','../../app/recognition-core.js','../../app/recognition-vision.js','../../app/recognition-portals.js');
self.onmessage=async({data})=>{
  const portals=new MapPortals.Detector();
  try{
    await initialized;detector=new cv.ORB(1800,1.2,8,15,0,2,cv.ORB_HARRIS_SCORE,31,12);
    await portals.init(data.icons);const samples=[];
    for(const sample of data.samples){
      const bitmap=await decode(sample.image);let query;
      try{
        const big=crop(bitmap,[0,0,1,1]),uiScale=Math.min(bitmap.width/1920,bitmap.height/1080)*big.ratio;
        const observed=portals.detect(big.pixels,uiScale,true);
        if(!observed?.exit)throw Error('No reliable side door for '+sample.id);
        query=features(big.pixels);
        const g=MapPortals.geometry(sample.map),scale=1/(sample.pixelsPerMapPixel1080*2*uiScale);
        const model={a:scale,b:0,tx:g.exit[0]-scale*observed.exit[0],ty:g.exit[1]-scale*observed.exit[1]};
        const entrance=[(g.entrance[0]-model.tx)/scale/big.ratio,(g.entrance[1]-model.ty)/scale/big.ratio];
        const points=[],descriptors=[],sourcePoints=[],occupied=new Set();
        for(let i=0;i<query.points.length;i++){
          const [x,y]=query.points[i],sx=x/big.ratio,sy=y/big.ratio,[left,top,right,bottom]=sample.region;
          // Reserve a full ORB descriptor patch around player/door/team labels,
          // popup edges and fog boundaries. Only stable terrain enters the file.
          if(sx<left||sx>right||sy<top||sy>bottom||sample.exclude.some(([cx,cy,r])=>Math.hypot(sx-cx,sy-cy)<r))continue;
          const at=(Math.round(y)*big.width+Math.round(x))*4,p=big.pixels.data;
          if(p[at+2]>p[at]+5)continue; // Blue fog/background is shared between maps.
          const cell=Math.floor(sx/5)+','+Math.floor(sy/5);if(occupied.has(cell))continue;occupied.add(cell);
          points.push(MapRecognition.transform(model,x,y));sourcePoints.push([sx,sy]);
          descriptors.push(...query.descriptors.data.slice(i*32,(i+1)*32));
          if(points.length===128)break;
        }
        if(points.length<8||points.length>160)throw Error('Unexpected terrain feature count '+sample.id+': '+points.length);
        samples.push({id:sample.id,size:[bitmap.width,bitmap.height],points,descriptors,sourcePoints,entrance,exit:observed.exit.map(v=>v/big.ratio),model});
      }finally{query?.descriptors.delete();bitmap.close();}
    }
    postMessage({samples});
  }catch(error){postMessage({error:String(error.stack||error)});}
  finally{portals.dispose();detector?.delete();}
};
