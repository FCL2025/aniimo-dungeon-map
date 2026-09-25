/* Small screen checks shared by the UI and worker; no full map matching here. */
(function(root){
  'use strict';
  function correlation(a,b){
    const n=a.length,ma=a.reduce((s,v)=>s+v,0)/n,mb=b.reduce((s,v)=>s+v,0)/n;
    let ab=0,aa=0,bb=0;for(let i=0;i<n;i++){const x=a[i]-ma,y=b[i]-mb;ab+=x*y;aa+=x*x;bb+=y*y;}
    return aa&&bb?ab/Math.sqrt(aa*bb):0;
  }
  function inspect(bitmap){
    const spec=root.MAP_HEADER,canvas=new OffscreenCanvas(32,18),ctx=canvas.getContext('2d',{willReadFrequently:true});
    const [x,y,w,h]=spec.region;let headerScore=0;
    for(const dx of [-2,0,2])for(const dy of [-2,0,2]){
      ctx.drawImage(bitmap,(x+dx/1920)*bitmap.width,(y+dy/1080)*bitmap.height,w*bitmap.width,h*bitmap.height,0,0,32,18);
      const p=ctx.getImageData(0,0,32,18).data,values=[];
      for(let i=0;i<p.length;i+=4)values.push((p[i]+p[i+1]+p[i+2])/3);
      headerScore=Math.max(headerScore,correlation(values,spec.values));
    }
    ctx.drawImage(bitmap,0,0,32,18);const p=ctx.getImageData(0,0,32,18).data,signature=[];
    for(let i=0;i<p.length;i+=4)signature.push(Math.round((p[i]+p[i+1]+p[i+2])/60));
    return {mapOpen:headerScore>.64,headerScore,signature};
  }
  function similar(a,b){
    if(!a||!b||a.length!==b.length)return false;
    let changed=0;for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1)changed++;
    return changed/a.length<.018;
  }
  // Keep at most three distinct M frames; gameplay never evicts a captured M map.
  class FrameQueue {
    constructor(){this.clear();}
    clear(){this.items=[];this.previous=null;}
    push(frame){
      if(frame.source!=='import'&&frame.mapOpen&&this.previous?.mapOpen&&similar(frame.signature,this.previous.signature))return false;
      this.previous=frame;
      if(frame.source!=='import'&&!frame.mapOpen){
        if(this.items.some(f=>f.mapOpen||f.source==='import'))return false;
        this.items=[frame];return true;
      }
      this.items=this.items.filter(f=>f.mapOpen||f.source==='import');
      if(this.items.length===3)this.items[2]=frame;else this.items.push(frame);
      return true;
    }
    shift(){return this.items.shift();}
  }
  const api={inspect,similar,correlation,FrameQueue};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MapScreen=api;
})(typeof self==='object'?self:globalThis);
