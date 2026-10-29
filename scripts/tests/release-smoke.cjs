// Verify the packaged WebView2 UI and overlay with an isolated profile.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'app/src-tauri/tauri.conf.json'), 'utf8')).version;
const exe = path.resolve(process.argv.slice(2).find(arg=>arg!=='--screenshot') || `dist/AniimoDungeonMap-${version}-windows-x64-portable/AniimoDungeonMap.exe`);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aniimo-release-smoke-'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw Error(message); };
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), errors = [];
  let id = 0;
  socket.addEventListener('message', event => {
    const reply = JSON.parse(event.data), promise = pending.get(reply.id);
    if (promise) { pending.delete(reply.id); reply.error ? promise.reject(Error(reply.error.message)) : promise.resolve(reply.result); }
    if (reply.method === 'Runtime.exceptionThrown') errors.push(reply.params.exceptionDetails.text);
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once:true }); socket.addEventListener('error', reject, { once:true }); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id:key, method, params })); });
  await send('Runtime.enable');
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value; };
  const until = async expression => { for (let n = 0; n < 150; n++) { const value = await evaluate(expression); if (value) return value; await wait(100); } throw Error(`Timed out: ${expression}`); };
  const screenshot = async () => Buffer.from((await send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false })).data, 'base64');
  return { socket, evaluate, until, screenshot, errors };
}
async function pageAt(port, overlay = false) {
  for (let n = 0; n < 150; n++) {
    try { const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const page = pages.find(item => item.type === 'page' && (overlay ? item.url.includes('overlay.html') : !item.url.includes('overlay.html'))); if (page) return page; } catch {}
    await wait(100);
  }
  throw Error(`Missing ${overlay ? 'overlay' : 'main'} page`);
}
(async () => {
  const port = await freePort();
  const child = spawn(exe, ['--hidden'], { windowsHide:true, stdio:'ignore', env:{ ...process.env, ANIIMO_TEST_DATA_DIR:profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*` } });
  let main, overlay;
  try {
    main = await connect((await pageAt(port)).webSocketDebuggerUrl);
    await main.until('!!window.desktopReady && !!window.trackingStatus && !!window.SHOP_ADVICE');
    await main.evaluate('window.desktopReady');
    const updateUi = await main.evaluate(`(async () => ({
      button: !!document.getElementById('check-update'),
      dialog: !!document.getElementById('update-dialog'),
      hiddenCheck: await window.__TAURI__.core.invoke('check_for_update')
    }))()`);
    assert(updateUi.button && updateUi.dialog && updateUi.hiddenCheck === null, `Update UI: ${JSON.stringify(updateUi)}`);
    const trackingSource = await main.evaluate("fetch('tracking-core.js').then(response=>response.text())");
    assert(trackingSource === fs.readFileSync(path.join(root,'app/tracking-core.js'),'utf8'), 'Packaged tracking core differs from tested source');
    await main.evaluate(trackingSource);
    const motion = await main.evaluate(`(() => [100,250,400,600].map(interval => {
      const gate = new MapTracking.PositionGate(); gate.accept([200,200],1000);
      return {interval, accepted:[1,2,3].map(i=>gate.accept([200+.8*interval*i,200],1000+interval*i))};
    }))()`);
    assert(motion.every(row=>JSON.stringify(row.accepted)==='[false,false,true]'), `Packaged moving confirmation: ${JSON.stringify(motion)}`);
    const fixtures = Object.fromEntries(['minimap-0.jpg','minimap-1.jpg','minimap-2.jpg','minimap-3.jpg','blank.png'].map(name=>[
      name, `data:image/${name.endsWith('.png')?'png':'jpeg'};base64,`+fs.readFileSync(path.join(root,'exports/recognition-fixtures',name)).toString('base64')
    ]));
    await main.evaluate('window.trackingFixtureOverrides='+JSON.stringify(fixtures));
    await main.evaluate(fs.readFileSync(path.join(__dirname,'overlay-position-browser.js'),'utf8'));
    await main.until('window.overlayPositionChecks?.done');
    const tracking = await main.evaluate('window.overlayPositionChecks');
    assert(!tracking.error, `Packaged OpenCV tracking: ${tracking.error}`);
    const ui = await main.evaluate(`(() => {
      const el = id => document.getElementById(id), selectors = document.querySelector('.map-selectors'), guides = document.querySelector('.sidebar-guides');
      const map = el('map').getBoundingClientRect(), difficulty = el('difficulty').getBoundingClientRect();
      return { header:!!document.querySelector('aside header'), recognition:!!el('recognition-button'), summary:!!el('route-summary'), hint:!!el('route-hint'),
        row:Math.abs(map.top-difficulty.top)<3 && map.right<difficulty.left, guidesAboveHelp:guides.compareDocumentPosition(el('help-button'))&Node.DOCUMENT_POSITION_FOLLOWING,
        guideButtons:[...guides.querySelectorAll('button')].map(node=>node.id), maps:el('map').options.length };
    })()`);
    assert(!ui.header && !ui.recognition && !ui.summary && !ui.hint && ui.row && ui.guidesAboveHelp && ui.maps === 12, `Main layout: ${JSON.stringify(ui)}`);
    const rockBoss = await main.evaluate(`(() => {
      const filter=document.querySelector('[data-category="rock_boss"]');
      const icon=document.querySelector('[data-category-icon="rock_boss"]');
      const maps=window.DUNGEON_DATA.maps.filter(map=>map.pins.some(pin=>pin.category==='rock_boss'));
      return {filter:!!filter,icon:!!icon,ids:maps.map(map=>map.id),
        valid:maps.every(map=>map.pins.filter(pin=>pin.category==='rock_boss').length===1 &&
          map.pins.find(pin=>pin.category==='rock_boss').difficultyCandidates.join(',')==='5,6')};
    })()`);
    assert(rockBoss.filter && rockBoss.icon && rockBoss.valid &&
      rockBoss.ids.join(',')==='20031,20033,20038,20061,20062', `Rock boss filter: ${JSON.stringify(rockBoss)}`);
    const rockFilter = await main.evaluate(`(() => {
      const map=document.getElementById('map'), difficulty=document.getElementById('difficulty');
      map.value='20031'; map.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('none').click(); document.querySelector('[data-category="rock_boss"]').click();
      const nightmare=visible.map(pin=>pin.typeId);
      difficulty.value='6'; difficulty.dispatchEvent(new Event('change',{bubbles:true}));
      const chaos=visible.map(pin=>pin.typeId);
      map.value='20032'; map.dispatchEvent(new Event('change',{bubbles:true}));
      const absent=visible.length;
      document.getElementById('all').click();
      return {nightmare,chaos,absent};
    })()`);
    assert(rockFilter.nightmare.join(',')==='11080000101' &&
      rockFilter.chaos.join(',')==='11080000101' && rockFilter.absent===0,
      `Rock boss toggle: ${JSON.stringify(rockFilter)}`);
    assert(ui.guideButtons.join(',') === 'loot-ranking-button,ticket-advice-button,egg-advice-button', 'Guide order');
    const shop = await main.evaluate(`(() => {
      document.getElementById('ticket-advice-button').click();
      const ticket = document.getElementById('ticket-advice-dialog'), ticketRows = ticket.querySelectorAll('tbody tr').length, ticketText = ticket.textContent;
      ticket.close(); document.getElementById('egg-advice-button').click();
      const egg = document.getElementById('egg-advice-dialog'), eggRows = egg.querySelectorAll('tbody tr').length, eggText = egg.textContent;
      egg.close(); return {ticketRows, eggRows, ticketText, eggText};
    })()`);
    assert(shop.ticketRows === 5 && shop.eggRows === 3 && shop.ticketText.includes('1,760,000') && shop.ticketText.includes('300,000') && shop.eggText.includes('4,500,000'), 'Shop advice values');
    const helpAndEnglish = await main.evaluate(`(() => {
      document.getElementById('help-button').click();
      const oldHint = document.getElementById('help-dialog').textContent.includes('兩人使用相同的補充點設定');
      document.getElementById('help-dialog').close();
      I18n.setLocale('en');
      const ticketButton = document.getElementById('ticket-advice-button').textContent;
      document.getElementById('ticket-advice-button').click();
      const ticketText = document.getElementById('ticket-advice-dialog').textContent;
      document.getElementById('ticket-advice-dialog').close();
      I18n.setLocale('zh-TW');
      return {oldHint,ticketButton,ticketText};
    })()`);
    assert(!helpAndEnglish.oldHint && helpAndEnglish.ticketButton === 'Daily Chaos Ticket purchases' && helpAndEnglish.ticketText.includes('Shell Coins'), 'Help cleanup and live translation');
    await main.until('[...document.querySelectorAll("[data-category-icon^=chest_]")].every(icon=>icon.complete&&icon.naturalWidth>0)');
    const floorUi = await main.evaluate(`(() => {
      const map=window.DUNGEON_DATA.maps.find(item=>item.id===20040);
      const chests=map.pins.filter(pin=>pin.category.startsWith('chest_'));
      const gold=document.querySelector('[data-category-icon="chest_gold"]'),glass=document.querySelector('[data-category-icon="chest_glass"]');
      return {first:chests.filter(pin=>pin.floor===1).length,second:chests.filter(pin=>pin.floor===2).length,
        legend:document.querySelector('.floor-legend').textContent.trim(),sameOriginalIcon:gold.src===glass.src&&gold.src.endsWith('/UI_Icon_MarkPoint_TreasureChest.png'),
        goldOutline:getComputedStyle(gold).outlineColor,glassOutline:getComputedStyle(glass).outlineColor};
    })()`);
    assert(floorUi.first>0 && floorUi.second>0 && floorUi.legend.includes('2F') && floorUi.sameOriginalIcon && floorUi.goldOutline==='rgb(223, 182, 91)' && floorUi.glassOutline==='rgb(157, 233, 244)', `Floor and chest outlines: ${JSON.stringify(floorUi)}`);
    if (process.argv.includes('--screenshot')) {
      await main.evaluate(`(() => { document.getElementById('manual-map-dialog')?.close();const map=document.getElementById('map');map.value='20040';map.dispatchEvent(new Event('change',{bubbles:true})); })()`);
      await main.until('document.getElementById("load-status").textContent===""');
      await wait(300);
      fs.writeFileSync(path.join(root,'dist','chest-floor-preview.png'), await main.screenshot());
    }
    await main.evaluate('document.getElementById("compact").click()');
    overlay = await connect((await pageAt(port, true)).webSocketDebuggerUrl);
    await overlay.until('!!window.overlayReady');
    const overlayUi = await overlay.evaluate(`({recognition:!!document.getElementById('recognition-button'),tracking:!!document.getElementById('tracking-button'),manual:!!document.getElementById('manual-map-button')})`);
    assert(!overlayUi.recognition && overlayUi.tracking && overlayUi.manual, 'Overlay controls');
    assert(!main.errors.length && !overlay.errors.length, `Browser errors: ${JSON.stringify([main.errors, overlay.errors])}`);
    console.log(JSON.stringify({version, updateUi, motion, tracking, ui, shop:{ticketRows:shop.ticketRows,eggRows:shop.eggRows}, floorUi, overlay:overlayUi}, null, 2));
  } finally {
    overlay?.socket.close(); main?.socket.close();
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await Promise.race([exited, wait(5000)]);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
