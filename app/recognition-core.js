/* Geometry and temporal evidence, shared by the worker and offline regression checks. */
(function(root){
  'use strict';
  // Rank by the same geometric inlier count shown in the candidate list.
  const compareCandidates=(a,b)=>b.inliers-a.inliers||b.score-a.score||a.id-b.id;
  function terrainConfirmation(results,complete){
    if(!complete)return null;
    const [best,second]=results.filter(r=>r.inliers>=6&&r.cells>=2).sort(compareCandidates);
    // Without reliable doors, require terrain across a sizeable part of the map
    // and a clear lead after checking every reference. A shared entrance room
    // or a large count concentrated in one room must remain a preview.
    if(!best||best.inliers<12||best.cells<6||!Number.isFinite(best.support)||best.support<.08||!Number.isFinite(best.coverage)||best.coverage<240||
      !Number.isFinite(best.error)||best.error>3)return null;
    if(second&&(best.inliers-second.inliers<8||best.inliers<second.inliers*1.35))return null;
    return {id:best.id,method:'terrain'};
  }
  function transform(t,x,y){return [t.a*x-t.b*y+t.tx,t.b*x+t.a*y+t.ty];}
  function fit(pairs){
    if(pairs.length<2)return null;
    let sx=0,sy=0,dx=0,dy=0;
    for(const p of pairs){sx+=p.x;sy+=p.y;dx+=p.u;dy+=p.v;}
    const n=pairs.length;sx/=n;sy/=n;dx/=n;dy/=n;
    let den=0,aa=0,bb=0;
    for(const p of pairs){const x=p.x-sx,y=p.y-sy,u=p.u-dx,v=p.v-dy;den+=x*x+y*y;aa+=x*u+y*v;bb+=x*v-y*u;}
    if(den<1)return null;
    const a=aa/den,b=bb/den;
    return {a,b,tx:dx-a*sx+b*sy,ty:dy-b*sx-a*sy};
  }
  function residual(t,p){const [u,v]=transform(t,p.x,p.y);return Math.hypot(u-p.u,v-p.v);}
  function consensus(pairs,threshold=7){
    if(pairs.length<5)return null;
    let best=[],model=null,seed=12345;
    const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/pow;},pow=4294967296;
    for(let i=0;i<Math.min(700,pairs.length*18);i++){
      const p=pairs[Math.floor(rand()*pairs.length)],q=pairs[Math.floor(rand()*pairs.length)];
      if(Math.hypot(p.x-q.x,p.y-q.y)<24)continue;
      const t=fit([p,q]);if(!t)continue;
      const scale=Math.hypot(t.a,t.b);if(scale<0.15||scale>10)continue;
      const inliers=pairs.filter(p=>residual(t,p)<threshold);
      if(inliers.length>best.length){best=inliers;model=t;}
    }
    if(best.length<5)return null;
    model=fit(best);best=pairs.filter(p=>residual(model,p)<threshold);model=fit(best);
    if(!model)return null;
    const cells=new Set(best.map(p=>`${Math.floor(p.u/80)},${Math.floor(p.v/80)}`));
    const xs=best.map(p=>p.x),ys=best.map(p=>p.y);
    const area=(Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys));
    return {model,inliers:best,cells:cells.size,area,error:best.reduce((n,p)=>n+residual(model,p),0)/best.length};
  }
  class Evidence {
    constructor(){this.reset();}
    reset(){this.frames=[];this.locked=null;this.manual=false;this.preview=null;this.previewMatches=0;this.lockedMatches=0;this.lockReason=null;}
    pin(id){this.reset();this.locked=id;this.manual=true;}
    observe(results,signature,kind,confirmation=null){
      const ranked=results.filter(r=>r.inliers>=6&&r.cells>=2).sort(compareCandidates);
      const best=ranked[0];
      if(kind==='map'&&best){
        if(!this.frames.includes(signature)){this.frames.push(signature);if(this.frames.length>8)this.frames.shift();}
        if(!this.locked){
          this.preview=best.id;this.previewMatches=best.inliers;
          if(confirmation?.id===best.id&&['terrain-and-portals','terrain-and-side-door','terrain'].includes(confirmation.method)){
            this.locked=best.id;this.lockedMatches=best.inliers;this.lockReason=confirmation.method;
          }
        }
      }
      return {ranked:ranked.slice(0,5),locked:this.locked,manual:this.manual,preview:this.preview,
        selected:this.locked||this.preview,previewMatches:this.previewMatches,lockedMatches:this.lockedMatches,lockReason:this.lockReason,
        state:this.locked?'locked':this.preview?'preview':'waiting',observations:this.frames.length};
    }
  }
  const api={transform,fit,residual,consensus,Evidence,compareCandidates,terrainConfirmation};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MapRecognition=api;
})(typeof self==='object'?self:globalThis);
