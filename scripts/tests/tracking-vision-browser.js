(async()=>{
  const report={floorMatches:[],floorScores:[],moving:[]};
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  let runningWorker=null;
  function tracker(map){
    const worker=runningWorker=new Worker('tracking-worker.js');let pending=null,request=0;
    worker.onerror=e=>{pending?.reject(Error(e.message));};
    worker.onmessage=({data})=>{if(!pending)return;if(data.type==='error'){pending.reject(Error(data.message));pending=null;}
      else if(data.type===pending.expected){const p=pending;pending=null;clearTimeout(p.timer);p.resolve(data);}};
    const send=(data,expected)=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending=null;reject(Error('Worker timeout: '+data.type));},10000);
      pending={resolve,reject,expected,timer};worker.postMessage(data);
    });
    return {init:()=>send({type:'init',map},'ready'),close:()=>worker.terminate(),
      track:(image,at,source=[0,0,1,1],region=[0,0,1,1])=>send({type:'track',request:++request,image,capturedAt:at,sourceRegion:source,miniRegion:region,aspect:16/9},'result')};
  }
  try{
    // Run the user's first-floor screenshot against the shipped map pool. No ground-truth location is assumed.
    for(const map of DUNGEON_DATA.maps){
      const t=tracker({id:map.id,image:new URL(map.image,location.href).href});
      try{
        await t.init();
        const first=await t.track(trackingFixtureImages[0],1000,[65/1920,25/1080,217/1920,217/1080],[82/1920,42/1080,200/1920,200/1080]);
        report.floorScores.push({map:map.id,match:first.miniScore,diagnostic:first.diagnostic});
        if(first.location){
          const second=await t.track(trackingFixtureImages[1],1100,[65/1920,25/1080,217/1920,217/1080],[82/1920,42/1080,200/1920,200/1080]);
          report.floorMatches.push({map:map.id,first:first.location,second:second.location,reason:second.diagnostic});
          check(!second.location,'Worker accepted a first-floor position after switching to second-floor terrain');
        }
      }finally{t.close();}
    }
    // Known-position crops of a deterministic textured map exercise the entire shipped worker.
    const mapCanvas=document.createElement('canvas');mapCanvas.width=mapCanvas.height=1024;
    const ctx=mapCanvas.getContext('2d');ctx.fillStyle='#172731';ctx.fillRect(0,0,1024,1024);
    let seed=456789;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<9000;i++){
      const color=40+Math.floor(random()*200);ctx.fillStyle=`rgb(${color},${color},${color})`;
      ctx.fillRect(random()*1024,random()*1024,5+random()*22,5+random()*22);
    }
    const mini=document.createElement('canvas');mini.width=mini.height=200;const mctx=mini.getContext('2d');
    const imageAt=(x,y)=>{mctx.drawImage(mapCanvas,x-200,y-200,400,400,0,0,200,200);return mini.toDataURL('image/png');};
    const t=tracker({id:99999,image:mapCanvas.toDataURL('image/png')});
    try{
      await t.init();
      for(let i=0;i<8;i++){
        const x=350+i*40,y=500,r=await t.track(imageAt(x,y),1000+i*100);
        const error=r.location?Math.hypot(r.location.pixel[0]-x*2,r.location.pixel[1]-y*2):null;
        report.moving.push({at:r.capturedAt,pixel:r.location?.pixel,error,method:r.location?.method,diagnostic:r.diagnostic,elapsedMs:r.elapsedMs});
        check(r.location&&error<4,'Known fast movement was lost or inaccurate: '+JSON.stringify(report.moving.at(-1)));
      }
      // Fully blank inventory-like occlusion must stop instead of extrapolating movement.
      mctx.fillStyle='#222';mctx.fillRect(0,0,200,200);
      const blocked=await t.track(mini.toDataURL('image/png'),1800);check(!blocked.location,'Blank overlay produced a position');
      report.occluded=blocked.diagnostic;
      const recovered=await t.track(imageAt(630,500),1900);
      check(recovered.location,'Terrain did not reacquire after the overlay closed');report.recovered=recovered.location;
    }finally{t.close();}
  }catch(error){report.error=String(error.stack||error);}
  finally{runningWorker?.terminate();}
  return report;
})()
