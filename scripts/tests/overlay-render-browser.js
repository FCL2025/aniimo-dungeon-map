// Run in the overlay WebView with the main window's recognition stopped.
(async () => {
  const el=id=>document.getElementById(id), assert=(ok,message)=>{if(!ok)throw Error(message);};
  const flush=()=>{if(frameRequest)cancelAnimationFrame(frameRequest);renderFrame();};
  assert(getComputedStyle(el('locate-player')).cursor!=='wait','Disabled locate button shows a busy cursor');
  for(const selector of ['html','body','main','.stage','.mapbar','#locate-player','#player-status']) {
    const style=getComputedStyle(document.querySelector(selector));
    assert(style.backgroundColor==='rgba(0, 0, 0, 0)'&&style.backgroundImage==='none','Opaque background: '+selector);
  }
  el('all').click();flush();
  const original=paintMap,originalLine=ctx.lineTo,samples=[];let paints=0,pathSegments=0;
  paintMap=(...args)=>{paints++;return original(...args);};
  ctx.lineTo=(...args)=>{pathSegments++;return originalLine.apply(ctx,args);};
  try {
    const box=el('map-canvas').getBoundingClientRect();
    const start=Date.now();
    for(let i=0;i<60;i++) {
      const before=performance.now();
      window.dispatchEvent(new CustomEvent('tracking-update',{detail:{mapId:current.id,pixel:[850+i,1250],at:start+i,estimated:true}}));
      el('locate-player').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
      flush();samples.push(performance.now()-before);
    }
    assert(paints===0,'Tracking or hovering repainted the static map');
    assert(pathSegments===0,'Player movement still draws a path');
    assert(!el('locate-player').disabled&&getComputedStyle(el('locate-player')).cursor==='pointer','Locate did not enable with a normal pointer');
    el('locate-player').click();flush();
    assert(Math.abs(tracking.pixel[0]*scale+tx-width/2)<1&&Math.abs(tracking.pixel[1]*scale+ty-height/2)<1,'Locate did not center the player');
    assert(paints===1,'Centering did not refresh the cached map exactly once');
    const beforeScale=scale;
    el('map-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-120,clientX:box.left+120,clientY:box.top+120,cancelable:true}));flush();
    assert(scale>beforeScale&&paints===2,'Zoom did not refresh the map cache');
    el('none').click();flush();
    assert(visible.length===0&&paints===3,'Filter changes left stale markers');
    window.dispatchEvent(new CustomEvent('tracking-update',{detail:null}));flush();
    assert(el('locate-player').disabled&&paints===3,'Clearing tracking repainted the map');
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    assert(pixels.some((v,i)=>i%4===3&&v===0),'Canvas has no transparent pixels');
    assert(pixels.some((v,i)=>i%4===3&&v>0),'Map cache is blank');
    return {passed:true,trackingUpdates:60,staticPaintsDuringUpdates:0,noPlayerPath:true,meanUpdateMs:samples.reduce((a,b)=>a+b)/samples.length,maxUpdateMs:Math.max(...samples),centering:true,zoom:true,filterInvalidation:true,transparentCanvas:true};
  } finally {paintMap=original;ctx.lineTo=originalLine;}
})()
