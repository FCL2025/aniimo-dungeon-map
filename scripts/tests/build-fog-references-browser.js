// Run on the staged app/frontend/index.html (scripts/build_fog_references.cjs does this).
// Extracts start-room terrain from the synthesized initial-fog views of every
// supported dungeon (scripts/build_fog_views.py); no game captures are needed.
(async()=>{
  const w=new Worker('../../scripts/tests/build-fog-references-worker.js');
  try{return await new Promise((resolve,reject)=>{
    w.onerror=e=>reject(Error(e.message));w.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data);
    w.postMessage({icons:Object.fromEntries(['entrance','exit'].map(k=>[k,new URL(DUNGEON_DATA.icons.assets[DUNGEON_DATA.icons.categories[k]].image,location.href).href])),
      samples:DUNGEON_DATA.maps.map(map=>({id:map.id,pixelsPerMapPixel1080:.6315787701725338,map,
        image:new URL('../../exports/recognition-fixtures/synthetic-'+map.id+'-initial.png',location.href).href}))});
  });}finally{w.terminate();}
})()
