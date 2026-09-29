// Smoke test the real Tauri IPC and log file in an isolated hidden profile.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const exe=process.argv[2];if(!exe)throw Error('Pass the built AniimoDungeonMap.exe path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'aniimo-native-log-'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function connect(url){
  const socket=new WebSocket(url),pending=new Map();let next=0;
  socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id&&pending.has(data.id)){const {resolve,reject}=pending.get(data.id);pending.delete(data.id);data.error?reject(Error(data.error.message)):resolve(data.result);}});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  return {socket,send:(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));})};
}
(async()=>{
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
    const reply=await cdp.send('Runtime.evaluate',{expression:`window.__TAURI__.core.invoke('append_recognition_log',{entry:{at:new Date().toISOString(),event:'native_smoke',reason:{code:'test'}}})`,awaitPromise:true,returnByValue:true});
    if(reply.exceptionDetails)throw Error(JSON.stringify(reply.exceptionDetails));
    const saved=reply.result?.value;
    const expected=path.join(root,'logs','recognition.log');
    if(path.resolve(saved)!==path.resolve(expected))throw Error(`Unexpected log path: ${saved}`);
    const lines=fs.readFileSync(expected,'utf8').trim().split(/\r?\n/),entry=JSON.parse(lines.at(-1));
    if(entry.version!=='0.2.21'||entry.entry?.event!=='native_smoke')throw Error(JSON.stringify(entry));
    console.log(JSON.stringify({ok:true,version:entry.version,path:saved}));
  }finally{
    cdp?.socket.close();child.kill();await wait(500);
    if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('aniimo-native-log-')){
      try{fs.rmSync(root,{recursive:true,force:true});}catch{}
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
