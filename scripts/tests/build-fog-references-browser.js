(async()=>{
  const specs=[
    {id:20032,region:[592,448,807,643],exclude:[[702,533,65]]},
    {id:20034,region:[676,270,788,418],exclude:[[733,292,61],[733,344,46]]},
    {id:20035,region:[395,528,564,622],exclude:[[452,568,60]]},
    {id:20036,region:[1310,470,1484,652],exclude:[[1430,537,55],[1430,445,50]]},
    {id:20037,region:[668,431,831,637],exclude:[[778,534,61]]},
    {id:20039,region:[730,622,910,782],exclude:[[800,679,55],[800,794,40]]},
    {id:20040,image:'real-20040-sparse.png',region:[1345,470,1540,610],exclude:[[1474,530,45]]},
  ];
  const w=new Worker('../../scripts/tests/build-fog-references-worker.js');
  try{return await new Promise((resolve,reject)=>{
    w.onerror=e=>reject(Error(e.message));w.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data);
    w.postMessage({icons:Object.fromEntries(['entrance','exit'].map(k=>[k,new URL(DUNGEON_DATA.icons.assets[DUNGEON_DATA.icons.categories[k]].image,location.href).href])),
      samples:specs.map(s=>({...s,pixelsPerMapPixel1080:.6315787701725338,map:DUNGEON_DATA.maps.find(m=>m.id===s.id),
        image:new URL('../../exports/recognition-fixtures/'+(s.image||'real-'+s.id+'-initial.png'),location.href).href}))});
  });}finally{w.terminate();}
})()
