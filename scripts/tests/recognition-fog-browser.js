// Real labelled captures plus synthetic resolution, UI, pan and missing-door cases.
(()=>{
  const state=window.fogChecks={done:false,error:null,results:[],benchmark:[],initialization:[]},workers=[];
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const ids=[20032,20034,20035,20037,20040];
  const fixtureName=id=>id===20040?'real-20040-sparse.png':'real-'+id+'-initial.png';
  const source=new Map(),specs=new Map(DUNGEON_DATA.maps.map(m=>[m.id,m]));
  async function engine(enabled){
    const worker=new Worker('recognition-worker.js');workers.push(worker);let pending,request=0;
    worker.onmessage=({data})=>{if(data.type==='error')pending?.reject(Error(data.message));else if(data.type===pending?.expected)pending.resolve(data);};
    worker.onerror=e=>pending?.reject(Error(e.message));
    const send=(message,expected)=>new Promise((resolve,reject)=>{pending={expected,resolve,reject};worker.postMessage(message);});
    const start=performance.now();
    const ready=await send({type:'init',fogReferences:enabled,maps:[...specs.values()].map(m=>({id:m.id,size:m.size,portalGeometry:m.portalGeometry,image:new URL(m.image,location.href).href})),
      portalIcons:Object.fromEntries(['entrance','exit'].map(k=>[k,new URL(DUNGEON_DATA.icons.assets[DUNGEON_DATA.icons.categories[k]].image,location.href).href]))},'ready');
    state.initialization.push({enabled,ms:Math.round(performance.now()-start),...ready});
    check(ready.fogReferences===(enabled?5:0),'Unexpected fog reference count');
    return {reset:()=>send({type:'reset'},'reset'),analyze:image=>send({type:'analyze',request:++request,source:'live',image},'result')};
  }
  function altered(img,width=img.width,height=img.height,edit=()=>{}){
    const c=document.createElement('canvas');c.width=width;c.height=height;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0,width,height);edit(ctx,c);return c.toDataURL('image/png');
  }
  (async()=>{try{
    for(const id of ids){const name=fixtureName(id),img=new Image();img.src=window.recognitionFixtureOverrides?.[name]||new URL('../../exports/recognition-fixtures/'+name,location.href).href;await img.decode();source.set(id,img);}
    const fast=await engine(true),old=await engine(false);
    const samples=(await(await fetch('fog-references.json')).json()).samples;
    for(let repeat=0;repeat<(window.fogBenchmarkRepeats??3);repeat++)for(const id of ids)for(const mode of repeat%2?['fast','old']:['old','fast']){
      const e=mode==='fast'?fast:old;await e.reset();const r=await e.analyze(source.get(id).src);
      state.benchmark.push({id,mode,repeat,...r});
      if(mode==='fast')check(r.selected===id&&!r.locked&&r.search.strategy==='fog-reference'&&r.search.loadedReferences===specs.size,'Original failed: '+id);
    }
    async function run(name,id,image,expectedFast=true){
      await fast.reset();const r=await fast.analyze(image);state.results.push({name,id,...r});
      if(expectedFast)check(r.selected===id&&!r.locked&&r.search.strategy==='fog-reference',name+' must use the correct fog reference');
      else {
        await old.reset();const baseline=await old.analyze(image);state.results.at(-1).baseline={selected:baseline.selected,points:baseline.previewMatches,locked:baseline.locked};
        check(r.search?.strategy!=='fog-reference',name+' must reject the fog shortcut');
        check(r.selected===baseline.selected&&r.previewMatches===baseline.previewMatches&&r.locked===baseline.locked,name+' fallback changed terrain evidence');
      }
      return r;
    }
    for(const id of ids){
      const img=source.get(id),s=samples.find(s=>s.id===id).source;
      for(const [w,h] of [[1280,720],[1600,900],[2560,1440],[3840,2160]])await run(id+'-scaled-'+w+'x'+h,id,altered(img,w,h));
      await run(id+'-no-notification',id,altered(img,1920,1080,ctx=>{ctx.fillStyle='#454d61';ctx.fillRect(230,145,1320,121);}));
      await run(id+'-changed-player',id,altered(img,1920,1080,ctx=>{
        const [x,y]=s.entrance;ctx.fillStyle='#454d61';ctx.beginPath();ctx.arc(x,y-6,28,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#ffff8c';ctx.beginPath();ctx.moveTo(x-15,y);ctx.lineTo(x+14,y-12);ctx.lineTo(x+10,y+15);ctx.fill();
      }));
      await run(id+'-panned',id,altered(img,1920,1080,ctx=>{
        ctx.fillStyle='#454d61';ctx.fillRect(210,210,1450,720);ctx.drawImage(img,210,210,1450,720,247,233,1450,720);
      }));
      await run(id+'-no-side-door',id,altered(img,1920,1080,ctx=>{ctx.fillStyle='#454d61';ctx.fillRect(s.exit[0]-42,s.exit[1]-42,84,84);}),false);
      await run(id+'-wrong-side-door',id,altered(img,1920,1080,ctx=>{
        ctx.fillStyle='#454d61';ctx.fillRect(s.exit[0]-42,s.exit[1]-42,84,84);
        ctx.drawImage(img,s.exit[0]-42,s.exit[1]-42,84,84,s.exit[0]+110,s.exit[1]-155,84,84);
      }),false);
      await run(id+'-no-terrain',id,altered(img,1920,1080,ctx=>{
        const [x,y]=s.entrance;ctx.fillStyle='#454d61';ctx.fillRect(x-145,y-145,290,290);
        ctx.drawImage(img,x-25,y-30,50,55,x-25,y-30,50,55);
      }),false);
    }
    await fast.reset();await fast.analyze(source.get(20034).src);
    const duplicate=await fast.analyze(source.get(20034).src);state.results.push({name:'duplicate',...duplicate});
    check(duplicate.cached&&duplicate.search.fogEvaluated===0&&duplicate.search.evaluated===0,'Duplicate must reuse the fog result');
  }catch(e){state.error=String(e.stack||e);}finally{workers.forEach(w=>w.terminate());state.done=true;}})();
  return 'Fog checks started';
})();
