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
      check(r.selected===20040&&r.locked===null,'Initial live fog must immediately preview 20040');
      r=await analyze('real-explored-live',fixture('real-20040-explored.png'),'live');
      check(r.selected===20040&&r.locked===null&&r.previewMatches===184,'184 points must remain a preview');
      r=await analyze('duplicate-explored',fixture('real-20040-explored.png'),'live');
      check(r.cached&&r.locked===null,'Duplicate map should skip ORB matching');
      r=await analyze('strong-lock',new URL('maps/20040.png',location.href).href);
      check(r.locked===20040&&r.lockedMatches>=200,'200+ must lock');
      r=await analyze('other-map-after-lock',new URL('maps/20036.png',location.href).href);
      check(r.locked===20040&&r.selected===20040,'Later other map must never change lock');
      await send({type:'reset'},'reset');
      r=await analyze('new-session-other-map',new URL('maps/20036.png',location.href).href);
      check(r.locked===20036,'New session must release lock');
      const cases=await (await fetch(fixture('cases.json'))).json();
      for(const c of cases){
        await send({type:'reset'},'reset');
        r=await analyze(c.name,c.url,c.source);
        check(r.locked===null||r.locked===c.mapId,'Incorrect auto-lock: '+c.name);
        if(c.kind==='negative')check(r.selected===null,'Negative frame must not preview or lock');
      }
    }catch(error){state.error=String(error.stack||error);}
    finally{state.done=true;worker.terminate();}
  })();
  return 'Recognition checks started';
})();
