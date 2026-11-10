/* Fixed portal geometry narrows the search; terrain still decides the result. */
(function(root){
  'use strict';
  const KINDS=['entrance','exit'];
  function geometry(map){
    const g=map.portalGeometry,size=map.size;
    if(!g||!Array.isArray(size)||size.length!==2||!size.every(v=>Number.isFinite(v)&&v>0))return null;
    const result={};
    for(const kind of KINDS){
      const p=g[kind];if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))return null;
      result[kind]=p.map((v,i)=>v*1024/size[i]);
    }
    const dx=result.exit[0]-result.entrance[0],dy=result.exit[1]-result.entrance[1];
    const defaultDistance1080=Number.isFinite(g.defaultDistance1080)&&g.defaultDistance1080>0?g.defaultDistance1080:null;
    // Entrance-to-exit on a 1080p screen at the default farthest zoom, from the
    // original map pixels so a non-square map keeps its true direction.
    const ox=g.exit[0]-g.entrance[0],oy=g.exit[1]-g.entrance[1],original=Math.hypot(ox,oy);
    return {...result,distance:Math.hypot(dx,dy),angle:Math.atan2(dy,dx),defaultDistance1080,
      vector1080:defaultDistance1080&&original>0?[ox*defaultDistance1080/original,oy*defaultDistance1080/original]:null};
  }
  // Door-vector tolerance in 1080p pixels: icon centres are found at half
  // resolution and the player's arrow covers part of the front door.
  const vectorTolerance=vector=>Math.max(14,Math.hypot(...vector)*.03);
  // Where each dungeon's front door must be, given the side door. Both doors are
  // fixed map pins, so only the UI scale changes the vector between them; pans,
  // window position and exploration do not. With a detected front door only
  // dungeons whose vector agrees remain; otherwise every dungeon is a hypothesis.
  function doorHypotheses(references,observed,uiScale){
    if(!observed?.exit||!Number.isFinite(uiScale)||uiScale<=0)return {matched:false,items:[]};
    const items=[];
    for(const reference of references){
      const v=reference.portals?.vector1080;if(!v)continue;
      const entrance=[observed.exit[0]-v[0]*uiScale,observed.exit[1]-v[1]*uiScale];
      const error=observed.entrance?Math.hypot(observed.entrance[0]-entrance[0],observed.entrance[1]-entrance[1])/uiScale:null;
      items.push({id:reference.id,entrance,error,tolerance:vectorTolerance(v)});
    }
    const matched=items.filter(h=>h.error!==null&&h.error<=h.tolerance).sort((a,b)=>a.error-b.error);
    return matched.length?{matched:true,items:matched}:{matched:false,items};
  }
  // Minimum separation between two dungeons' door vectors, in 1080p pixels.
  function vectorSeparation(references){
    let best=Infinity;
    for(let i=0;i<references.length;i++)for(let j=i+1;j<references.length;j++){
      const a=references[i].portals?.vector1080,b=references[j].portals?.vector1080;
      if(a&&b)best=Math.min(best,Math.hypot(a[0]-b[0],a[1]-b[1]));
    }
    return best;
  }
  function defaultShortlist(references,observed,uiScale){
    if(!observed||!Number.isFinite(uiScale)||uiScale<=0||references.some(r=>!r.portals?.defaultDistance1080))return [];
    const distance=Math.hypot(observed.exit[0]-observed.entrance[0],observed.exit[1]-observed.entrance[1])/uiScale;
    // The user's normal view is the default farthest zoom. Allow icon-center
    // and rasterization error instead of selecting a single nearest distance.
    const near=references.filter(r=>Math.abs(distance-r.portals.defaultDistance1080)<=Math.max(14,r.portals.defaultDistance1080*.03));
    return shortlist(near,observed).sort((a,b)=>Math.abs(distance-a.portals.defaultDistance1080)-Math.abs(distance-b.portals.defaultDistance1080));
  }
  function shortlist(references,observed){
    if(!observed||references.some(r=>!r.portals))return [];
    const dx=observed.exit[0]-observed.entrance[0],dy=observed.exit[1]-observed.entrance[1];
    const distance=Math.hypot(dx,dy),angle=Math.atan2(dy,dx);
    if(!Number.isFinite(distance)||distance<60)return [];
    // Direction survives zoom, translation and resolution changes. A screen-pixel
    // distance alone cannot exclude a map when its zoom is unknown.
    return references.filter(r=>{
      const delta=Math.abs(Math.atan2(Math.sin(angle-r.portals.angle),Math.cos(angle-r.portals.angle)));
      const scale=r.portals.distance/distance;
      return delta<=8*Math.PI/180&&scale>=.15&&scale<=10;
    });
  }
  function agrees(candidate,reference,observed,references=[]){
    if(!candidate?.model||candidate.inliers<8||candidate.cells<3||!reference?.portals||!observed)return false;
    if(Number.isFinite(candidate.error)&&candidate.error>3.5)return false;
    const t=candidate.model,tolerance=Math.max(12,Math.min(20,reference.portals.distance*.03));
    if(!KINDS.every(kind=>{
      const [x,y]=observed[kind],[u,v]=reference.portals[kind];
      return Math.hypot(t.a*x-t.b*y+t.tx-u,t.b*x+t.a*y+t.ty-v)<=tolerance;
    }))return false;
    const dx=observed.exit[0]-observed.entrance[0],dy=observed.exit[1]-observed.entrance[1];
    const vector=[t.a*dx-t.b*dy,t.b*dx+t.a*dy];
    const errorTo=r=>Math.hypot(vector[0]-(r.portals.exit[0]-r.portals.entrance[0]),vector[1]-(r.portals.exit[1]-r.portals.entrance[1]));
    const error=errorTo(reference);
    // Check even references not yet scored: nearly identical door vectors must
    // not let a shared room lock the first map visited by the search.
    return references.every(r=>r.id===reference.id||r.portals&&errorTo(r)-error>=2);
  }
  function chroma(pixels,kind){
    const mat=new cv.Mat(pixels.height,pixels.width,cv.CV_8UC1),p=pixels.data,out=mat.data;
    for(let i=0,j=0;i<p.length;i+=4,j++){
      out[j]=kind==='exit'?Math.max(0,p[i+2]-p[i]):Math.max(0,Math.min(p[i],p[i+1]*1.35)-p[i+2]);
    }
    return mat;
  }
  // Restrict template matching to small colored components (doors, player arrows,
  // team labels). Fog and gray terrain don't require a sliding-window search.
  function regions(mat,padding){
    const w=mat.cols,h=mat.rows,data=mat.data,seen=new Uint8Array(w*h),stack=[],boxes=[];
    for(let index=0;index<seen.length;index++){
      if(seen[index]||data[index]<45)continue;
      let minX=w,minY=h,maxX=0,maxY=0,count=0;
      stack.push(index);seen[index]=1;
      while(stack.length){
        const at=stack.pop(),x=at%w,y=Math.floor(at/w);count++;
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        for(let yy=Math.max(0,y-1);yy<=Math.min(h-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(w-1,x+1);xx++){
          const next=yy*w+xx;if(!seen[next]&&data[next]>=45){seen[next]=1;stack.push(next);}
        }
      }
      if(count<6||maxX-minX>padding*2||maxY-minY>padding*2)continue;
      const box={x:Math.max(0,minX-padding),y:Math.max(0,minY-padding),right:Math.min(w,maxX+padding+1),bottom:Math.min(h,maxY+padding+1)};
      if(boxes.some(b=>box.x>=b.x&&box.y>=b.y&&box.right<=b.right&&box.bottom<=b.bottom))continue;
      boxes.push(box);
      if(boxes.length>32)return []; // Busy/unsupported UI: use the full terrain search.
    }
    return boxes;
  }
  class Detector {
    constructor(){this.templates=[];}
    async init(icons){
      if(!icons)return;
      try{
        for(const kind of KINDS){
          const bitmap=await createImageBitmap(await (await fetch(icons[kind])).blob());
          try{
            for(const height of [36,40,44]){
              const width=Math.round(height*bitmap.width/bitmap.height),canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
              ctx.fillStyle='#454d61';ctx.fillRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);
              // The player's arrow commonly covers the lower half of the front
              // door. Its crown and upper arch remain visible in the initial fog.
              const visibleHeight=kind==='entrance'?Math.round(height*.5):height;
              this.templates.push({kind,width,height,mat:chroma(ctx.getImageData(0,0,width,visibleHeight),kind)});
            }
          }finally{bitmap.close();}
        }
      }catch{this.dispose();} // Optional hint: missing icons must not disable recognition.
    }
    dispose(){for(const t of this.templates)t.mat.delete();this.templates=[];}
    // pixels: the frame at analysis size. original {image,region} (optional) is the
    // decoded capture and the region pixels came from; drawing it directly avoids
    // re-uploading the analysis pixels just to shrink them again.
    detect(pixels,uiScale,partial=false,original=null){
      if(!this.templates.length||!Number.isFinite(uiScale)||uiScale<=0)return null;
      // Normalize UI size, retaining aspect ratio. The original capture may
      // already have been downscaled by the native capture backend.
      const ratio=Math.min(.5/uiScale,1200/pixels.width),width=Math.round(pixels.width*ratio),height=Math.round(pixels.height*ratio);
      if(width<48||height<48||ratio*uiScale<.4)return null;
      const t0=performance.now(),timing=this.timing={};
      const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(original){
        ctx.drawImage(original.image,...original.region,0,0,width,height);
        // Same HUD corner as crop() hides at analysis size.
        if(original.maskHud){ctx.fillStyle='#14212c';ctx.fillRect(0,0,Math.round(height*.32),Math.round(height*.28));}
      }else{
        const source=new OffscreenCanvas(pixels.width,pixels.height);source.getContext('2d').putImageData(pixels,0,0);
        ctx.drawImage(source,0,0,width,height);
      }
      const image=ctx.getImageData(0,0,width,height),observed={};timing.resize=performance.now()-t0;
      for(const kind of KINDS){
        let t=performance.now();const mat=chroma(image,kind),hits=[];timing[kind+'Chroma']=performance.now()-t;
        try{
          t=performance.now();const boxes=regions(mat,48);timing[kind+'Regions']=performance.now()-t;timing[kind+'Boxes']=boxes.length;t=performance.now();
          for(const box of boxes){
            const roi=mat.roi(new cv.Rect(box.x,box.y,box.right-box.x,box.bottom-box.y));
            try{
              for(const t of this.templates.filter(t=>t.kind===kind)){
                if(roi.cols<t.mat.cols||roi.rows<t.mat.rows)continue;
                const result=new cv.Mat();
                try{
                  cv.matchTemplate(roi,t.mat,result,cv.TM_CCOEFF_NORMED);
                  // Keep a second distinct peak so an ambiguous icon falls back.
                  for(let n=0;n<2;n++){
                    const best=cv.minMaxLoc(result);
                    if(best.maxVal<(kind==='exit'?.78:.74))break;
                    hits.push({score:best.maxVal,x:box.x+best.maxLoc.x+t.width/2,y:box.y+best.maxLoc.y+t.height/2});
                    cv.rectangle(result,new cv.Point(Math.max(0,best.maxLoc.x-24),Math.max(0,best.maxLoc.y-24)),
                      new cv.Point(Math.min(result.cols-1,best.maxLoc.x+24),Math.min(result.rows-1,best.maxLoc.y+24)),new cv.Scalar(-1),-1);
                  }
                }finally{result.delete();}
              }
            }finally{roi.delete();}
          }
        }finally{mat.delete();timing[kind+'Match']=performance.now()-t;}
        hits.sort((a,b)=>b.score-a.score);const best=hits[0];if(!best){if(partial)continue;return null;}
        const second=hits.find(h=>Math.hypot(h.x-best.x,h.y-best.y)>24);
        // The partial gold template has a smaller score margin under occlusion;
        // the independent terrain-to-door check remains mandatory in either case.
        if(second&&best.score-second.score<(kind==='entrance'?.04:.06)){if(partial)continue;return null;}
        observed[kind]=[best.x/ratio,best.y/ratio];
      }
      return observed.exit?observed:null;
    }
  }
  const api={geometry,shortlist,defaultShortlist,agrees,doorHypotheses,vectorSeparation,vectorTolerance,Detector};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MapPortals=api;
})(typeof self==='object'?self:globalThis);
