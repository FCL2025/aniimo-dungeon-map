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
  // Estimate the facing of the game's yellow minimap arrow. Work on the
  // central yellow component only, so the compass and distant map markers
  // cannot set the direction. The result is in radians, with zero = right.
  function arrowHeading(image){
    if(!image?.data||!image.width||!image.height)return null;
    const {data,width,height}=image,cx=width/2,cy=height/2;
    const radius=Math.min(width,height)*.22,side=Math.ceil(radius),left=Math.max(0,Math.floor(cx-side)),top=Math.max(0,Math.floor(cy-side));
    const right=Math.min(width,Math.ceil(cx+side)),bottom=Math.min(height,Math.ceil(cy+side));
    const w=right-left,h=bottom-top,mask=new Uint8Array(w*h),visited=new Uint8Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const px=x+left,py=y+top;
      if((px-cx)**2+(py-cy)**2>radius**2)continue;
      const i=(py*width+px)*4,r=data[i],g=data[i+1],b=data[i+2];
      if(r>170&&g>140&&b<155&&r>b*1.25&&g>b*1.1)mask[y*w+x]=1;
    }
    let best=null,bestRank=-Infinity;
    for(let index=0;index<mask.length;index++){
      if(!mask[index]||visited[index])continue;
      const queue=[index],points=[];visited[index]=1;
      for(let head=0;head<queue.length;head++){
        const id=queue[head],x=id%w,y=Math.floor(id/w);points.push([x+left,y+top]);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const nx=x+dx,ny=y+dy,near=ny*w+nx;
          if(nx>=0&&nx<w&&ny>=0&&ny<h&&mask[near]&&!visited[near]){visited[near]=1;queue.push(near);}
        }
      }
      if(points.length<Math.min(width,height)*.2)continue;
      const ax=points.reduce((sum,p)=>sum+p[0],0)/points.length,ay=points.reduce((sum,p)=>sum+p[1],0)/points.length;
      const distance=Math.hypot(ax-cx,ay-cy),rank=points.length/(1+distance*.08);
      if(distance<radius*.75&&rank>bestRank){best=points;bestRank=rank;}
    }
    if(!best)return null;
    const minX=Math.min(...best.map(p=>p[0])),maxX=Math.max(...best.map(p=>p[0]));
    const minY=Math.min(...best.map(p=>p[1])),maxY=Math.max(...best.map(p=>p[1]));
    const span=Math.max(maxX-minX,maxY-minY);
    if(span<Math.min(width,height)*.045||span>Math.min(width,height)*.22)return null;
    let whiteX=0,whiteY=0,whiteCount=0;
    for(let y=Math.max(0,minY-2);y<=Math.min(height-1,maxY+2);y++)for(let x=Math.max(0,minX-2);x<=Math.min(width-1,maxX+2);x++){
      const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];
      if(r>210&&g>205&&b>180&&Math.abs(r-g)<55){whiteX+=x;whiteY+=y;whiteCount++;}
    }
    if(whiteCount){whiteX/=whiteCount;whiteY/=whiteCount;}
    let angle=null,highest=-Infinity;
    for(let degrees=0;degrees<360;degrees+=10){
      const a=degrees*Math.PI/180,ux=Math.cos(a),uy=Math.sin(a),vx=-uy,vy=ux;
      let frontEdge=-Infinity,backEdge=Infinity;
      for(const [x,y] of best){const along=x*ux+y*uy;frontEdge=Math.max(frontEdge,along);backEdge=Math.min(backEdge,along);}
      const length=frontEdge-backEdge;if(length<1)continue;
      let frontMin=Infinity,frontMax=-Infinity,backMin=Infinity,backMax=-Infinity;
      let frontX=0,frontY=0,frontCount=0,backCount=0;
      for(const [x,y] of best){const along=x*ux+y*uy,across=x*vx+y*vy;
        if(along>frontEdge-length*.25){frontMin=Math.min(frontMin,across);frontMax=Math.max(frontMax,across);frontX+=x;frontY+=y;frontCount++;}
        if(along<backEdge+length*.25){backMin=Math.min(backMin,across);backMax=Math.max(backMax,across);backCount++;}
      }
      if(frontCount<3||backCount<3)continue;
      const tipDistance=Math.hypot(frontX/frontCount-cx,frontY/frontCount-cy);
      const whitePosition=whiteCount?Math.max(0,Math.min(1,(whiteX*ux+whiteY*uy-backEdge)/length)):0;
      const score=(backMax-backMin)-(frontMax-frontMin)+.05*(backCount-frontCount)-.3*tipDistance+8*(1-whitePosition);
      if(score>highest){highest=score;angle=a;}
    }
    return highest>Math.min(width,height)*.06?angle:null;
  }
  const api={PositionGate,arrowHeading};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MapTracking=api;
})(typeof self==='object'?self:globalThis);
