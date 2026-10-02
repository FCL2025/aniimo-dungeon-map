// Real packaged WebView2 + overlay IPC. Capture/worker races use isolated mock boundaries.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),version=JSON.parse(fs.readFileSync(path.join(root,'app/src-tauri/tauri.conf.json'),'utf8')).version;
const exe=path.resolve(process.argv[2]||`dist/AniimoDungeonMap-${version}-windows-x64-portable/AniimoDungeonMap.exe`);
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'aniimo-manual-'));
const output=path.join(root,'dist/manual-map-preview');fs.mkdirSync(output,{recursive:true});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(ok,message)=>{if(!ok)throw Error(message);};
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function connect(url){
  const socket=new WebSocket(url),pending=new Map();let id=0;
  socket.addEventListener('message',event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result);}});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{
    const reply=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(reply.exceptionDetails)throw Error(JSON.stringify(reply.exceptionDetails));return reply.result?.value;
  };
  const until=async expression=>{for(let i=0;i<150;i++){const value=await evaluate(expression);if(value)return value;await wait(100);}throw Error('Timed out: '+expression);};
  const click=async selector=>{assert(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),'Missing '+selector);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);};
  const pointerClick=async selector=>{
    const point=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  };
  const shot=async name=>{await wait(250);const {data}=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(data,'base64'));};
  return {socket,send,evaluate,until,click,pointerClick,shot};
}
async function launch(){
  const port=await freePort(),child=spawn(exe,['--hidden'],{windowsHide:true,stdio:'ignore',env:{...process.env,
    ANIIMO_TEST_DATA_DIR:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}});
  console.log(JSON.stringify({port,pid:child.pid}));
  let main;
  const pages=()=>fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  for(let i=0;i<150;i++){try{main=(await pages()).find(p=>p.type==='page'&&!p.url.includes('overlay.html'));if(main)break;}catch{}await wait(100);}
  if(!main){child.kill();throw Error('No native main page');}
  const cdp=await connect(main.webSocketDebuggerUrl);
  await cdp.until('!!window.manualMapReady');await cdp.evaluate('window.manualMapReady');
  return {child,cdp,pages,port};
}
(async()=>{
  let app,overlay;
  const report={version,exeSha256:createHash('sha256').update(fs.readFileSync(exe)).digest('hex')};
  try{
    app=await launch();
    const main=app.cdp;
    report.initial=await main.evaluate('({open:document.getElementById("manual-map-dialog").open,running:recognitionStatus().running,capturing:recognitionStatus().capturing,ready:recognitionStatus().ready})');
    assert(report.initial.open&&!report.initial.running&&!report.initial.capturing&&!report.initial.ready,'First run must allow manual selection without capture');
    await main.shot('main-directions');
    report.empty=await main.evaluate('[...document.querySelectorAll(".manual-direction:disabled")].map(button=>button.dataset.direction).sort()');
    assert(JSON.stringify(report.empty)===JSON.stringify(['downLeft','upLeft']),'Unexpected empty directions');
    await main.click('[data-direction="left"]');
    assert(await main.evaluate('document.querySelectorAll(".manual-map-card").length===2'),'Left exits were collapsed into one map');
    await main.shot('main-left-candidates');
    report.locales=[];
    for(const code of await main.evaluate('I18n.locales.map(locale=>locale.code)')){
      await main.evaluate(`I18n.setLocale(${JSON.stringify(code)})`);
      assert(await main.evaluate('document.getElementById("manual-map-title").textContent===I18n.t("manual.title")&&!document.getElementById("manual-map-result-title").textContent.includes("{count}")'),'Picker did not translate: '+code);
      report.locales.push(code);
    }
    await main.evaluate('I18n.setLocale("zh-TW")');
    await main.click('[data-map-id="20036"]');await main.until('!document.getElementById("manual-map-dialog").open&&document.getElementById("map").value==="20036"');
    report.selected=[];
    for(const [direction,id] of [['right',20032],['down',20034],['upRight',20035],['downRight',20037],['up',20039]]){
      await main.click('#manual-map-button');await main.until('!document.querySelector("[data-direction=up]").disabled');
      await main.click(`[data-direction="${direction}"]`);await main.until(`!document.getElementById('manual-map-dialog').open&&document.getElementById('map').value==='${id}'`);
      report.selected.push(id);
    }
    await main.click('#manual-map-button');await main.until('!document.getElementById("manual-map-all").disabled');await main.click('#manual-map-all');
    assert(await main.evaluate('document.querySelectorAll(".manual-map-card").length===7'),'All-maps fallback is incomplete');
    await main.click('[data-map-id="20040"]');await main.until('!document.getElementById("manual-map-dialog").open');
    await main.click('#manual-map-button');await main.until('!document.getElementById("manual-map-all").disabled');await main.click('#manual-map-close');
    assert(await main.evaluate('document.getElementById("map").value==="20040"&&document.activeElement.id==="manual-map-button"'),'Cancel lost map or keyboard focus');
    report.controller=await main.evaluate(fs.readFileSync(path.join(__dirname,'tracking-controls-browser.js'),'utf8'));
    assert(report.controller.passed,'Controller regression failed');
    await main.click('#compact');
    let overlayPage;
    for(let i=0;i<100;i++){overlayPage=(await app.pages()).find(page=>page.url.includes('overlay.html'));if(overlayPage)break;await wait(100);}
    assert(overlayPage,'Native overlay did not open');overlay=await connect(overlayPage.webSocketDebuggerUrl);
    await overlay.until('!!window.overlayReady&&!!window.manualMapReady');await overlay.evaluate('Promise.all([window.overlayReady,window.manualMapReady])');
    await overlay.until('document.getElementById("map").value==="20040"');
    await overlay.click('#manual-map-button');await overlay.until('!document.getElementById("manual-map-all").disabled');
    await overlay.click('[data-direction="left"]');await overlay.shot('overlay-left-candidates');
    await overlay.click('[data-map-id="20036"]');await overlay.until('!document.getElementById("manual-map-dialog").open&&document.getElementById("map").value==="20036"');
    assert(await main.evaluate('document.getElementById("map").value==="20036"&&!recognitionStatus().running&&!recognitionStatus().capturing'),'Overlay selection did not synchronize manual mode');
    await overlay.click('#manual-map-button');await overlay.until('!document.getElementById("manual-map-all").disabled');await overlay.click('[data-direction="left"]');
    await overlay.click('[data-map-id="20040"]');await main.until('document.getElementById("map").value==="20040"');
    await overlay.until('!document.getElementById("manual-map-dialog").open');
    report.overlay={passed:true,choices:[20036,20040]};
    report.sizes=[];
    for(const size of [590,400,295]){
      await overlay.send('Emulation.setDeviceMetricsOverride',{width:size,height:size,deviceScaleFactor:1,mobile:false});
      await overlay.pointerClick('#manual-map-button');await overlay.until('!document.getElementById("manual-map-all").disabled');
      await overlay.shot('overlay-directions-'+size);await overlay.pointerClick('[data-direction="left"]');
      const layout=await overlay.evaluate(`(()=>{const d=document.getElementById('manual-map-dialog'),r=d.getBoundingClientRect();return {width:innerWidth,dialogWidth:r.width,client:d.clientWidth,scroll:d.scrollWidth,left:r.left,right:r.right,cards:document.querySelectorAll('.manual-map-card').length};})()`);
      assert(layout.left>=0&&layout.right<=size+1&&layout.scroll<=layout.client+1&&layout.cards===2,'Picker overflows at '+size+': '+JSON.stringify(layout));
      await overlay.shot('overlay-'+size);report.sizes.push(layout);
      if(size<=400){
        await overlay.pointerClick('#manual-map-back');
        assert(await overlay.evaluate('!document.getElementById("manual-map-dialog").classList.contains("has-candidates")'),'Back did not restore directions');
        await overlay.pointerClick('[data-direction="left"]');
      }
      await overlay.pointerClick('[data-map-id="20040"]');await overlay.until('!document.getElementById("manual-map-dialog").open');
    }
    await overlay.send('Emulation.clearDeviceMetricsOverride');
    overlay.socket.close();overlay=null;await main.click('#compact');
    main.socket.close();app.child.kill();app=null;await wait(1200);
    app=await launch();
    report.restart=await app.cdp.evaluate('({map:document.getElementById("map").value,open:document.getElementById("manual-map-dialog").open,running:recognitionStatus().running,capturing:recognitionStatus().capturing})');
    assert(report.restart.map==='20040'&&!report.restart.open&&!report.restart.running&&!report.restart.capturing,'Manual map did not persist across restart');
    report.passed=true;
    fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
    if(process.env.ANIIMO_MANUAL_INSPECT){console.log('Inspection ready on '+app.port);await wait(45000);}
  }finally{overlay?.socket.close();app?.cdp.socket.close();app?.child.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
