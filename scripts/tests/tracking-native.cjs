// Native WebView2/OpenCV regression with isolated settings and no game interaction.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),version=JSON.parse(fs.readFileSync(path.join(root,'app/src-tauri/tauri.conf.json'))).version;
const exe=path.resolve(process.argv[2]||`dist/AniimoDungeonMap-${version}-windows-x64-portable/AniimoDungeonMap.exe`);
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'aniimo-tracking-'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function floorFlow(frames){
  const cv=require('../../app/vendor/opencv.js'),vm=require('node:vm');
  const geometry=require('../../app/recognition-core.js'),{TerrainFlow}=require('../../app/tracking-flow.js');
  await new Promise(resolve=>cv.then(()=>resolve()));
  const context=vm.createContext({cv});vm.runInContext(fs.readFileSync(path.join(root,'app/recognition-vision.js'),'utf8'),context);
  const detector=new cv.ORB(1200,1.2,8,9,0,2,cv.ORB_HARRIS_SCORE,31,9),results=[];
  for(const f of frames)f.data=new Uint8ClampedArray(f.data);
  try{for(let i=0;i<2;i++){
    const flow=new TerrainFlow(cv,geometry),query=context.features(frames[i],true,detector);
    try{
      flow.begin(frames[i],1000);flow.commit({a:1,b:0,tx:400,ty:400},query.points,1000);
      const seeded=flow.last?.points.length||0;assert.ok(seeded>=10,'Fixture needs distributed terrain points');
      assert.equal(flow.begin(frames[i],1100).valid,true,'Unchanged terrain should track');
      const changed=flow.begin(frames[1-i],1200);
      results.push({from:i+1,to:2-i,seeded,valid:changed.valid,reason:changed.reason,inliers:changed.inliers,ratio:changed.ratio});
      assert.equal(changed.valid,false,'Flow crossed a real floor change');
    }finally{flow.reset();query.descriptors.delete();}
  }}finally{detector.delete();}
  return results;
}
async function connect(url){
  const socket=new WebSocket(url),pending=new Map(),errors=[];let id=0;
  socket.addEventListener('message',event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error.message)):p.resolve(r.result);}});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout: '+method));},30000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
  await send('Runtime.enable');return {socket,evaluate,errors};
}
(async()=>{
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const child=spawn(exe,['--hidden'],{windowsHide:true,stdio:'ignore',env:{...process.env,ANIIMO_TEST_DATA_DIR:profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}});
  let cdp;
  const report={version,exe,screen:[]};
  try{
    let page;
    for(let i=0;i<150;i++){
      try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page');if(page)break;}catch{}
      await wait(100);
    }
    assert.ok(page,'Native WebView did not start');cdp=await connect(page.webSocketDebuggerUrl);
    for(let i=0;i<150;i++){if(await cdp.evaluate('!!window.trackingStatus&&!!window.MapScreen'))break;await wait(100);}
    const images=[1,2].map(i=>'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,`fixtures/tracking-floor-${i}.png`)).toString('base64'));
    await cdp.evaluate(`window.trackingFixtureImages=${JSON.stringify(images)}`);
    report.screen=await cdp.evaluate(`(async()=>{
      const out=[];for(const image of trackingFixtureImages){const bitmap=await createImageBitmap(await(await fetch(image)).blob());
        out.push(MapScreen.inspect(bitmap,[65/1920,25/1080,217/1920,217/1080],16/9));bitmap.close();}return out;
    })()`);
    console.log(JSON.stringify({screen:report.screen.map(({signature,...other})=>other)}));
    assert.ok(report.screen.every(s=>!s.mapOpen),'Normal gameplay was incorrectly classified as the M map');
    if(process.argv.includes('--screen-only'))return;
    const frames=await cdp.evaluate(`(async()=>{
      const frames=[];for(const url of trackingFixtureImages){const image=await createImageBitmap(await(await fetch(url)).blob());
        const canvas=new OffscreenCanvas(200,200),ctx=canvas.getContext('2d');ctx.drawImage(image,17,17,200,200,0,0,200,200);
        frames.push({width:200,height:200,data:Array.from(ctx.getImageData(0,0,200,200).data)});image.close();}return frames;
    })()`);
    report.floorFlow=await floorFlow(frames);console.log(JSON.stringify({floorFlow:report.floorFlow}));
    report.vision=await cdp.evaluate(fs.readFileSync(path.join(__dirname,'tracking-vision-browser.js'),'utf8'));
    assert.ok(!report.vision.error,report.vision.error+' '+JSON.stringify(cdp.errors));
    const saved=await cdp.evaluate(`window.__TAURI__.core.invoke('append_tracking_log',{entry:{events:[{event:'native-smoke',at:Date.now()}]}})`);
    assert.equal(path.resolve(saved),path.join(profile,'logs/tracking.log'));
    const log=JSON.parse(fs.readFileSync(saved,'utf8').trim());
    assert.equal(log.version,version);assert.equal(log.entry.events[0].event,'native-smoke');
    report.log=true;
    console.log(JSON.stringify({ok:true,floorFlow:report.floorFlow,movingFrames:report.vision.moving.length,
      maxSyntheticError:Math.max(...report.vision.moving.map(r=>r.error)),occluded:report.vision.occluded.reason,
      recovered:!!report.vision.recovered,absoluteFloorMatches:report.vision.floorMatches.length,log:report.log}));
  }finally{
    fs.mkdirSync(path.join(root,'dist'),{recursive:true});fs.writeFileSync(path.join(root,'dist/tracking-verification.json'),JSON.stringify(report,null,2));
    cdp?.socket.close();child.kill();await wait(500);
    const resolved=path.resolve(profile);
    if(path.dirname(resolved)===path.resolve(os.tmpdir())&&path.basename(resolved).startsWith('aniimo-tracking-')){
      try{fs.rmSync(resolved,{recursive:true,force:true});}catch{}
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
