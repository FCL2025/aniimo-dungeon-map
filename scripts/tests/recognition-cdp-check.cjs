// Headless browser fallback for machines without the agent-browser CLI.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const chrome=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin=process.env.ANIIMO_TEST_ORIGIN||'http://127.0.0.1:8765';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'aniimo-recognition-cdp-'));
const browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--remote-allow-origins=*','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connection(url){
  const socket=new WebSocket(url),pending=new Map();let next=0;
  socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id&&pending.has(data.id)){const {resolve,reject}=pending.get(data.id);pending.delete(data.id);data.error?reject(Error(data.error.message)):resolve(data.result);}});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  return {socket,send:(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));})};
}
(async()=>{
  let browserSocket;
  try{
    let port,endpoint;
    for(let i=0;i<100;i++){
      if(fs.existsSync(path.join(profile,'DevToolsActivePort'))){[port,endpoint]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);break;}
      await wait(100);
    }
    if(!port)throw Error('Headless Chrome did not expose DevTools');
    const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page=pages.find(x=>x.type==='page');if(!page)throw Error('No browser page');
    const cdp=await connection(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');
    const logMode=process.argv.includes('--log');
    const sample=process.argv.includes('--no-map')?'minimap-0.jpg':process.argv.includes('--preview')?'real-20040-initial.png':null;
    if(logMode)await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`
      window.__logEntries=[];
      window.__captureSequence=0;
      window.__previewFrame=null;
      window.__captureImage=async()=>{
        const url='${origin}/exports/recognition-fixtures/${sample}';
        if(${JSON.stringify(sample)}!=='real-20040-initial.png')return url;
        if(!window.__previewFrame){
          const img=new Image();img.src=url;await img.decode();
          const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
          const ctx=c.getContext('2d');ctx.drawImage(img,0,0);ctx.fillStyle='#454d61';ctx.fillRect(800,475,90,95);
          window.__previewFrame=c.toDataURL();
        }
        return window.__previewFrame;
      };
      window.__TAURI__={core:{invoke:async(name,args)=>{
        if(name==='game_windows')return [{id:'1',title:'Aniimo'}];
        if(name==='capture_frame')return {running:true,message:null,mapKeyAt:0,burstUntil:0,
          frame:${sample?`args.requestFrame?{sequence:++window.__captureSequence,capturedAt:Date.now(),width:1920,height:1080,image:await window.__captureImage(),sourceRegion:[0,0,1,1]}:null`:'null'}};
        if(name==='append_recognition_log'){window.__logEntries.push(args.entry);return 'C:\\\\test\\\\recognition.log';}
        return null;
      }}};
    `});
    const target=logMode?`${origin}/app/frontend/index.html`:process.argv[2]||`${origin}/scripts/tests/recognition-language.html`;
    await cdp.send('Page.navigate',{url:target});
    let result;
    for(let i=0;i<100;i++){
      await wait(100);
      const reply=await cdp.send('Runtime.evaluate',{expression:'({title:document.title,text:document.body?.innerText||"",ready:document.readyState,hasRecognition:!!document.querySelector("#recognition-button")})',returnByValue:true});
      result=reply.result?.value;
      if(target.includes('recognition-language.html')&&['PASS','FAIL'].includes(result?.title))break;
      if(target.includes('/app/frontend/index.html')&&result?.ready==='complete'&&result.hasRecognition)break;
    }
    if(!result)throw Error('No page result');
    if(target.includes('recognition-language.html')&&result.title!=='PASS')throw Error(JSON.stringify(result));
    if(target.includes('/app/frontend/index.html')&&(!result.hasRecognition||result.text.length<100))throw Error(JSON.stringify(result));
    if(logMode){
      const initial=await cdp.send('Runtime.evaluate',{expression:'document.querySelector("#debug-log").checked',returnByValue:true});
      if(initial.result?.value!==false)throw Error('DEBUG LOG must default to off');
      await cdp.send('Runtime.evaluate',{expression:'document.querySelector("#recognition-button").click()'});
      let log;
      for(let i=0;i<60;i++){
        await wait(100);
        const reply=await cdp.send('Runtime.evaluate',{expression:'({entries:window.__logEntries,display:document.querySelector("#recognition-log").textContent,status:window.recognitionStatus()})',returnByValue:true});
        if(reply.exceptionDetails)throw Error(JSON.stringify(reply.exceptionDetails));
        log=reply.result?.value;
      }
      if(log?.entries?.length)throw Error('DEBUG LOG wrote entries while off');
      await cdp.send('Runtime.evaluate',{expression:'document.querySelector("#debug-log").click()'});
      for(let i=0;i<40;i++){
        await wait(100);
        const reply=await cdp.send('Runtime.evaluate',{expression:'({entries:window.__logEntries,display:document.querySelector("#recognition-log").textContent,status:window.recognitionStatus()})',returnByValue:true});
        if(reply.exceptionDetails)throw Error(JSON.stringify(reply.exceptionDetails));
        log=reply.result?.value;
        if(log?.entries?.length)break;
      }
      const expected=sample==='minimap-0.jpg'?'m_map_not_detected':sample?'confirmation_pending':'no_frame';
      if(log?.entries?.[0]?.event!=='slow'||log.entries[0].elapsedMs<5000||log.entries[0].reason.code!==expected)throw Error(JSON.stringify(log));
      await cdp.send('Runtime.evaluate',{expression:'document.querySelector("#debug-log").click()'});
      await wait(11000);
      const disabled=await cdp.send('Runtime.evaluate',{expression:'({count:window.__logEntries.length,checked:document.querySelector("#debug-log").checked,saved:JSON.parse(localStorage.getItem("aniimo-dungeon-preferences-v1")).debugLog})',returnByValue:true});
      if(disabled.result?.value?.count!==log.entries.length||disabled.result.value.checked!==false||disabled.result.value.saved!==false)throw Error('DEBUG LOG kept writing after it was disabled');
      result={log:log.entries[0],display:log.display};
    }
    console.log(JSON.stringify(result));
    cdp.socket.close();
    browserSocket=await connection(`ws://127.0.0.1:${port}${endpoint}`);
    await browserSocket.send('Browser.close');
  }finally{
    browserSocket?.socket.close();
    browser.kill();
    await wait(200);
    if(path.dirname(profile)===os.tmpdir()&&path.basename(profile).startsWith('aniimo-recognition-cdp-')){
      try{fs.rmSync(profile,{recursive:true,force:true});}catch{}
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
