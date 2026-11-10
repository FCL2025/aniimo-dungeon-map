// Run with agent-browser eval --stdin while app/frontend/index.html is open.
// Uses the real worker and local image fixtures; results are available as window.recognitionChecks.
(()=>{
  const state=window.recognitionChecks={done:false,results:[],error:null};
  const worker=new Worker('recognition-worker.js');
  let pending=null,request=0;
  function send(message,expected){
    return new Promise((resolve,reject)=>{pending={expected,resolve,reject};worker.postMessage(message);});
  }
  worker.onerror=e=>{if(pending)pending.reject(new Error(e.message));};
  worker.onmessage=({data})=>{
    if(data.type==='progress')return;
    if(data.type==='error'){pending?.reject(new Error(data.message));return;}
    if(data.type===pending?.expected){const p=pending;pending=null;p.resolve(data);}
  };
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  async function analyze(name,image,source='import'){
    const result=await send({type:'analyze',request:++request,image,capturedAt:Date.now(),source},'result');
    state.results.push({name,...result});return result;
  }
  (async()=>{
    try{
      await send({type:'init',maps:DUNGEON_DATA.maps.map(m=>({id:m.id,size:m.size,portalGeometry:m.portalGeometry,image:new URL(m.image,location.href).href})),
        portalIcons:Object.fromEntries(['entrance','exit'].map(kind=>[kind,new URL(DUNGEON_DATA.icons.assets[DUNGEON_DATA.icons.categories[kind]].image,location.href).href]))},'ready');
      const fixture=name=>new URL('../../exports/recognition-fixtures/'+name,location.href).href;
      let r=await analyze('real-initial-live',fixture('real-20040-initial.png'),'live');
      check(r.selected===20040&&r.locked===20040&&r.lockedMatches>=8,'Initial live fog must immediately lock 20040 using terrain and door evidence');
      await send({type:'reset'},'reset');
      r=await analyze('real-explored-live',fixture('real-20040-explored.png'),'live');
      // Both doors are visible and the player is away from the front door, so the
      // door vector plus the start-room check decides before any full-map search
      // (the full search on this frame is covered by recognition-portals-browser.js).
      check(r.selected===20040&&r.locked===20040&&r.lockReason==='terrain-and-side-door'&&r.search.method==='door-vector'&&r.search.doorMatched,'Explored doors must lock through the door vector');
      r=await analyze('duplicate-explored',fixture('real-20040-explored.png'),'live');
      check(r.locked===20040&&r.search.evaluated===0,'Locked map should skip all image processing');
      r=await analyze('other-map-after-lock',new URL('maps/20036.png',location.href).href);
      check(r.locked===20040&&r.selected===20040,'Later other map must never change lock');
      await send({type:'reset'},'reset');
      r=await analyze('strong-lock',new URL('maps/20036.png',location.href).href);
      check(r.locked===20036&&r.lockReason==='terrain','Broad unambiguous terrain must lock without doors');
      await send({type:'reset'},'reset');
      // Current 20040 shares much terrain with 20034 (689 vs 537 inliers), so the
      // whole map alone stays a correct preview instead of locking.
      r=await analyze('shared-terrain-preview',new URL('maps/20040.png',location.href).href);
      check(r.selected===20040&&r.locked===null,'Shared terrain must preview 20040 without locking');
      await send({type:'reset'},'reset');
      r=await analyze('new-session-other-map',new URL('maps/20036.png',location.href).href);
      check(r.locked===20036,'New session must release lock');
      const cases=await (await fetch(fixture('cases.json'))).json(),failures=[];
      for(const c of cases){
        await send({type:'reset'},'reset');
        const url=new URL(c.url),exportAt=url.pathname.indexOf('/exports/');
        const image=window.recognitionFixtureOverrides?.[c.name]||(url.protocol==='file:'&&exportAt>=0?new URL(url.pathname.slice(exportAt),location.origin).href:c.url);
        r=await analyze(c.name,image,c.source);
        if(r.locked!==null&&r.locked!==c.mapId)failures.push('Incorrect auto-lock: '+c.name+' -> '+r.locked);
        if(c.kind==='negative'&&r.selected!==null)failures.push('Negative frame selected: '+c.name);
      }
      check(failures.length===0,failures.join('; '));
    }catch(error){state.error=String(error.stack||error);}
    finally{state.done=true;worker.terminate();}
  })();
  return 'Recognition checks started';
})();
