(function(root){
  'use strict';
  class PositionGate {
    constructor(){this.reset();}
    reset(){this.last=null;this.pending=null;}
    accept(pixel,at){
      if(!pixel?.every(v=>Number.isFinite(v)&&v>=0&&v<=2048)||!Number.isFinite(at))return false;
      if(this.last&&at<=this.last.at)return false;
      const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
      if(this.last&&at-this.last.at<1500&&distance(pixel,this.last.pixel)>160){
        if(!this.pending||at-this.pending.at>600||distance(pixel,this.pending.pixel)>45){this.pending={pixel,at};return false;}
      }
      this.last={pixel,at};this.pending=null;return true;
    }
  }
  const api={PositionGate};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MapTracking=api;
})(typeof self==='object'?self:globalThis);
