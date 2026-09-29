/* Small screen checks shared by the UI and worker; no full map matching here. */
(function(root){
  'use strict';
  function correlation(a,b){
    const n=a.length,ma=a.reduce((s,v)=>s+v,0)/n,mb=b.reduce((s,v)=>s+v,0)/n;
    let ab=0,aa=0,bb=0;for(let i=0;i<n;i++){const x=a[i]-ma,y=b[i]-mb;ab+=x*y;aa+=x*x;bb+=y*y;}
    return aa&&bb?ab/Math.sqrt(aa*bb):0;
  }
  function relativeRegion(region,source=[0,0,1,1]){return [(region[0]-source[0])/source[2],(region[1]-source[1])/source[3],region[2]/source[2],region[3]/source[3]];}
  // Back arrow sampled from the same M-map capture as MAP_HEADER. Unlike the
  // title text, this part of the game UI does not depend on the selected language.
  const back={region:[65/1920,33/1080,67/1920,60/1080],width:8,height:8,values:[
    69,69,67,67,67,68,71,72,69,67,66,69,70,68,66,72,
    67,65,162,87,61,151,93,71,64,160,252,162,156,238,134,72,
    114,229,232,238,231,189,86,82,72,73,68,67,61,51,88,80,
    67,68,81,77,77,95,91,69,69,67,70,87,94,81,68,71
  ]};
  function inspect(bitmap,source=[0,0,1,1]){
    const spec=root.MAP_HEADER,canvas=new OffscreenCanvas(32,18),ctx=canvas.getContext('2d',{willReadFrequently:true});
    const [x,y,w,h]=spec.region;let headerScore=0;
    for(const dx of [-2,0,2])for(const dy of [-2,0,2]){
      const r=relativeRegion([x+dx/1920,y+dy/1080,w,h],source);
      ctx.drawImage(bitmap,r[0]*bitmap.width,r[1]*bitmap.height,r[2]*bitmap.width,r[3]*bitmap.height,0,0,32,18);
      const p=ctx.getImageData(0,0,32,18).data,values=[];
      for(let i=0;i<p.length;i+=4)values.push((p[i]+p[i+1]+p[i+2])/3);
      headerScore=Math.max(headerScore,correlation(values,spec.values));
    }
    // The title is localized. The back button beside it is the same visual
    // marker across languages, so an English M map still reaches recognition.
    let backScore=0,backOffset=0;
    const backCanvas=new OffscreenCanvas(back.width,back.height),backCtx=backCanvas.getContext('2d',{willReadFrequently:true});
    const [bx,by,bw,bh]=back.region;
    // Some window captures include a strip above the 1080p game content.
    // Search only the top edge, where the back button belongs.
    for(const dx of [-2,0,2])for(const dy of [-8,-4,0,4,8,12,16,20,24,28,32,36,40,44,48,52]){
      const r=relativeRegion([bx+dx/1920,by+dy/1080,bw,bh],source);
      backCtx.drawImage(bitmap,r[0]*bitmap.width,r[1]*bitmap.height,r[2]*bitmap.width,r[3]*bitmap.height,0,0,back.width,back.height);
      const p=backCtx.getImageData(0,0,back.width,back.height).data,values=[];
      for(let i=0;i<p.length;i+=4)values.push((p[i]+p[i+1]+p[i+2])/3);
      const score=correlation(values,back.values);
      if(score>backScore){backScore=score;backOffset=dy;}
    }
    ctx.drawImage(bitmap,0,0,32,18);const p=ctx.getImageData(0,0,32,18).data,signature=[];
    for(let i=0;i<p.length;i+=4)signature.push(Math.round((p[i]+p[i+1]+p[i+2])/60));
    return {mapOpen:headerScore>.64||backScore>.8,headerScore,backScore,backOffset,signature};
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
  const api={inspect,similar,correlation,FrameQueue,relativeRegion};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MapScreen=api;
})(typeof self==='object'?self:globalThis);
