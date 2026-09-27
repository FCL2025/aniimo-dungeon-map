// Run in the overlay WebView with the main window's recognition stopped.
(async () => {
  const el=id=>document.getElementById(id), assert=(ok,message)=>{if(!ok)throw Error(message);};
  const flush=()=>{if(frameRequest)cancelAnimationFrame(frameRequest);renderFrame();};
  assert(getComputedStyle(document.querySelector('.player-tools')).display==='none','Overlay locate control is visible');
  for(const selector of ['html','body','main','.stage','.mapbar']) {
    const style=getComputedStyle(document.querySelector(selector));
    assert(style.backgroundColor==='rgba(0, 0, 0, 0)'&&style.backgroundImage==='none','Opaque background: '+selector);
  }
  el('all').click();flush();
  const original=paintMap,samples=[];let paints=0;
  paintMap=(...args)=>{paints++;return original(...args);};
  try {
    const box=el('map-canvas').getBoundingClientRect();
    const start=Date.now();
    for(let i=0;i<60;i++) {
      const before=performance.now();
      window.dispatchEvent(new CustomEvent('tracking-update',{detail:{mapId:current.id,pixel:[850+i,1250],at:start+i,estimated:true}}));
      flush();samples.push(performance.now()-before);
    }
    assert(paints===0,'Tracking or hovering repainted the static map');
    const markerArcs=[],originalArc=ctx.arc,originalLineTo=ctx.lineTo;
    let markerLines=0;
    ctx.arc=function(x,y,r,...rest){markerArcs.push(r);return originalArc.call(this,x,y,r,...rest);};
    ctx.lineTo=function(...args){markerLines++;return originalLineTo.apply(this,args);};
    try{paintTracking(performance.now());}finally{ctx.arc=originalArc;ctx.lineTo=originalLineTo;}
    assert([12,10,5].every(radius=>markerArcs.includes(radius))&&markerLines===0,'Original circular tracking marker was not restored');
    const beforeScale=scale;
    el('map-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-120,clientX:box.left+120,clientY:box.top+120,cancelable:true}));flush();
    assert(scale>beforeScale&&paints===1,'Zoom did not refresh the map cache');
    el('none').click();flush();
    assert(visible.length===0&&paints===2,'Filter changes left stale markers');
    window.dispatchEvent(new CustomEvent('tracking-update',{detail:null}));flush();
    assert(el('locate-player').disabled&&paints===2,'Clearing tracking repainted the map');
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    assert(pixels.some((v,i)=>i%4===3&&v===0),'Canvas has no transparent pixels');
    assert(pixels.some((v,i)=>i%4===3&&v>0),'Map cache is blank');
    return {passed:true,trackingUpdates:60,staticPaintsDuringUpdates:0,circularMarker:true,meanUpdateMs:samples.reduce((a,b)=>a+b)/samples.length,maxUpdateMs:Math.max(...samples),zoom:true,filterInvalidation:true,transparentCanvas:true};
  } finally {paintMap=original;}
})()
