// Extract start-room fog references from the synthesized views in a headless
// Chromium (Edge or Chrome) over CDP; replaces the earlier agent-browser step.
// Serves the repository on 127.0.0.1 only. Never reads the game or user profile.
//   node scripts/build_fog_references.cjs [output.json]
// then: .venv\Scripts\python.exe -X utf8 scripts\package_fog_references.py <output.json>
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.argv[2]||path.join(root,'dist/fog-reference/extracted.json'));
const browsers=[process.env.ANIIMO_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.css':'text/css','.jpg':'image/jpeg','.ico':'image/x-icon','.svg':'image/svg+xml'};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function connect(url){
  const socket=new WebSocket(url),pending=new Map();let next=0;
  socket.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.id&&pending.has(d.id)){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  return {socket,send:(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));})};
}
(async()=>{
  const browser=browsers.find(p=>fs.existsSync(p));if(!browser)throw Error('No Edge/Chrome found; set ANIIMO_BROWSER');
  if(!fs.existsSync(path.join(root,'app/frontend/index.html')))throw Error('Stage app/frontend first: scripts/prepare_portable.py');
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,decodeURIComponent(new URL(req.url,'http://x').pathname).slice(1));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    fs.readFile(file,(e,d)=>{if(e){res.writeHead(404);return res.end();}res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'});res.end(d);});
  });
  const serverPort=await freePort();await new Promise(r=>server.listen(serverPort,'127.0.0.1',r));
  const debugPort=await freePort(),profile=fs.mkdtempSync(path.join(os.tmpdir(),'aniimo-fog-ref-'));
  const child=spawn(browser,['--headless=new',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
  let cdp;
  try{
    let page;for(let i=0;i<150&&!page;i++){try{page=(await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(x=>x.type==='page');}catch{}if(!page)await wait(100);}
    if(!page)throw Error('Browser did not start');
    cdp=await connect(page.webSocketDebuggerUrl);
    const evaluate=async(expression,awaitPromise=false)=>{const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise});
      if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails));return r.result?.value;};
    await cdp.send('Page.navigate',{url:`http://127.0.0.1:${serverPort}/app/frontend/index.html`});
    let loaded=false;for(let i=0;i<300&&!loaded;i++){await wait(100);try{loaded=await evaluate("document.readyState==='complete'&&!!window.DUNGEON_DATA");}catch{}}
    if(!loaded)throw Error('Staged viewer did not load');
    const result=await evaluate(fs.readFileSync(path.join(__dirname,'tests/build-fog-references-browser.js'),'utf8'),true);
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify({success:true,data:{result}})+'\n');
    console.log(`Extracted ${result.samples.length} start rooms (${result.samples.map(s=>s.id+':'+s.points.length).join(' ')}) -> ${output}`);
  }finally{try{cdp?.socket.close();}catch{}child.kill();server.close();await wait(500);try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
})().catch(e=>{console.error(e);process.exit(1);});
