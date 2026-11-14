// Real native capture -> detector -> one-shot WAV -> UI, with isolated offscreen windows.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),version=JSON.parse(fs.readFileSync(path.join(root,'app/src-tauri/tauri.conf.json'))).version;
const exe=path.resolve(process.argv[2]||`dist/AniimoDungeonMap-${version}-windows-x64-portable/AniimoDungeonMap.exe`);
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'aniimo-evacuation-'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,message,attempts=150)=>{for(let i=0;i<attempts;i++){if(await fn())return;await wait(100);}throw Error(message);};
async function connect(url){
  const socket=new WebSocket(url),pending=new Map(),errors=[];let id=0;
  socket.addEventListener('message',event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error.message)):p.resolve(r.result);}});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout: '+method));},30000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
  await send('Runtime.enable');return {socket,send,evaluate,errors};
}
(async()=>{
  const out=path.join(root,'dist/evacuation-verification');fs.mkdirSync(out,{recursive:true});
  const fixtureRoot=path.join(profile,'fixture');fs.mkdirSync(fixtureRoot);
  const fixtureExe=path.join(fixtureRoot,'Aniimo.exe');
  const built=spawnSync('rustc',[path.join(__dirname,'evacuation-game-fixture.rs'),'--edition=2021','-o',fixtureExe],{windowsHide:true,encoding:'utf8'});
  assert.equal(built.status,0,built.stderr);
  const generated=spawnSync(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8','-c',
    'from PIL import Image; import sys; from pathlib import Path; source=Path(sys.argv[1]); target=Path(sys.argv[2]); '+
    '\nfor name in ["incomplete","complete"]:\n image=Image.new("RGB",(1920,1080),(120,135,145)); image.paste(Image.open(source/f"evacuation-{name}.jpg"),(24,235)); image.save(target/f"{name}.bmp")',
    path.join(__dirname,'fixtures'),fixtureRoot],{windowsHide:true,encoding:'utf8'});
  assert.equal(generated.status,0,generated.stderr);
  fs.writeFileSync(path.join(fixtureRoot,'frame.txt'),'incomplete');
  const fixture=spawn(fixtureExe,[],{cwd:fixtureRoot,windowsHide:true,stdio:'ignore'});
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const child=spawn(exe,['--hidden'],{windowsHide:true,stdio:'ignore',env:{...process.env,ANIIMO_TEST_DATA_DIR:profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}});
  let cdp;const report={version,exe,checks:[]};
  try{
    let page;
    await until(async()=>{try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page');return !!page;}catch{}},'Native WebView did not start');
    cdp=await connect(page.webSocketDebuggerUrl);
    await until(()=>cdp.evaluate('!!window.evacuationStatus'),'Evacuation UI did not load');
    await until(()=>fs.existsSync(path.join(fixtureRoot,'game-hwnd.txt')),'Fixture window did not start');
    const hwnd=fs.readFileSync(path.join(fixtureRoot,'game-hwnd.txt'),'utf8');
    const ev=cdp.evaluate, click=()=>ev("document.getElementById('evacuation-button').click()"), status=()=>ev('evacuationStatus()');
    report.locales=await ev(`(() => {
      const out=[];for(const {code} of ANIIMO_LOCALES.locales){I18n.setLocale(code);out.push({code,
        text:document.getElementById('evacuation-button-text').textContent,
        label:document.getElementById('evacuation-panel').getAttribute('aria-label')});}
      I18n.setLocale('zh-TW');return out;
    })()`);
    assert.ok(report.locales.every(row=>row.text&&!row.text.startsWith('evac.')));
    assert.equal(report.locales.find(row=>row.code==='en').label,'Extraction alert');
    await ev(`document.getElementById('game-window').append(new Option('test fixture',${JSON.stringify(hwnd)},true,true))`);
    // No capture starts before the user's click.
    assert.equal((await status()).active,false);
    await click();
    await until(async()=>{const s=await status();if(s.state==='error')throw Error(JSON.stringify(s));return s.report?.samples>=3;},'No native incomplete samples',220);
    report.incomplete=await status();assert.equal(report.incomplete.state,'watching');assert.equal(report.incomplete.report.matched,false);
    report.checks.push('incomplete HUD keeps waiting');
    const first=report.incomplete.report;await wait(4500);const second=(await status()).report;
    report.cadence={samples:second.samples-first.samples,elapsedMs:second.sampledAt-first.sampledAt};
    assert.ok(report.cadence.samples>=1&&report.cadence.samples<=3,'Unexpected capture rate');
    assert.ok(report.cadence.elapsedMs/report.cadence.samples<=3000,'Capture interval exceeded 3 seconds');
    report.checks.push('low-frequency native cadence');
    fs.writeFileSync(path.join(fixtureRoot,'minimize'),'');
    await until(async()=>(await status()).state==='paused','Minimized fixture did not pause');
    fs.writeFileSync(path.join(fixtureRoot,'restore'),'');
    await until(async()=>(await status()).state==='watching','Restored fixture did not resume');
    report.checks.push('minimize and restore');
    // A separate map capture can coexist, and stopping the alert leaves it alone.
    await ev(`__TAURI__.core.invoke('start_capture',{windowId:${JSON.stringify(hwnd)}})`);
    fs.writeFileSync(path.join(fixtureRoot,'frame.txt'),'complete');
    await until(async()=>(await status()).state==='completed','Completed HUD did not finish',220);
    await until(async()=>!(await status()).busy,'Completion cleanup did not finish');
    report.complete=await status();assert.equal(report.complete.report.audioFailed,false,'Native WAV playback failed');
    const native=await ev("__TAURI__.core.invoke('evacuation_status')");assert.equal(native.state,'idle');
    const map=await ev("__TAURI__.core.invoke('capture_frame',{after:0})");assert.equal(map.running,true,'Alert stopped map capture');
    await ev("__TAURI__.core.invoke('stop_capture')");
    report.checks.push('completed HUD plays embedded WAV and releases its own capture only');
    const screenshot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'completed.png'),Buffer.from(screenshot.data,'base64'));
    await wait(2500);assert.equal((await status()).state,'completed');
    report.checks.push('no automatic next round');
    fs.writeFileSync(path.join(fixtureRoot,'frame.txt'),'incomplete');await wait(300);
    await click();await until(async()=>(await status()).report?.samples>=1,'Next round did not start');
    await click();await until(async()=>!(await status()).busy,'Cancellation did not finish');
    assert.equal((await status()).state,'idle');report.checks.push('manual next round and cancellation');
    await click();await until(async()=>!(await status()).busy,'Start did not finish');
    await ev("document.getElementById('mode-pvp').click()");
    await until(async()=>!(await status()).busy,'Mode cancellation did not finish');
    assert.equal((await status()).active,false);
    assert.equal(await ev("document.getElementById('evacuation-panel').hidden"),true);
    report.checks.push('PVP cancels and hides the alert');
    await ev("document.getElementById('mode-pve').click()");
    await click();await until(async()=>!(await status()).busy,'Start did not finish');
    fixture.kill();await until(async()=>(await status()).state==='error','Game closure did not surface an error');
    report.checks.push('game closure restores retryable button');
    assert.equal(cdp.errors.length,0,JSON.stringify(cdp.errors));report.ok=true;
    console.log(JSON.stringify(report));
  }finally{
    if(cdp){try{report.lastStatus=await cdp.evaluate('evacuationStatus()');report.nativeStatus=await cdp.evaluate("__TAURI__.core.invoke('evacuation_status')");report.errors=cdp.errors;}catch{}}
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
    cdp?.socket.close();child.kill();fixture.kill();await wait(700);
    const resolved=path.resolve(profile);
    if(path.dirname(resolved)===path.resolve(os.tmpdir())&&path.basename(resolved).startsWith('aniimo-evacuation-')){
      try{fs.rmSync(resolved,{recursive:true,force:true});}catch{}
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
