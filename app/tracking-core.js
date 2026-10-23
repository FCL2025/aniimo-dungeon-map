(function(root){
  'use strict';
  class PositionGate {
    constructor(){this.reset();}
    reset(){this.last=null;this.pending=null;}
    accept(pixel,at,confirm=false){
      if(!Array.isArray(pixel)||pixel.length!==2||!pixel.every(v=>Number.isFinite(v)&&v>=0&&v<=2048)||!Number.isFinite(at))return false;
      if(this.last&&at<=this.last.at)return false;
      const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
      // Losing one or two frames must not remove the protection against jumps.
      // Two distinct consistent observations can still reacquire after a teleport.
      const elapsed=this.last?at-this.last.at:Infinity,limit=Math.min(160,32+elapsed*.24);
      if(confirm||this.last&&elapsed<5000&&distance(pixel,this.last.pixel)>limit){
        const pending=this.pending;
        if(pending&&at<=pending.at)return false;
        const dt=pending?at-pending.at:Infinity;
        const step=pending?distance(pixel,pending.pixel):Infinity;
        // Keep two nearby observations for stationary reacquisition. Moving
        // candidates need three frames with bounded speed and consistent velocity.
        // Units are 2048px base-map pixels and capture-time milliseconds.
        // Bound distance by capture time (at most 600px), so skipped frames do
        // not reject the same velocity merely for exceeding a fixed step size.
        const moving=!confirm&&pending&&!pending.confirm&&dt<=600&&step/dt<=1;
        const velocity=moving?pixel.map((v,i)=>(v-pending.pixel[i])/dt):null;
        const coherent=velocity&&pending.velocity&&
          Math.hypot(...velocity.map((v,i)=>(v-pending.velocity[i])*dt))<=Math.max(12,step*.25);
        if(!(pending&&dt<=600&&step<=45)&&!coherent){
          this.pending={pixel:[...pixel],at,velocity,confirm};return false;
        }
      }
      this.last={pixel:[...pixel],at};this.pending=null;return true;
    }
  }
  function validMatch(match,global=false){
    return !!(match&&match.inliers>=(global?12:8)&&match.cells>=(global?3:2)&&
      Number.isFinite(match.error)&&match.error<=(global?3:3.5)&&Number.isFinite(match.area)&&match.area>=180&&
      match.model&&['a','b','tx','ty'].every(k=>Number.isFinite(match.model[k]))&&
      Math.hypot(match.model.a,match.model.b)>=.15&&Math.hypot(match.model.a,match.model.b)<=10);
  }
  function consistentModel(model,previous){
    if(!previous)return true;
    const ratio=Math.hypot(model.a,model.b)/Math.hypot(previous.a,previous.b);
    const angle=Math.atan2(model.b,model.a)-Math.atan2(previous.b,previous.a);
    return ratio>=.8&&ratio<=1.25&&Math.abs(Math.atan2(Math.sin(angle),Math.cos(angle)))<=.2;
  }
  function nearbyPairs(pairs,model,radius){
    if(!model)return pairs;
    return pairs.filter(p=>Math.hypot(model.a*p.x-model.b*p.y+model.tx-p.u,model.b*p.x+model.a*p.y+model.ty-p.v)<=radius);
  }
  const api={PositionGate,validMatch,consistentModel,nearbyPairs};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MapTracking=api;
})(typeof self==='object'?self:globalThis);
