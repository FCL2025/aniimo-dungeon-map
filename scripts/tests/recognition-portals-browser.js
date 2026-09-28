// Run with agent-browser eval --stdin on app/frontend/index.html or the native EXE.
// Scaled/edited images below are in-memory test inputs, not additional real captures.
(()=>{
  const state=window.portalChecks={done:false,error:null,results:[],benchmark:[],initialization:[]};
  const workers=[];
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  async function engine(usePortals){
    const worker=new Worker('recognition-worker.js');workers.push(worker);
    let pending,request=0;
    worker.onerror=e=>pending?.reject(new Error(e.message));
    worker.onmessage=({data})=>{
      if(data.type==='error')pending?.reject(new Error(data.message));
      else if(data.type===pending?.expected){const p=pending;pending=null;p.resolve(data);}
    };
    const send=(message,expected)=>new Promise((resolve,reject)=>{
      pending={expected,resolve,reject};worker.postMessage(message);
    });
    const started=performance.now();
    const ready=await send({type:'init',priorityMaps:usePortals?undefined:[],maps:DUNGEON_DATA.maps.map(m=>({id:m.id,size:m.size,
      portalGeometry:usePortals==='miscalibrated'?{...m.portalGeometry,defaultDistance1080:m.id===20040?1000:m.id===20050?625:m.portalGeometry.defaultDistance1080}:m.portalGeometry,
      image:new URL(m.image,location.href).href})),
      portalIcons:usePortals?Object.fromEntries(['entrance','exit'].map(kind=>[kind,new URL(DUNGEON_DATA.icons.assets[DUNGEON_DATA.icons.categories[kind]].image,location.href).href])):undefined},'ready');
    state.initialization.push({usePortals,ms:Math.round(performance.now()-started),...ready});
    check(ready.loaded===(usePortals?8:31),'Unexpected number of preloaded references');
    if(usePortals)check(JSON.stringify(ready.priority)==='[20032,20034,20035,20040,20037,20036,20038,20039]','Common map priority order changed');
    return {
      reset:()=>send({type:'reset'},'reset'),
      analyze:(image,bigRegion,source='live')=>send({type:'analyze',request:++request,image,bigRegion,source,capturedAt:Date.now()},'result'),
    };
  }
  async function load(name){
    const img=new Image();img.src=window.recognitionFixtureOverrides?.[name]||new URL('../../exports/recognition-fixtures/'+name,location.href).href;
    await img.decode();return img;
  }
  function altered(img,width=img.width,height=img.height,edit=()=>{}){
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,width,height);edit(ctx,canvas);
    return canvas.toDataURL('image/png');
  }
  (async()=>{
    try{
      const initial=await load('real-20040-initial.png'),explored=await load('real-20040-explored.png');
      const fast=await engine(true),full=await engine(false);
      for(let repeat=0;repeat<(window.portalCheckBenchmarkRepeats??3);repeat++)for(const [name,img] of [['initial',initial],['explored',explored]]){
        // Alternate order to avoid always warming one path first.
        for(const mode of repeat%2?['fast','full']:['full','fast']){
          const e=mode==='fast'?fast:full;await e.reset();const r=await e.analyze(img.src);
          check(r.selected===20040&&r.locked===null,name+' '+mode+' changed selection');
          check(r.previewMatches===(name==='initial'?10:184),name+' '+mode+' changed terrain evidence');
          if(mode==='fast')check(r.search.strategy==='portals'&&r.search.filter==='default-distance'&&r.search.evaluated===1&&r.search.priorityGroup==='common'&&r.search.loadedReferences===8,'Expected one-map common default-distance search');
          state.benchmark.push({name,mode,repeat,...r});
        }
      }
      async function run(name,image,expectedStrategy,bigRegion){
        await fast.reset();const r=await fast.analyze(image,bigRegion);state.results.push({name,...r});
        check(!r.locked||r.locked===20040&&r.lockedMatches>=200,name+' must not lock another map');
        if(expectedStrategy==='full'){
          await full.reset();const baseline=await full.analyze(image,bigRegion);
          r.baseline={selected:baseline.selected,points:baseline.previewMatches,locked:baseline.locked};
          state.results.at(-1).baseline=r.baseline;
          check(r.selected===baseline.selected&&r.previewMatches===baseline.previewMatches&&r.locked===baseline.locked,name+' must preserve exhaustive search results');
        }else check(r.selected===20040,name+' must select the correct map');
        if(expectedStrategy)check(r.search.strategy===expectedStrategy,name+' used unexpected search strategy');
        if(expectedStrategy==='portals')check(r.search.filter==='default-distance'&&r.search.evaluated===1,name+' must use the default-distance filter');
        return r;
      }
      for(const [w,h] of [[1280,720],[1600,900],[2560,1440],[3840,2160]]){
        await run(`initial-scaled-${w}x${h}`,altered(initial,w,h),'portals');
        await run(`explored-scaled-${w}x${h}`,altered(explored,w,h),'portals');
      }
      await run('cropped-map-region',explored.src,null,[.3,.15,.55,.6]);
      await run('missing-side-door',altered(explored,1920,1080,ctx=>{ctx.fillStyle='#454d61';ctx.fillRect(800,475,90,95);}),'full');
      await run('missing-front-door',altered(explored,1920,1080,ctx=>{ctx.fillStyle='#454d61';ctx.fillRect(1420,465,105,110);}),'full');
      await run('misleading-side-door',altered(explored,1920,1080,ctx=>{
        ctx.fillStyle='#454d61';ctx.fillRect(800,475,90,95);ctx.drawImage(explored,800,475,90,95,1060,180,90,95);
      }),'full');
      await run('ambiguous-side-doors',altered(explored,1920,1080,ctx=>{
        ctx.drawImage(explored,800,475,90,95,1060,180,90,95);
      }),'full');
      // Exact duplicate frames reuse results; a change of crop must invalidate them.
      await fast.reset();
      await fast.analyze(explored.src);
      const cached=await fast.analyze(explored.src);state.results.push({name:'duplicate',...cached});
      check(cached.cached&&cached.search.evaluated===0,'Duplicate must skip matching');
      const cropped=await fast.analyze(explored.src,[.3,.15,.55,.6]);state.results.push({name:'changed-crop',...cropped});
      check(!cropped.cached,'Changing crop must invalidate cached results');
      const miscalibrated=await engine('miscalibrated'),recovered=await miscalibrated.analyze(explored.src);
      state.results.push({name:'wrong-distance-calibration',...recovered});
      check(recovered.selected===20040&&recovered.previewMatches===184&&recovered.search.filter==='direction'&&recovered.search.evaluated===1,
        'Incorrect distance hint must retry direction candidates and retain terrain evidence');
      const cold=await engine(true);
      for(const id of [20052,20058]){
        await cold.reset();await full.reset();
        const image=new URL('maps/'+id+'.png',location.href).href;
        const r=await cold.analyze(image,undefined,'import'),baseline=await full.analyze(image,undefined,'import');
        state.results.push({name:'uncommon-'+id,...r,baseline:{selected:baseline.selected,points:baseline.previewMatches,locked:baseline.locked}});
        check(r.selected===id&&r.locked===id&&r.previewMatches===baseline.previewMatches,'Uncommon map must retain exhaustive search evidence');
        check(r.search.evaluated===31&&r.search.loadedReferences===31,'Uncommon fallback must load and check all references');
        check(JSON.stringify(r.search.evaluatedOrder.slice(0,8))==='[20032,20034,20035,20040,20037,20036,20038,20039]','Common references must be checked first');
        check(r.search.newlyLoadedReferences===(id===20052?23:0),'Loaded reference features must be reused');
      }
    }catch(e){state.error=String(e.stack||e);}
    finally{for(const w of workers)w.terminate();state.done=true;}
  })();
  return 'Portal checks started';
})();
