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
// Runs inside either native window. Check rendered copy as well as tooltips and screen-reader labels.
function pickerCopy(){
  const el=id=>document.getElementById(id),t=I18n.t,failures=[];
  const check=(ok,label)=>{if(!ok)failures.push(label);};
  const overlay=document.body.classList.contains('overlay');
  check(el('manual-map-button').textContent===t(overlay?'manual.reset':'manual.open'),'open/reset');
  check(el('manual-map-button').title===t('manual.title'),'open tooltip');
  for(const [id,key] of [['manual-map-close','close'],['manual-map-back','manual.back']]){
    check(el(id).title===t(key)&&el(id).getAttribute('aria-label')===t(key),id);
  }
  for(const node of document.querySelectorAll('#manual-map-dialog [data-i18n],[data-i18n="manual.help"]')){
    check(node.textContent===t(node.dataset.i18n),node.dataset.i18n);
  }
  for(const button of document.querySelectorAll('.manual-direction')){
    const direction=button.dataset.direction,count=direction==='left'?2:['upLeft','downLeft'].includes(direction)?0:1;
    check(button.children[1].textContent===t('manual.'+direction),'direction '+direction);
    check(button.querySelector('.manual-direction-count').textContent===(count?t('manual.count',{count}):t('manual.empty')),'count '+direction);
    if(!count)check(getComputedStyle(button).visibility==='hidden','empty direction '+direction);
  }
  const hints={20032:'right',20034:'down',20035:'upRight',20036:'leftLower',20037:'downRight',20039:'up',20040:'left'};
  for(const card of document.querySelectorAll('.manual-map-card')){
    check(card.getAttribute('aria-label')===t('map.name',{id:card.dataset.mapId}),'card label '+card.dataset.mapId);
    check(card.querySelector('span').textContent===t('manual.'+hints[card.dataset.mapId]),'card hint '+card.dataset.mapId);
  }
  const filter=document.querySelector('.manual-direction[aria-pressed=true]')?.dataset.direction;
  const cards=document.querySelectorAll('.manual-map-card').length;
  if(cards)check(el('manual-map-result-title').textContent===t('manual.results',{direction:t(filter?'manual.'+filter:'manual.all'),count:cards}),'results');
  const catalog=ANIIMO_LOCALES.messages[I18n.locale];
  for(const key of Object.keys(ANIIMO_LOCALES.messages.en).filter(key=>key.startsWith('manual.'))){
    check(typeof catalog[key]==='string'&&catalog[key].trim()&&t(key)!==key,'catalog '+key);
  }
  return failures;
}
async function centered(cdp,label){
  const expression=`(()=>{const d=document.getElementById('manual-map-dialog'),r=d.getBoundingClientRect(),s=document.querySelector('.stage').getBoundingClientRect();return {
    label:${JSON.stringify(label)},dx:Math.abs(r.left+r.width/2-s.left-s.width/2),dy:Math.abs(r.top+r.height/2-s.top-s.height/2),
    contained:r.left>=s.left&&r.right<=s.right+1&&r.top>=s.top&&r.bottom<=s.bottom+1,overflow:d.scrollWidth>d.clientWidth+1};})()`;
  await cdp.until(`(()=>{const r=${expression};return r.dx<1&&r.dy<1&&r.contained&&!r.overflow;})()`);
  return cdp.evaluate(expression);
}
(async()=>{
  let app,overlay;
  const report={version,exeSha256:createHash('sha256').update(fs.readFileSync(exe)).digest('hex')};
  try{
    app=await launch();
    const main=app.cdp;
    report.initial=await main.evaluate('({open:document.getElementById("manual-map-dialog").open,running:recognitionStatus().running,capturing:recognitionStatus().capturing,ready:recognitionStatus().ready})');
    assert(report.initial.open&&!report.initial.running&&!report.initial.capturing&&!report.initial.ready,'First run must allow manual selection without capture');
    assert(await main.evaluate('getComputedStyle(document.getElementById("map-canvas")).visibility==="hidden"'),'Map remains visible beneath selection');
    report.centering=[await centered(main,'initial directions')];
    await main.shot('main-directions');
    report.empty=await main.evaluate('[...document.querySelectorAll(".manual-direction:disabled")].map(button=>button.dataset.direction).sort()');
    assert(JSON.stringify(report.empty)===JSON.stringify(['downLeft','upLeft']),'Unexpected empty directions');
    await main.click('[data-direction="left"]');
    assert(await main.evaluate('document.querySelectorAll(".manual-map-card").length===2'),'Left exits were collapsed into one map');
    await main.shot('main-left-candidates');
    report.locales=[];
    for(const code of await main.evaluate('I18n.locales.map(locale=>locale.code)')){
      await main.evaluate(`I18n.setLocale(${JSON.stringify(code)})`);
      const failures=await main.evaluate(`(${pickerCopy.toString()})()`);
      assert(!failures.length,'Picker did not translate: '+code+' '+failures.join(', '));
      report.centering.push(await centered(main,'left candidates '+code));
      report.locales.push(code);
    }
    await main.evaluate('I18n.setLocale("zh-TW")');
    for(const [width,height,collapsed] of [[1220,820,false],[1220,820,true],[800,600,false],[760,600,false],[640,480,false]]){
      await main.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await main.evaluate(`if(document.body.classList.contains('sidebar-collapsed')!==${collapsed})document.getElementById('sidebar-toggle').click()`);
      report.centering.push(await centered(main,`${width}x${height} sidebar ${collapsed?'closed':'open'}`));
      if(width===640)await main.shot('main-narrow-candidates');
    }
    await main.send('Emulation.clearDeviceMetricsOverride');
    await main.click('[data-map-id="20036"]');await main.until('!document.getElementById("manual-map-dialog").open&&document.getElementById("map").value==="20036"');
    report.selected=[];
    for(const [direction,id] of [['right',20032],['down',20034],['upRight',20035],['downRight',20037],['up',20039]]){
      await main.click('#manual-map-button');await main.until('!document.querySelector("[data-direction=up]").disabled');
      await main.click(`[data-direction="${direction}"]`);await main.until(`!document.getElementById('manual-map-dialog').open&&document.getElementById('map').value==='${id}'`);
      report.selected.push(id);
    }
    await main.click('#manual-map-button');await main.until('!document.getElementById("manual-map-all").disabled');await main.click('#manual-map-all');
    assert(await main.evaluate('document.querySelectorAll(".manual-map-card").length===7'),'All-maps fallback is incomplete');
    assert(!(await main.evaluate(`(${pickerCopy.toString()})()`)).length,'All-maps labels did not translate');
    report.centering.push(await centered(main,'all maps'));
    await main.click('[data-map-id="20040"]');await main.until('!document.getElementById("manual-map-dialog").open');
    await main.click('#manual-map-button');await main.until('!document.getElementById("manual-map-all").disabled');await main.click('#manual-map-close');
    assert(await main.evaluate('document.getElementById("map").value==="20040"&&document.activeElement.id==="manual-map-button"'),'Cancel lost map or keyboard focus');
    assert(await main.evaluate('getComputedStyle(document.getElementById("map-canvas")).visibility==="visible"'),'Closing the picker did not restore the main map');
    // Exercise the actual error rendering path, then switch languages while it is displayed.
    await main.evaluate('window.savedEnterManualMode=window.enterManualMode;window.enterManualMode=async()=>{throw I18n.msg("manual.retry")};document.getElementById("manual-map-button").click()');
    await main.until('!document.getElementById("manual-map-all").disabled&&document.getElementById("manual-map-message").textContent===I18n.t("manual.retry")');
    for(const code of report.locales){
      await main.evaluate(`I18n.setLocale(${JSON.stringify(code)})`);
      assert(await main.evaluate('document.getElementById("manual-map-message").textContent===I18n.t("manual.retry")'),'Error did not translate: '+code);
    }
    await main.evaluate('window.enterManualMode=window.savedEnterManualMode;delete window.savedEnterManualMode;I18n.setLocale("zh-TW");document.getElementById("manual-map-dialog").close()');
    report.localizedError=true;
    report.controller=await main.evaluate(fs.readFileSync(path.join(__dirname,'tracking-controls-browser.js'),'utf8'));
    assert(report.controller.passed,'Controller regression failed');
    await main.click('#compact');
    let overlayPage;
    for(let i=0;i<100;i++){overlayPage=(await app.pages()).find(page=>page.url.includes('overlay.html'));if(overlayPage)break;await wait(100);}
    assert(overlayPage,'Native overlay did not open');overlay=await connect(overlayPage.webSocketDebuggerUrl);
    await overlay.until('!!window.overlayReady&&!!window.manualMapReady');await overlay.evaluate('Promise.all([window.overlayReady,window.manualMapReady])');
    await overlay.until('document.getElementById("map").value==="20040"');
    const viewportBefore=await overlay.evaluate('({scale,tx,ty})');
    await overlay.click('#manual-map-button');await overlay.until('!document.getElementById("manual-map-all").disabled');
    report.transparentPicker=await overlay.evaluate(`(()=>{
      const d=document.getElementById('manual-map-dialog'),title=document.getElementById('manual-map-title').getBoundingClientRect();
      return {panel:getComputedStyle(d).backgroundColor,backdrop:getComputedStyle(d,'::backdrop').backgroundColor,
        map:getComputedStyle(document.getElementById('map-canvas')).visibility,visibleTitle:title.width>1&&title.height>1,
        introductions:d.querySelectorAll('p[data-i18n]').length};
    })()`);
    assert(report.transparentPicker.panel==='rgba(0, 0, 0, 0)'&&report.transparentPicker.backdrop==='rgba(0, 0, 0, 0)','Picker or backdrop still covers the game');
    assert(report.transparentPicker.map==='hidden'&&!report.transparentPicker.visibleTitle&&!report.transparentPicker.introductions,'Picker still shows map or introductory copy');
    await overlay.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await overlay.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await overlay.until('!document.getElementById("manual-map-dialog").open');
    assert(await overlay.evaluate('getComputedStyle(document.getElementById("map-canvas")).visibility==="visible"'),'Escape did not restore the overlay map');
    assert(JSON.stringify(await overlay.evaluate('({scale,tx,ty})'))===JSON.stringify(viewportBefore),'Cancel changed map zoom or position');
    report.transparentPicker.escapeRestoresMap=true;
    await overlay.click('#manual-map-button');await overlay.until('!document.getElementById("manual-map-all").disabled');
    await overlay.click('[data-direction="left"]');await overlay.shot('overlay-left-candidates');
    report.overlayLocales=[];
    for(const code of report.locales){
      await main.evaluate(`I18n.setLocale(${JSON.stringify(code)})`);
      await overlay.until(`I18n.locale===${JSON.stringify(code)}`);
      const failures=await overlay.evaluate(`(${pickerCopy.toString()})()`);
      assert(!failures.length,'Overlay picker did not translate: '+code+' '+failures.join(', '));
      report.overlayLocales.push(code);
    }
    await main.evaluate('I18n.setLocale("zh-TW")');await overlay.until('I18n.locale==="zh-TW"');
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
      assert(await overlay.evaluate('getComputedStyle(document.getElementById("map-canvas")).visibility==="visible"'),'Selection did not restore the overlay map');
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
