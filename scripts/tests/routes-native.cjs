// Test the packaged main and overlay with an isolated profile; never control the game.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),version=JSON.parse(fs.readFileSync(path.join(root,'app/src-tauri/tauri.conf.json'),'utf8')).version;
const exe=path.resolve(process.argv[2]||`dist/AniimoDungeonMap-${version}-windows-x64-portable/AniimoDungeonMap.exe`);
const profile=fs.mkdtempSync(path.join(os.tmpdir(),`aniimo-routes-${version.replaceAll('.','')}-`));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
async function connect(url){
  const socket=new WebSocket(url),pending=new Map();let id=0;
  socket.addEventListener('message',event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result);}});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{
    const reply=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(reply.exceptionDetails)throw Error(JSON.stringify(reply.exceptionDetails));
    return reply.result?.value;
  };
  const until=async expression=>{for(let i=0;i<150;i++){const v=await evaluate(expression);if(v)return v;await wait(100);}throw Error('Timed out: '+expression);};
  return {socket,send,evaluate,until};
}
async function launch(){
  const port=await freePort(),child=spawn(exe,['--hidden'],{windowsHide:true,stdio:'ignore',env:{...process.env,
    ANIIMO_TEST_DATA_DIR:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}});
  let main;
  const pages=()=>fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  for(let i=0;i<150;i++){
    try{main=(await pages()).find(p=>p.type==='page'&&!p.url.includes('overlay.html'));if(main)break;}catch{}
    await wait(100);
  }
  if(!main){child.kill();throw Error('No native main page');}
  const cdp=await connect(main.webSocketDebuggerUrl);
  await cdp.until('!!window.desktopReady&&!!window.getRouteSnapshot');
  await cdp.evaluate('window.desktopReady');
  return {child,cdp,pages};
}
(async()=>{
  const report={version,exeSha256:createHash('sha256').update(fs.readFileSync(exe)).digest('hex')};
  let app,overlay;
  try{
    app=await launch();
    if(await app.cdp.evaluate('document.getElementById("best-route").checked'))throw Error('New profile route must default to off');
    if(await app.cdp.evaluate('document.getElementById("route-start").value!=="auto"'))throw Error('New profile must default to automatic start');
    if(await app.cdp.evaluate('document.getElementById("route-number").value!=="1"'))throw Error('New profile must default to route 1');
    await app.cdp.evaluate('localStorage.setItem("aniimo-dungeon-preferences-v1",JSON.stringify({map:"20036",bestRoute:true,supplements:true}));location.reload()');
    await app.cdp.until('!!window.desktopReady&&document.getElementById("map").value==="20036"&&document.getElementById("best-route").checked');
    await app.cdp.evaluate('window.desktopReady');
    report.migration=await app.cdp.evaluate('({checked:document.getElementById("best-route").checked,routeStart:document.getElementById("route-start").value,routeNumber:document.getElementById("route-number").value,start:getRouteSnapshot()?.start,end:getRouteSnapshot()?.end})');
    if(!report.migration.checked||report.migration.routeStart!=='auto'||report.migration.routeNumber!=='1'||report.migration.start!=='exit'||report.migration.end!=='exit')throw Error('Old route preferences did not migrate');
    await app.cdp.evaluate('localStorage.setItem("aniimo-dungeon-preferences-v1",JSON.stringify({map:"20036",bestRoute:true,routeNumber:"invalid",routeStart:"invalid"}));location.reload()');
    await app.cdp.until('!!window.desktopReady&&document.getElementById("best-route").checked');
    await app.cdp.evaluate('window.desktopReady');
    if(await app.cdp.evaluate('document.getElementById("route-number").value!=="1"||document.getElementById("route-start").value!=="auto"'))throw Error('Invalid route preferences did not fall back');
    report.invalidPreferencesFallback=true;
    report.routes=await app.cdp.evaluate(fs.readFileSync(path.join(__dirname,'routes-browser.js'),'utf8'));
    const fixtures=Object.fromEntries(['minimap-0.jpg','minimap-1.jpg','minimap-2.jpg','minimap-3.jpg','blank.png'].map(name=>[
      name,`data:image/${name.endsWith('.png')?'png':'jpeg'};base64,`+fs.readFileSync(path.join(root,'exports/recognition-fixtures',name)).toString('base64')]));
    await app.cdp.evaluate('window.trackingFixtureOverrides='+JSON.stringify(fixtures));
    await app.cdp.evaluate(fs.readFileSync(path.join(__dirname,'overlay-position-browser.js'),'utf8'));
    await app.cdp.until('window.overlayPositionChecks?.done');
    report.tracking=await app.cdp.evaluate('window.overlayPositionChecks');
    if(report.tracking.error)throw Error(report.tracking.error);
    await app.cdp.evaluate('document.getElementById("compact").click()');
    let page;
    for(let i=0;i<100;i++){page=(await app.pages()).find(p=>p.url.includes('overlay.html'));if(page)break;await wait(100);}
    if(!page)throw Error('Native overlay did not open');
    overlay=await connect(page.webSocketDebuggerUrl);
    await overlay.until('window.getRouteSnapshot?.()?.mapId===20039&&window.getRouteSnapshot?.()?.routeNumber===2');
    await app.cdp.evaluate('document.getElementById("best-route").click()');
    await overlay.until('window.getRouteSnapshot?.()===null&&!document.getElementById("best-route").checked');
    await app.cdp.evaluate('document.getElementById("map").value="20040";document.getElementById("map").dispatchEvent(new Event("change",{bubbles:true}));document.getElementById("best-route").click()');
    await overlay.until('window.getRouteSnapshot?.()?.mapId===20040&&document.getElementById("best-route").checked');
    await app.cdp.evaluate('document.getElementById("route-start").value="entrance";document.getElementById("route-start").dispatchEvent(new Event("change",{bubbles:true}))');
    await overlay.until('window.getRouteSnapshot?.()?.start==="entrance"&&document.getElementById("route-start").value==="entrance"');
    await app.cdp.evaluate('document.getElementById("route-start").value="exit";document.getElementById("route-start").dispatchEvent(new Event("change",{bubbles:true}))');
    await overlay.until('window.getRouteSnapshot?.()?.start==="exit"&&window.getRouteSnapshot?.()?.end==="exit"&&document.getElementById("route-start").value==="exit"');
    for(const number of ['1','2']){
      await app.cdp.evaluate(`document.getElementById("route-number").value="${number}";document.getElementById("route-number").dispatchEvent(new Event("change",{bubbles:true}))`);
      await overlay.until(`window.getRouteSnapshot?.()?.routeNumber===${number}&&document.getElementById("route-number").value==="${number}"`);
      const mainRoute=await app.cdp.evaluate('getRouteSnapshot()'),overlayRoute=await overlay.evaluate('getRouteSnapshot()');
      if(JSON.stringify(mainRoute)!==JSON.stringify(overlayRoute))throw Error('Overlay route differs from main');
    }
    report.overlay={passed:true,onOffSync:true,mapSync:true,startSync:true,routeNumberSync:true,segmentControlsRemoved:await overlay.evaluate('!document.getElementById("route-guide")&&!document.getElementById("route-steps")'),route:await overlay.evaluate('({mapId:getRouteSnapshot().mapId,routeNumber:getRouteSnapshot().routeNumber,start:getRouteSnapshot().start,end:getRouteSnapshot().end,chestCount:getRouteSnapshot().chestCount,optionalDoor:!!getRouteSnapshot().optionalDoor})')};
    if(!report.overlay.segmentControlsRemoved)throw Error('Removed controls remain in overlay');
    const screenshotDir=path.join(root,'dist/route-previews');fs.mkdirSync(screenshotDir,{recursive:true});
    for(const [name,cdp] of [['main',app.cdp],['overlay',overlay]]){
      const {data}=await cdp.send('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(screenshotDir,`routes-${name}-${version}.png`),Buffer.from(data,'base64'));
    }
    overlay.socket.close();overlay=null;
    await app.cdp.evaluate('document.getElementById("compact").click()');
    app.cdp.socket.close();app.child.kill();app=null;
    await wait(1200);
    app=await launch();
    report.restart=await app.cdp.evaluate('({checked:document.getElementById("best-route").checked,mapId:window.getRouteSnapshot()?.mapId,routeStart:document.getElementById("route-start").value,routeNumber:document.getElementById("route-number").value,start:window.getRouteSnapshot()?.start})');
    if(!report.restart.checked||report.restart.mapId!==20040||report.restart.routeStart!=='exit'||report.restart.routeNumber!=='2'||report.restart.start!=='exit')throw Error('Route preferences did not survive native restart');
    report.passed=true;
    fs.writeFileSync(path.join(root,'exports/recognition-fixtures/routes-native-verification.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{overlay?.socket.close();app?.cdp.socket.close();app?.child.kill();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
