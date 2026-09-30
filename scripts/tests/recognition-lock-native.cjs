// Verify the packaged WebView2 worker and real screenshot-import controller.
// Uses a hidden window and an isolated profile; never captures or controls the game.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),exe=process.argv[2];
if(!exe)throw Error('Pass the packaged AniimoDungeonMap.exe path');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'aniimo-lock-'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function connect(url){
  const socket=new WebSocket(url),pending=new Map();let next=0;
  socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id&&pending.has(data.id)){const p=pending.get(data.id);pending.delete(data.id);data.error?p.reject(Error(data.error.message)):p.resolve(data.result);}});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  return {socket,send:(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));})};
}
(async()=>{
  const port=await freePort(),child=spawn(path.resolve(exe),['--hidden'],{windowsHide:true,stdio:'ignore',env:{...process.env,
    ANIIMO_TEST_DATA_DIR:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}});
  let cdp;
  const report={version:JSON.parse(fs.readFileSync(path.join(root,'app/src-tauri/tauri.conf.json'),'utf8')).version,
    exeSha256:createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),imports:[]};
  try{
    let page;
    for(let i=0;i<150;i++){try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page');if(page)break;}catch{}await wait(100);}
    if(!page)throw Error('Packaged WebView2 did not start');
    cdp=await connect(page.webSocketDebuggerUrl);
    const evaluate=async(expression,awaitPromise=false)=>{
      const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise});
      if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;
    };
    const until=async expression=>{for(let i=0;i<600;i++){const value=await evaluate(expression);if(value)return value;await wait(100);}throw Error('Timed out: '+expression);};
    await until('!!window.recognitionStatus');
    const ids=[20032,20034,20035,20036,20037,20039,20040],fixtures={};
    for(const name of [...ids.map(id=>id===20040?'real-20040-sparse.png':`real-${id}-initial.png`),'real-20040-initial.png','real-20040-explored.png']){
      fixtures[name]='data:image/png;base64,'+fs.readFileSync(path.join(root,'exports/recognition-fixtures',name)).toString('base64');
    }
    await evaluate('window.fogBenchmarkRepeats=1;window.portalCheckBenchmarkRepeats=1;window.recognitionFixtureOverrides='+JSON.stringify(fixtures));
    for(const [file,state] of [['recognition-fog-browser.js','fogChecks'],['recognition-portals-browser.js','portalChecks'],['recognition-fog-unseen-browser.js','fogUnseenChecks']]){
      await evaluate(fs.readFileSync(path.join(__dirname,file),'utf8'));
      await until(`window.${state}?.done`);
      const result=await evaluate(`window.${state}`);if(result.error)throw Error(result.error);
      report[state]=result;
    }
    // Exercise all supported full maps, including maps without fog samples.
    report.fullMaps=await evaluate(`(async()=>{
      const worker=new Worker('recognition-worker.js');let pending,request=0;
      const send=(message,expected)=>new Promise((resolve,reject)=>{pending={expected,resolve,reject};worker.postMessage(message);});
      worker.onmessage=({data})=>{if(data.type==='error')pending.reject(Error(data.message));else if(data.type===pending.expected)pending.resolve(data);};
      worker.onerror=e=>pending.reject(Error(e.message));
      try{
        await send({type:'init',maps:DUNGEON_DATA.maps.map(m=>({...m,image:new URL(m.image,location.href).href}))},'ready');
        const results=[];
        for(const map of DUNGEON_DATA.maps){
          await send({type:'reset'},'reset');
          const r=await send({type:'analyze',request:++request,source:'import',image:new URL(map.image,location.href).href},'result');
          if(r.selected!==map.id||r.locked&&r.locked!==map.id)throw Error('Incorrect full map: '+map.id);
          if(r.locked){
            const skipped=await send({type:'analyze',request:++request,source:'live',image:'invalid-image-that-must-not-be-decoded'},'result');
            if(skipped.locked!==map.id||skipped.search.evaluated!==0)throw Error('Locked worker continued recognition');
          }
          results.push({id:map.id,locked:r.locked,points:r.previewMatches,reason:r.lockReason});
        }
        return results;
      }finally{worker.terminate();}
    })()`,true);
    for(const id of ids){
      const name=id===20040?'real-20040-sparse.png':`real-${id}-initial.png`;
      const started=Date.now();
      await evaluate(`(async()=>{
        const blob=await(await fetch(window.recognitionFixtureOverrides[${JSON.stringify(name)}])).blob();
        const transfer=new DataTransfer();transfer.items.add(new File([blob],${JSON.stringify(name)},{type:'image/png'}));
        const input=document.getElementById('map-screenshot');input.files=transfer.files;await input.onchange({target:input});
      })()`,true);
      await until(`window.recognitionStatus().lastResult?.locked===${id}`);
      const actual=await evaluate(`(()=>{const s=recognitionStatus();return {locked:s.pinned,ready:s.ready,initializing:s.initializing,busy:s.busy,queued:s.queueLength,tracking:s.trackingRunning,result:s.lastResult,message:document.getElementById('recognition-message').textContent};})()`);
      if(actual.ready||actual.initializing||actual.busy||actual.queued)throw Error('Import lock retained recognition work');
      report.imports.push({id,totalMs:Date.now()-started,...actual});
    }
    report.passed=true;
    fs.writeFileSync(process.argv[3]||path.join(root,'exports/recognition-fixtures/lock-native-verification.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({version:report.version,passed:true,fogCases:report.fogChecks.results.length,portalCases:report.portalChecks.results.length,
      synthesizedCases:report.fogUnseenChecks.results.length,fullMaps:report.fullMaps,imports:report.imports.map(r=>({id:r.id,points:r.result.lockedMatches,reason:r.result.lockReason,processMs:r.result.elapsedMs,totalMs:r.totalMs}))},null,2));
  }finally{cdp?.socket.close();child.kill();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
