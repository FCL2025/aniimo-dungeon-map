// Hidden packaged WebView2 verification with a fresh profile; never capture the game.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const exe=path.resolve(process.argv[2]||'dist/i18n-preview/AniimoDungeonMap.exe');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'aniimo-i18n-'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(value,message)=>{if(!value)throw Error(message);};
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function connect(url){
  const socket=new WebSocket(url),pending=new Map(),errors=[];let id=0;
  socket.addEventListener('message',event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result);}if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
  await send('Runtime.enable');
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
  const until=async expression=>{for(let i=0;i<150;i++){const v=await evaluate(expression);if(v)return v;await wait(100);}throw Error('Timed out: '+expression);};
  return {socket,send,evaluate,until,errors};
}
async function launch(){
  const port=await freePort(),child=spawn(exe,['--hidden'],{windowsHide:true,stdio:'ignore',env:{...process.env,ANIIMO_TEST_DATA_DIR:profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}});
  const pages=()=>fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  try{
    let page;
    for(let i=0;i<150;i++){try{page=(await pages()).find(p=>p.type==='page'&&!p.url.includes('overlay.html'));if(page)break;}catch{}await wait(100);}
    assert(page,'No native main page');
    const cdp=await connect(page.webSocketDebuggerUrl);
    await cdp.until('!!window.desktopReady&&!!window.I18n&&!!window.recognitionStatus');await cdp.evaluate('window.desktopReady');
    return {child,cdp,pages};
  }catch(error){child.kill();throw error;}
}
async function stop(app){app.cdp.socket.close();const exited=new Promise(r=>app.child.once('exit',r));app.child.kill();await exited;await wait(400);}
(async()=>{
  let app,overlay;
  const report={exeSha256:createHash('sha256').update(fs.readFileSync(exe)).digest('hex')};
  try{
    app=await launch();assert(await app.cdp.evaluate('I18n.locale==="zh-TW"'),'Fresh profile must default to Traditional Chinese');
    report.browser=await app.cdp.evaluate(fs.readFileSync(path.join(__dirname,'i18n-browser.js'),'utf8').replace('requestAnimationFrame(()=>setTimeout(resolve,30))','setTimeout(resolve,60)'));
    report.controller=await app.cdp.evaluate(fs.readFileSync(path.join(__dirname,'tracking-controls-browser.js'),'utf8'));
    const fixtures=Object.fromEntries(['real-20040-initial.png','minimap-0.jpg'].map(name=>[name,
      `data:image/${name.endsWith('.png')?'png':'jpeg'};base64,`+fs.readFileSync(path.join(root,'exports/recognition-fixtures',name)).toString('base64')]));
    await app.cdp.evaluate(`window.recognitionFixtureOverrides=${JSON.stringify(fixtures)}`);
    report.resolution=await app.cdp.evaluate(fs.readFileSync(path.join(__dirname,'recognition-resolution-browser.js'),'utf8'));
    await app.cdp.evaluate('document.getElementById("compact").click()');
    let page;
    for(let i=0;i<100;i++){page=(await app.pages()).find(p=>p.url.includes('overlay.html'));if(page)break;await wait(100);}
    assert(page,'Overlay did not open');overlay=await connect(page.webSocketDebuggerUrl);await overlay.until('!!window.overlayReady');await overlay.evaluate('window.overlayReady');
    report.overlay=[];
    for(const code of ['zh-CN','en','ja','ko','zh-TW','de','fr','es','pt','ru','id','th','vi']){
      await app.cdp.evaluate(`I18n.setLocale(${JSON.stringify(code)})`);
      await overlay.until(`I18n.locale===${JSON.stringify(code)}&&document.getElementById('recognition-button').textContent===I18n.t('recognition')`);
      assert(await overlay.evaluate('document.getElementById("map").value==="20039"&&document.getElementById("best-route").checked'),'Overlay map/route changed');
      assert(await overlay.evaluate('document.getElementById("live-status").textContent===""'),'Manual status should stay hidden');
      report.overlay.push(code);
    }
    await app.cdp.evaluate('I18n.setLocale("en")');
    await overlay.until('I18n.locale==="en"');
    assert(await app.cdp.evaluate('window.__TAURI__.window.getCurrentWindow().title().then(title=>title===document.title)'),'Native title not translated');
    report.nativeTitle=true;
    const before=await app.cdp.evaluate('JSON.parse(localStorage.getItem("aniimo-dungeon-preferences-v1"))');
    await app.cdp.evaluate('document.getElementById("compact").click()');overlay.socket.close();overlay=null;
    await app.cdp.until('document.getElementById("compact").getAttribute("aria-pressed")==="false"');
    assert(!app.cdp.errors.length,'Native runtime errors: '+JSON.stringify(app.cdp.errors));
    await app.cdp.evaluate(`(()=>{const el=document.getElementById('game-resolution');el.value='21:9';el.dispatchEvent(new Event('change'));})()`);
    await stop(app);app=null;app=await launch();
    const restored=await app.cdp.evaluate('({locale:I18n.locale,settings:JSON.parse(localStorage.getItem("aniimo-dungeon-preferences-v1")),label:document.querySelector("header h1").textContent})');
    assert(restored.locale==='en'&&restored.label==='Dungeon map','Locale did not survive application restart');
    assert(JSON.stringify(restored.settings)===JSON.stringify(before),'Restart altered saved settings');report.restart=true;
    assert(await app.cdp.evaluate(`document.getElementById('game-resolution').value==='21:9'&&localStorage.getItem('aniimo-game-resolution-v1')==='21:9'`),'Resolution did not survive application restart');
    report.resolution.restart=true;
    for(const [mini,expected] of [[[.0427,.0389,.1042,.1852],null],[null,null],[[.2,.1,.15,.2],[.2,.1,.15,.2]]]){
      await app.cdp.evaluate(`localStorage.setItem('aniimo-capture-regions-v1',JSON.stringify({mini:${JSON.stringify(mini)},map:[0,0,1,1]}));location.reload()`);
      await app.cdp.until('!!window.desktopReady&&!!window.recognitionStatus');await app.cdp.evaluate('window.desktopReady');
      assert(await app.cdp.evaluate(`JSON.stringify(recognitionStatus().regions.mini)===${JSON.stringify(JSON.stringify(expected))}`),'Saved minimap migration failed');
    }
    report.resolution.savedRegions=true;
    await app.cdp.evaluate(`localStorage.setItem('aniimo-game-resolution-v1','toString');location.reload()`);
    await app.cdp.until('!!window.desktopReady&&!!window.recognitionStatus');await app.cdp.evaluate('window.desktopReady');
    assert(await app.cdp.evaluate(`document.getElementById('game-resolution').value==='16:9'`),'Invalid resolution must fall back to 16:9');
    report.resolution.invalidSettingFallback=true;
    await app.cdp.evaluate('localStorage.setItem(I18n.storageKey,"invalid-locale");location.reload()');
    await app.cdp.until('!!window.desktopReady&&I18n.locale==="zh-TW"');await app.cdp.evaluate('window.desktopReady');report.invalidLocaleFallback=true;
    await app.cdp.evaluate('document.getElementById("language-button").click()');
    const shot=await app.cdp.send('Page.captureScreenshot',{format:'png'});
    const out=path.join(root,'dist/i18n-preview');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'language-menu.png'),Buffer.from(shot.data,'base64'));
    report.passed=true;fs.writeFileSync(path.join(out,'i18n-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{overlay?.socket.close();if(app)await stop(app);}
})().catch(error=>{console.error(error);process.exitCode=1;});
