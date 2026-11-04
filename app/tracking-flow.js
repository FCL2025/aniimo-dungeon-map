/* Short optical-flow bridges, seeded only by terrain verified against the map. */
(function(root){
  'use strict';
  const MAX_BRIDGE_MS=600;
  function inside(x,y,w,h){
    const r=Math.min(w,h)*.43,d=Math.hypot(x-w/2,y-h/2);
    return Number.isFinite(d)&&d<r-4&&d>r*.24+4;
  }
  function spread(points,w,h){
    if(points.length<10)return false;
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const dx=Math.max(...xs)-Math.min(...xs),dy=Math.max(...ys)-Math.min(...ys);
    const cells=new Set(points.map(([x,y])=>`${Math.floor(x*3/w)},${Math.floor(y*3/h)}`));
    return dx>=w*.25&&dy>=h*.25&&dx*dy>=w*h*.08&&cells.size>=3;
  }
  function composeInverse(base,motion){
    const den=motion.a*motion.a+motion.b*motion.b;
    if(!Number.isFinite(den)||den<1e-8)return null;
    const a=motion.a/den,b=-motion.b/den;
    const tx=-a*motion.tx+b*motion.ty,ty=-b*motion.tx-a*motion.ty;
    return {a:base.a*a-base.b*b,b:base.b*a+base.a*b,
      tx:base.a*tx-base.b*ty+base.tx,ty:base.b*tx+base.a*ty+base.ty};
  }
  class TerrainFlow {
    constructor(cv,geometry){this.cv=cv;this.geometry=geometry;this.last=null;this.current=null;}
    reset(){this.last?.gray.delete();this.current?.gray.delete();this.last=null;this.current=null;}
    begin(pixels,at){
      const cv=this.cv;
      this.current?.gray.delete();this.current=null;
      const rgba=cv.matFromImageData(pixels),gray=new cv.Mat();
      try{cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);}catch(error){gray.delete();throw error;}finally{rgba.delete();}
      this.current={gray,at,width:pixels.width,height:pixels.height};
      const old=this.last,w=pixels.width,h=pixels.height;
      const no=reason=>({valid:false,reason});
      if(!old)return no('no-anchor');
      const dt=at-old.at;
      if(dt<=0||dt>MAX_BRIDGE_MS||at-old.anchorAt>MAX_BRIDGE_MS)return no('expired');
      if(w!==old.width||h!==old.height)return no('size-change');
      const mats=[],mat=()=>{const m=new cv.Mat();mats.push(m);return m;};
      try{
        const p0=cv.matFromArray(old.points.length,1,cv.CV_32FC2,old.points.flat());mats.push(p0);
        const p1=mat(),forward=mat(),error=mat(),back=mat(),backStatus=mat(),backError=mat();
        const win=new cv.Size(21,21),criteria=new cv.TermCriteria(cv.TermCriteria_EPS|cv.TermCriteria_COUNT,30,.01);
        cv.calcOpticalFlowPyrLK(old.gray,gray,p0,p1,forward,error,win,3,criteria);
        cv.calcOpticalFlowPyrLK(gray,old.gray,p1,back,backStatus,backError,win,3,criteria);
        const pairs=[];
        for(let i=0;i<old.points.length;i++){
          const [x,y]=old.points[i],u=p1.data32F[i*2],v=p1.data32F[i*2+1];
          if(forward.data[i]&&backStatus.data[i]&&error.data32F[i]<=12&&backError.data32F[i]<=12&&
            Math.hypot(back.data32F[i*2]-x,back.data32F[i*2+1]-y)<=1.2&&inside(u,v,w,h))pairs.push({x,y,u,v});
        }
        const fit=this.geometry.consensus(pairs,1.5);
        const points=fit?.inliers.map(p=>[p.u,p.v])||[];
        const count=points.length,ratio=count/old.points.length;
        const stats={points:old.points.length,inliers:count,ratio,error:fit?.error??null};
        if(!fit||ratio<.6||fit.error>1||!spread(points,w,h))return {...no('weak-flow'),...stats};
        const scale=Math.hypot(fit.model.a,fit.model.b),angle=Math.atan2(fit.model.b,fit.model.a);
        if(scale<.94||scale>1.06||Math.abs(angle)>.12)return {...no('transform-change'),...stats};
        const model=composeInverse(old.model,fit.model);
        const pixel=this.geometry.transform(model,w/2,h/2).map(v=>v*2);
        const previous=this.geometry.transform(old.model,w/2,h/2).map(v=>v*2);
        if(!pixel.every(v=>Number.isFinite(v)&&v>=0&&v<=2048)||Math.hypot(pixel[0]-previous[0],pixel[1]-previous[1])/dt>1)
          return {...no('excessive-motion'),...stats};
        return {valid:true,reason:'tracked',...stats,model,pixel,observed:points,at,fromAt:old.at,anchorAt:old.anchorAt};
      }finally{for(const m of mats)m.delete();}
    }
    commit(model,observed,anchorAt){
      const frame=this.current;
      if(!frame){this.reset();return;}
      const points=[];
      for(const [x,y] of observed||[]){
        if(inside(x,y,frame.width,frame.height)&&points.every(p=>Math.hypot(p[0]-x,p[1]-y)>=7))points.push([x,y]);
        if(points.length>=100)break;
      }
      if(!spread(points,frame.width,frame.height)){this.reset();return;}
      this.last?.gray.delete();
      this.last={...frame,model:{...model},points,anchorAt};this.current=null;
    }
  }
  const api={TerrainFlow,composeInverse,MAX_BRIDGE_MS};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MapTrackingFlow=api;
})(typeof self==='object'?self:globalThis);
