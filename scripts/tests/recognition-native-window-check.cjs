// Native regression: Unity and Qt windows owned by the same Aniimo.exe.
// Uses offscreen fixtures and an isolated hidden app profile; no game input.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const exe=process.argv[2];if(!exe)throw Error('Pass the built AniimoDungeonMap.exe path');
const expectedVersion=JSON.parse(fs.readFileSync(path.join(__dirname,'../../app/src-tauri/tauri.conf.json'),'utf8')).version;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'aniimo-window-selection-'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function connect(url){
  const socket=new WebSocket(url),pending=new Map();let next=0;
  socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id&&pending.has(data.id)){const {resolve,reject}=pending.get(data.id);pending.delete(data.id);data.error?reject(Error(data.error.message)):resolve(data.result);}});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  return {socket,send:(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));})};
}
(async()=>{
  const fixtureRoot=path.join(root,'fixture'),otherRoot=path.join(root,'other');
  fs.mkdirSync(fixtureRoot);fs.mkdirSync(otherRoot);
  const fixtureExe=path.join(fixtureRoot,'Aniimo.exe');
  const built=spawnSync('rustc',[path.join(__dirname,'overlay-game-fixture.rs'),'--edition=2021','-o',fixtureExe],{windowsHide:true,encoding:'utf8'});
  if(built.status!==0)throw Error(built.stderr||'Fixture build failed');
  fs.copyFileSync(fixtureExe,path.join(otherRoot,'OtherGame.exe'));
  const fixture=spawn(fixtureExe,['--with-decoy'],{cwd:fixtureRoot,windowsHide:true,stdio:'ignore'});
  const other=spawn(path.join(otherRoot,'OtherGame.exe'),[],{cwd:otherRoot,windowsHide:true,stdio:'ignore'});
  const port=await freePort();
  const child=spawn(path.resolve(exe),['--hidden'],{windowsHide:true,stdio:'ignore',env:{...process.env,
    ANIIMO_TEST_DATA_DIR:root,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}});
  let cdp;
  try{
    let page;
    for(let i=0;i<150;i++){
      try{const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();page=targets.find(x=>x.type==='page');if(page)break;}catch{}
      await wait(100);
    }
    if(!page)throw Error('Hidden Tauri WebView did not start');
    cdp=await connect(page.webSocketDebuggerUrl);
    let ready=false;
    for(let i=0;i<100;i++){
      const r=await cdp.send('Runtime.evaluate',{expression:'!!window.__TAURI__?.core?.invoke',returnByValue:true});
      if(r.result?.value){ready=true;break;}await wait(100);
    }
    if(!ready)throw Error('Tauri IPC did not become ready');

    const evaluate=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
    const invoke=(name,args={})=>evaluate(`window.__TAURI__.core.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`);
    const assert=(ok,message)=>{if(!ok)throw Error(message);};
    const until=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await wait(50);}throw Error('Fixture timed out');};
    await until(()=>fs.existsSync(path.join(fixtureRoot,'decoy-hwnd.txt'))&&fs.existsSync(path.join(otherRoot,'game-hwnd.txt')));
    const decoy=fs.readFileSync(path.join(fixtureRoot,'decoy-hwnd.txt'),'utf8');
    const otherId=fs.readFileSync(path.join(otherRoot,'game-hwnd.txt'),'utf8');
    const checks=[];
    for(let cycle=0;cycle<3;cycle++){
      const id=fs.readFileSync(path.join(fixtureRoot,'game-hwnd.txt'),'utf8');
      const windows=await invoke('game_windows');
      const matches=windows.filter(w=>w.processId===fixture.pid);
      assert(matches.length===1&&matches[0].id===id&&matches[0].windowClass==='UnityWndClass','Wrong window selected: '+JSON.stringify(windows));
      assert(!windows.some(w=>w.id===decoy||w.id===otherId),'Qt window or wrong executable accepted');
      const rejection=await evaluate(`window.__TAURI__.core.invoke('start_capture',{windowId:${JSON.stringify(decoy)}}).then(()=>({rejected:false}),message=>({rejected:true,message:String(message)}))`);
      assert(rejection.rejected&&rejection.message.includes('遊戲主視窗'),'Direct Qt capture was not rejected');
      const overlay=await invoke('set_map_overlay',{enabled:true,gameWindowId:id});
      const placement=overlay;
      assert(placement.gameFound&&placement.x>-7000&&placement.x<-3000,'Overlay followed the decoy: '+JSON.stringify(overlay));
      await invoke('set_map_overlay',{enabled:false,gameWindowId:null});
      await until(async()=>await evaluate("window.__TAURI__.window.getAllWindows().then(ws=>!ws.some(w=>w.label==='map-overlay'))"));
      fs.writeFileSync(path.join(fixtureRoot,'close-game'),'');
      await until(()=>!fs.existsSync(path.join(fixtureRoot,'close-game')));
      const afterClose=await invoke('game_windows');
      assert(!afterClose.some(w=>w.processId===fixture.pid),'Qt accepted when only Qt remains');
      const stale=await evaluate(`window.__TAURI__.core.invoke('start_capture',{windowId:${JSON.stringify(id)}}).then(()=>false,()=>true)`);
      assert(stale,'Stale game handle accepted');
      checks.push({cycle,selected:matches[0],qtRejected:true,wrongExecutableRejected:true,staleHandleRejected:true,qtOnlyExcluded:true,overlay:placement});
      if(cycle<2){fs.writeFileSync(path.join(fixtureRoot,'recreate-game'),'');await until(()=>!fs.existsSync(path.join(fixtureRoot,'recreate-game')));}
    }
    let live=null;
    if(process.argv.includes('--live')){
      const stopped=new Promise(resolve=>fixture.once('exit',resolve));fixture.kill();await stopped;
      const windows=await invoke('game_windows');
      if(!windows.length)live={skipped:'No live game window'};
      else {
        await evaluate(`document.querySelector('#debug-log').checked=true;document.querySelector('#recognition-button').click()`);
        await until(async()=>await evaluate('window.recognitionStatus().stats.captured>=2'));
        await wait(5500);
        live=await evaluate(`(()=>{const s=window.recognitionStatus();return {windows:[...document.querySelector('#game-window').options].map(o=>({id:o.value,title:o.textContent})),selected:document.querySelector('#game-window').value,stats:s.stats,capturing:s.capturing,pinned:s.pinned,diagnosticPath:s.diagnosticPath};})()`);
        assert(windows.some(w=>w.id===live.selected&&w.windowClass==='UnityWndClass'),'Live UI chose an unexpected window');
        if(live.diagnosticPath){
          const entries=fs.readFileSync(live.diagnosticPath,'utf8').trim().split(/\r?\n/).map(JSON.parse);
          live.loggedWindow=entries.at(-1).entry.capture.window;
          assert(live.loggedWindow?.id===live.selected&&live.loggedWindow.windowClass==='UnityWndClass','Log omitted the capture target');
        }
        await evaluate(`if(window.recognitionStatus().running)document.querySelector('#recognition-button').click()`);
      }
    }
    console.log(JSON.stringify({ok:true,version:expectedVersion,checks,live}));

  }finally{
    cdp?.socket.close();child.kill();fixture.kill();other.kill();await wait(500);
    if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('aniimo-window-selection-')){
      try{fs.rmSync(root,{recursive:true,force:true});}catch{}
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
