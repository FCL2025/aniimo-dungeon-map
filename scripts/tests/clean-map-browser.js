// Run in the isolated native main WebView after desktopReady.
(async()=>{
  const el=id=>document.getElementById(id),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const flush=(at=performance.now())=>{if(frameRequest)cancelAnimationFrame(frameRequest);renderFrame(at);};
  await window.desktopReady;
  for(const selector of ['.selection','.canvas-caption','#new-session','#pin-list'])assert(!document.querySelector(selector),'Unwanted UI: '+selector);
  const native=window.__TAURI__.window.getCurrentWindow();
  if(!document.body.classList.contains('sidebar-collapsed')){el('sidebar-toggle').click();await pause(400);}
  const collapsed=await native.outerSize(),position=await native.outerPosition(),mapBefore=canvas.getBoundingClientRect();
  el('sidebar-toggle').click();await pause(400);
  const expanded=await native.outerSize(),mapExpanded=canvas.getBoundingClientRect();
  assert(expanded.width===collapsed.width&&expanded.height===collapsed.height,'Sidebar toggle resized the window');
  const afterPosition=await native.outerPosition();
  assert(afterPosition.x===position.x&&afterPosition.y===position.y,'Sidebar toggle moved the window');
  const sidebarWidth=el('sidebar').getBoundingClientRect().width;
  assert(Math.abs(mapBefore.width-mapExpanded.width-sidebarWidth)<=2,'Map did not use the space left by the sidebar');
  el('sidebar-toggle').click();await pause(400);
  el('map').value='20034';el('map').dispatchEvent(new Event('change',{bubbles:true}));
  for(let i=0;i<50&&!image;i++)await pause(20);
  el('all').click();flush();
  const pin=visible.find(p=>p.category==='stellarys_boss')||visible.find(p=>p.category==='egg');
  assert(pin,'No marker for overlap verification');
  // Center exactly on a real reward icon to verify the composite, not just draw order.
  scale=1;tx=width/2-pin.pixel[0];ty=height/2-pin.pixel[1];draw();flush();
  const originalMap=paintMap,originalPins=paintPins,originalStroke=ctx.stroke;let mapPaints=0,pinPaints=0;
  const strokeColors=[];ctx.stroke=function(...args){strokeColors.push(this.strokeStyle);return originalStroke.apply(this,args);};
  paintMap=(...a)=>{mapPaints++;return originalMap(...a);};
  paintPins=(...a)=>{pinPaints++;return originalPins(...a);};
  const start=Date.now();
  try{
    window.dispatchEvent(new CustomEvent('tracking-update',{detail:{mapId:current.id,pixel:pin.pixel,at:start}}));
    flush(320);const first=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    flush(960);const second=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    assert(mapPaints===0&&pinPaints===0,'Ripple rebuilt static layers');
    assert(first.some((v,i)=>v!==second[i]),'Ripple did not animate');
    const pins=pinContext.getImageData(0,0,canvas.width,canvas.height).data;
    let covered=0;
    for(let i=0;i<pins.length;i+=4)if(pins[i+3]===255){
      if([0,1,2].some(channel=>second[i+channel]!==pins[i+channel]))covered++;
    }
    assert(covered>5,'Player no longer covers the reward icon');
    const ratio=window.devicePixelRatio||1,px=Math.round(width/2*ratio),py=Math.round(height/2*ratio);
    const center=[...ctx.getImageData(px,py,1,1).data];
    const backing=[...ctx.getImageData(Math.round(px+7*ratio),py,1,1).data];
    assert(center.join(',')==='121,225,192,255','Original mint center was not restored above the marker');
    assert(backing.join(',')==='16,33,39,255','Original opaque dark backing was not restored');
    assert(strokeColors.some(color=>/^rgba\(245,\s*201,\s*90,/.test(color)),'Ripple color is no longer gold');
    window.dispatchEvent(new CustomEvent('tracking-stale'));flush(960);
    const stale=canvas.toDataURL();flush(1280);
    assert(canvas.toDataURL()===stale&&!rippleTimer,'Stale position kept animating');
    window.dispatchEvent(new CustomEvent('tracking-update',{detail:null}));flush();
    assert(el('locate-player').hidden&&!rippleTimer,'Cleared tracking retained the control/animation');
    el('fit').click();flush();
    return {passed:true,collapsed,expanded,sidebarKeepsWindowSize:true,removedFooter:true,center,backing,coveredMarkerPixels:covered,
      goldRipplesAboveMarkers:true,staticLayerRepaintsDuringAnimation:0,staleStopsAnimation:true};
  }finally{paintMap=originalMap;paintPins=originalPins;ctx.stroke=originalStroke;window.dispatchEvent(new CustomEvent('tracking-update',{detail:null}));}
})()
