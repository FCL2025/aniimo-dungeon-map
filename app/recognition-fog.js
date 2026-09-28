/* Sparse terrain from labelled initial-fog captures, in full-map coordinates. */
(function(root){
  'use strict';
  const PIXELS_PER_MAP_PIXEL_1080=.6315787701725338;
  function consensus(pairs,scale){
    if(pairs.length<8||!Number.isFinite(scale)||scale<=0)return null;
    const offsets=pairs.map(p=>[p.u-scale*p.x,p.v-scale*p.y]);let best=[];
    // With only a small entrance room visible, fitting zoom/rotation amplifies
    // subpixel corner errors at the distant side door. The default zoom gives
    // scale directly; estimate translation using terrain only, then test door.
    for(const [tx,ty] of offsets){
      const indices=[];for(let i=0;i<offsets.length;i++)if(Math.hypot(offsets[i][0]-tx,offsets[i][1]-ty)<3)indices.push(i);
      if(indices.length>best.length)best=indices;
    }
    if(best.length<8)return null;
    let tx=0,ty=0;
    for(let pass=0;pass<2;pass++){
      tx=best.reduce((n,i)=>n+offsets[i][0],0)/best.length;ty=best.reduce((n,i)=>n+offsets[i][1],0)/best.length;
      best=offsets.map((p,i)=>Math.hypot(p[0]-tx,p[1]-ty)<3?i:-1).filter(i=>i>=0);
      if(best.length<8)return null;
    }
    const inliers=best.map(i=>pairs[i]),xs=inliers.map(p=>p.x),ys=inliers.map(p=>p.y);
    return {model:{a:scale,b:0,tx,ty},inliers,
      cells:new Set(inliers.map(p=>Math.floor(p.u/80)+','+Math.floor(p.v/80))).size,
      area:(Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys)),
      error:best.reduce((n,i)=>n+Math.hypot(offsets[i][0]-tx,offsets[i][1]-ty),0)/best.length};
  }
  function valid(sample){
    return Number.isInteger(sample.id)&&Array.isArray(sample.points)&&sample.points.length>=8&&sample.points.length<=128&&
      sample.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))&&
      Array.isArray(sample.descriptors)&&sample.descriptors.length===sample.points.length*32&&
      sample.descriptors.every(v=>Number.isInteger(v)&&v>=0&&v<=255);
  }
  function sparse(pixels){
    const {width,height,data}=pixels;let floor=0,total=0;
    for(let y=Math.floor(height*.18);y<height*.94;y+=4)for(let x=Math.floor(width*.18);x<width*.98;x+=4){
      const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];total++;
      if(r>75&&g>65&&r-b>3&&r-b<45&&Math.abs(r-g)<25)floor++;
    }
    return total>0&&floor/total<.045;
  }
  function agrees(candidate,reference,exit,uiScale,references=[]){
    if(!candidate?.model||candidate.inliers<8||candidate.cells<2||candidate.area<150||candidate.error>2.5||!reference?.portals||!exit||!Number.isFinite(uiScale)||uiScale<=0)return false;
    const t=candidate.model,scale=Math.hypot(t.a,t.b),expected=1/(PIXELS_PER_MAP_PIXEL_1080*2*uiScale);
    if(Math.abs(scale/expected-1)>.04||Math.abs(Math.atan2(t.b,t.a))>3*Math.PI/180)return false;
    // The room and side door must fit one transform. A similar entrance room
    // from another dungeon is insufficient, even if its feature count is high.
    const [x,y]=exit,[u,v]=reference.portals.exit;
    const mapped=[t.a*x-t.b*y+t.tx,t.b*x+t.a*y+t.ty],error=Math.hypot(mapped[0]-u,mapped[1]-v);
    if(error>8)return false;
    // 20032/20058 differ by only about 10 screen pixels at 1080p. Check every
    // known door vector, including maps without a fog sample, before stopping.
    const observedVector=mapped.map((v,i)=>v-reference.portals.entrance[i]);
    for(const other of references){
      if(!other.portals)return false;
      if(other.id===candidate.id)continue;
      const delta=other.portals.exit.map((v,i)=>v-other.portals.entrance[i]);
      if(Math.hypot(observedVector[0]-delta[0],observedVector[1]-delta[1])-error<2)return false;
    }
    return true;
  }
  function choose(scores,compare){
    scores.sort(compare);const [best,second]=scores;
    if(!best||second&&(best.inliers-second.inliers<3||best.inliers<second.inliers*1.25))return null;
    return best;
  }
  class References {
    constructor(){this.items=[];this.geometry=[];}
    async init(references,enabled=true){
      if(!enabled)return;
      this.geometry=references;
      try{
        const data=await(await fetch('fog-references.json')).json();
        if(data.version!==1||!Array.isArray(data.samples)||!data.samples.every(valid))return;
        for(const sample of data.samples){
          const original=references.find(r=>r.id===sample.id);if(!original?.portals?.defaultDistance1080)continue;
          const descriptors=new cv.Mat(sample.points.length,32,cv.CV_8UC1);descriptors.data.set(sample.descriptors);
          this.items.push({id:sample.id,points:sample.points,descriptors,portals:original.portals});
        }
      }catch{for(const r of this.items)r.descriptors.delete();this.items=[];}
    }
    match(query,pixels,exit,uiScale,score,compare){
      if(!exit||!this.items.length||!sparse(pixels))return {best:null,evaluated:0};
      const verified=[];
      for(const reference of this.items){
        const candidate=score(query,reference,pairs=>consensus(pairs,1/(PIXELS_PER_MAP_PIXEL_1080*2*uiScale)));
        if(agrees(candidate,reference,exit,uiScale,this.geometry))verified.push(candidate);
      }
      return {best:choose(verified,compare),evaluated:this.items.length};
    }
  }
  const api={valid,sparse,consensus,agrees,choose,References};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MapFog=api;
})(typeof self==='object'?self:globalThis);
