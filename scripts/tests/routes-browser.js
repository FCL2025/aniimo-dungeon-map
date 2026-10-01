// Run in the staged viewer or native main WebView, using an isolated profile.
(async()=>{
  const assert=(ok,message)=>{if(!ok)throw Error(message);},el=id=>document.getElementById(id);
  const set=(id,value)=>{const e=el(id);typeof value==='boolean'?e.checked=value:e.value=String(value);e.dispatchEvent(new Event('change',{bubbles:true}));};
  const flush=()=>{if(frameRequest)cancelAnimationFrame(frameRequest);renderFrame();};
  assert(el('best-route')?.type==='checkbox','Missing route checkbox');
  assert([...el('route-start').options].map(o=>o.value).join(',')==='auto,entrance,exit','Missing starting portal choices');
  assert([...el('route-number').options].map(o=>o.value).join(',')==='1,2','Missing route choices');
  assert(!el('route-guide')&&!el('route-steps'),'Removed segment controls remain');
  set('best-route',false);assert(window.getRouteSnapshot()===null,'Hidden route remains active');
  const maps=[];
  for(const map of DUNGEON_DATA.maps){
    set('map',map.id);
    for(const difficulty of [5,6])for(const supplements of [false,true])for(const start of ['auto','entrance','exit'])for(const number of ['1','2']){
      set('difficulty',difficulty);set('supplements',supplements);set('route-start',start);set('route-number',number);set('best-route',true);flush();
      const route=window.getRouteSnapshot();
      assert(route?.mapId===map.id&&route.routeNumber===Number(number)&&route.chestCount>=3,'Wrong map, route or insufficient chest stops');
      assert(!el('route-summary').hidden&&el('route-summary').textContent.includes(`${route.chestCount} 個琉璃候選`),'Route summary not updated');
      assert(start==='auto'||route.start===start,'Selected starting portal ignored');
      assert(route.stops[0].kind===route.start&&route.stops.at(-1).kind===route.end,'Wrong endpoints');
      const portal=kind=>kind==='entrance'?'入口':'出口';
      assert(el('route-summary').textContent.startsWith(`路線 ${number} · ${portal(route.start)}出發`)&&el('route-summary').textContent.includes(`${portal(route.end)}離開`),'Wrong route or portal summary');
      assert(el('route-summary').textContent.includes(`鑰匙房 ${route.optionalDoor?1:0} 間`),'Wrong door summary');
      assert(supplements||route.stops.every(s=>s.provenance==='scene_reference'),'Hidden supplements remain on route');
      const partner=map.routes[supplements?'supplements':'direct'].selections[start][number==='1'?'2':'1'];
      const rooms=r=>[...r.stops.filter(s=>s.kind==='glass').map(s=>s.roomId),...(r.optionalDoor?[r.optionalDoor.roomId]:[])];
      assert(!rooms(route).some(room=>rooms(partner).includes(room)),'Routes share chest or door rooms');
      assert(Math.abs(rooms(route).length-rooms(partner).length)<=1,'Unbalanced chest counts');
    }
    set('route-start','auto');
    maps.push({id:map.id,routes:Object.values(map.routes.supplements.selections.auto).map(r=>({number:r.routeNumber,start:r.start,end:r.end,chests:r.chestCount,optionalDoor:!!r.optionalDoor}))});
  }
  set('map',20039);set('best-route',true);flush();
  let routePaints=0,original=paintRoute;
  paintRoute=(context)=>{routePaints++;return original(context);};
  try{
    for(let i=0;i<15;i++){
      window.dispatchEvent(new CustomEvent('tracking-update',{detail:{mapId:current.id,pixel:[800+i,1400],at:Date.now()+i}}));flush();
    }
    assert(routePaints===0,'Tracking repainted static route');
  }finally{paintRoute=original;window.dispatchEvent(new CustomEvent('tracking-update',{detail:null}));}
  const saved=JSON.parse(localStorage.getItem('aniimo-dungeon-preferences-v1'));
  assert(saved.bestRoute===true&&saved.routeStart==='auto'&&saved.routeNumber==='2','Route preferences were not saved');
  set('best-route',false);flush();assert(window.getRouteSnapshot()===null&&el('route-summary').hidden,'Route did not hide');
  set('best-route',true);flush();
  return window.routeChecks={passed:true,maps,variants:168,routePaintsDuringTracking:0,saved:true,toggle:true,segmentControlsRemoved:true};
})()
