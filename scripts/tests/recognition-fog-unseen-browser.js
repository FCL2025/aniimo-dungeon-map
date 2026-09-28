// Synthesized initial views from all game maps: this is a false-positive check,
// not a substitute for real captures of these dungeons.
(()=>{
  const state=window.fogUnseenChecks={done:false,error:null,results:[]},worker=new Worker('recognition-worker.js');let pending,request=0;
  const send=(message,expected)=>new Promise((resolve,reject)=>{pending={expected,resolve,reject};worker.postMessage(message);});
  worker.onmessage=({data})=>{if(data.type==='error')pending?.reject(Error(data.message));else if(data.type===pending?.expected)pending.resolve(data);};
  worker.onerror=e=>pending?.reject(Error(e.message));
  (async()=>{try{
    const frame=new Image(),name='real-20032-initial.png';frame.src=window.recognitionFixtureOverrides?.[name]||new URL('../../exports/recognition-fixtures/'+name,location.href).href;await frame.decode();
    await send({type:'init',maps:DUNGEON_DATA.maps.map(m=>({id:m.id,size:m.size,portalGeometry:m.portalGeometry,image:new URL(m.image,location.href).href})),
      portalIcons:Object.fromEntries(['entrance','exit'].map(k=>[k,new URL(DUNGEON_DATA.icons.assets[DUNGEON_DATA.icons.categories[k]].image,location.href).href]))},'ready');
    const maps=[...DUNGEON_DATA.maps].sort((a,b)=>([20058,20052].includes(b.id)?1:0)-([20058,20052].includes(a.id)?1:0));
    for(const map of maps){
      const img=new Image();img.src=new URL(map.image,location.href).href;await img.decode();
      const c=document.createElement('canvas');c.width=1920;c.height=1080;const ctx=c.getContext('2d');
      ctx.fillStyle='#454d61';ctx.fillRect(0,0,1920,1080);ctx.drawImage(frame,0,0,250,125,0,0,250,125);
      const scale=.6315787701725338,g=map.portalGeometry,delta=g.exit.map((v,i)=>(v-g.entrance[i])*scale);
      const entrance=[960-delta[0]/2,540-delta[1]/2],exit=[960+delta[0]/2,540+delta[1]/2];
      ctx.save();ctx.beginPath();ctx.arc(...entrance,112,0,Math.PI*2);ctx.clip();
      ctx.drawImage(img,entrance[0]-g.entrance[0]*scale,entrance[1]-g.entrance[1]*scale,img.width*scale,img.height*scale);ctx.restore();
      ctx.drawImage(frame,1008,496,80,80,exit[0]-40,exit[1]-40,80,80);
      await send({type:'reset'},'reset');
      const r=await send({type:'analyze',request:++request,source:'live',image:c.toDataURL()},'result');state.results.push({expected:map.id,...r});
      if(r.search?.strategy==='fog-reference'&&r.selected!==map.id)throw Error('False fog shortcut: '+map.id+' -> '+r.selected);
    }
  }catch(e){state.error=String(e.stack||e);}finally{worker.terminate();state.done=true;}})();return 'Unseen fog checks started';
})();
