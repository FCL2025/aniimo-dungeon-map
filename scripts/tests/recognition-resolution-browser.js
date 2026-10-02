// Run in the staged viewer or native WebView2. Ultrawide frames are synthetic
// extensions of labelled 16:9 captures, not recordings from a 21:9 monitor.
(async()=>{
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const load=async name=>{
    const img=new Image();img.src=window.recognitionFixtureOverrides?.[name]||new URL('../../exports/recognition-fixtures/'+name,location.href).href;
    await img.decode();return img;
  };
  const scaled=(img,width,height)=>{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#454d61';ctx.fillRect(0,0,width,height);
    ctx.drawImage(img,0,0,height*16/9,height);return canvas;
  };
  const cropped=(full,aspect)=>{
    const [w,h]=[full.width,full.height],r=MapScreen.defaultMini(aspect);
    const x=Math.floor(Math.min(r[0]*w,65*h/1080)),y=Math.floor(Math.min(r[1]*h,25*h/1080));
    const right=Math.ceil(Math.max((r[0]+r[2])*w,203*h/1080)),bottom=Math.ceil(Math.max((r[1]+r[3])*h,145*h/1080));
    const canvas=document.createElement('canvas');canvas.width=right-x;canvas.height=bottom-y;
    canvas.getContext('2d').drawImage(full,x,y,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
    return {canvas,region:[x/w,y/h,canvas.width/w,canvas.height/h]};
  };
  const initial=await load('real-20040-initial.png'),gameplay=await load('minimap-0.jpg');
  const worker=new Worker('recognition-worker.js');let pending,request=0;
  worker.onmessage=({data})=>{
    if(data.type==='error')pending?.reject(Error(data.message));
    else if(data.type===pending?.expected){clearTimeout(pending.timer);pending.resolve(data);pending=null;}
  };
  worker.onerror=e=>pending?.reject(Error(e.message));
  const send=(message,expected)=>new Promise((resolve,reject)=>{
    pending={expected,resolve,reject,timer:setTimeout(()=>reject(Error('Worker timed out: '+expected)),30000)};
    worker.postMessage(message);
  });
  const results=[];
  try{
    await send({type:'init',maps:DUNGEON_DATA.maps.map(m=>({id:m.id,size:m.size,portalGeometry:m.portalGeometry,image:new URL(m.image,location.href).href})),
      portalIcons:Object.fromEntries(['entrance','exit'].map(k=>[k,new URL(DUNGEON_DATA.icons.assets[DUNGEON_DATA.icons.categories[k]].image,location.href).href]))},'ready');
    for(const [width,height] of [[1920,1080],[2560,1440],[3440,1440]]){
      const aspect=width/height,map=scaled(initial,width,height),play=scaled(gameplay,width,height);
      check(MapScreen.inspect(map,undefined,aspect).mapOpen,`${width}: M-map header missed`);
      check(!MapScreen.inspect(play,undefined,aspect).mapOpen,`${width}: gameplay mistaken for M map`);
      for(const [frame,expected] of [[map,true],[play,false]]){
        const crop=cropped(frame,aspect);
        check(MapScreen.inspect(crop.canvas,crop.region,aspect).mapOpen===expected,`${width}: cropped frame classified incorrectly`);
      }
      await send({type:'reset'},'reset');
      const result=await send({type:'analyze',request:++request,source:'live',image:map.toDataURL(),aspect,capturedAt:Date.now()},'result');
      check(result.selected===20040&&result.locked===20040,`${width}: wrong recognition result ${result.selected}/${result.locked}`);
      results.push({width,height,locked:result.locked,reason:result.lockReason,headerAndCrop:true});
    }
    return {passed:true,syntheticUltrawide:true,results};
  }finally{clearTimeout(pending?.timer);worker.terminate();}
})()
