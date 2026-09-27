// Run phases main-open, child-check, main-stale, child-close, main-final in their respective WebView2 tabs.
// Prefix with window.overlayTestPhase='<phase>'; use a hidden EXE and ANIIMO_TEST_DATA_DIR.
(async () => {
  const el = id => document.getElementById(id), delay = ms => new Promise(r => setTimeout(r, ms));
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const native = window.__TAURI__.window.getCurrentWindow(), phase = window.overlayTestPhase;
  const windows = () => window.__TAURI__.window.getAllWindows();
  const selected = () => [...document.querySelectorAll('[data-category]:checked')].map(e => e.dataset.category);
  if (phase === 'main-open') {
    await window.desktopReady;
    if(document.body.classList.contains('sidebar-collapsed')){el('sidebar-toggle').click();await delay(400);}
    assert((await windows()).length === 1, 'Overlay opened without clicking map mode');
    window.testMainBefore = { size: await native.innerSize(), position: await native.outerPosition() };
    el('map').value = '20036'; el('map').dispatchEvent(new Event('change', { bubbles: true }));
    el('none').click(); document.querySelector('[data-category="egg"]').click();
    el('difficulty').value = '6'; el('icon-size').value = '175'; el('supplements').checked = false;
    el('difficulty').dispatchEvent(new Event('change', { bubbles: true }));
    el('compact').click(); await delay(1000);
    assert((await windows()).length === 2, 'Separate overlay window not created');
    assert(same(await native.innerSize(), testMainBefore.size) && same(await native.outerPosition(), testMainBefore.position), 'Main window moved/resized');
    assert(getComputedStyle(document.querySelector('aside')).display !== 'none', 'Main panel was hidden');
    el('live-status').textContent = '已鎖定'; el('live-status').title = '本場已鎖定 · 地宮 20036 · 215 個吻合點'; el('live-status').dataset.state = 'locked';
    const updatePoint = () => window.dispatchEvent(new CustomEvent('tracking-update', { detail: { mapId: 20036, pixel: [849, 1252], heading: 0, at: Date.now(), estimated: true } }));
    updatePoint(); window.testTrackingTimer = setInterval(updatePoint, 400);
    window.dispatchEvent(new Event('recognition-ui'));
    return { phase, passed: true, windows: (await windows()).map(w => w.label), mainUnchanged: true };
  }
  if (phase === 'child-check') {
    await window.overlayReady;
    const size = await native.innerSize(), position = await native.outerPosition();
    assert(size.width === size.height && size.width >= 590, 'Overlay physical size incorrect');
    assert(!await native.isDecorated() && await native.isAlwaysOnTop() && !await native.isResizable(), 'Native overlay flags incorrect');
    assert(el('overlay-close').getBoundingClientRect().right <= innerWidth, 'Close button clipped');
    assert(el('map').value === '20036' && el('difficulty').value === '6' && el('icon-size').value === '175' && !el('supplements').checked, 'Controls not synced');
    assert(same(selected(), ['egg']), 'Categories not synced');
    assert(getComputedStyle(document.querySelector('.player-tools')).display === 'none' && el('player-status').dataset.state === 'live', 'Overlay locate control or player state incorrect');
    const rect = el('map-canvas').getBoundingClientRect(), initialScale = scale;
    el('map-canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: rect.left + 180, clientY: rect.top + 160, bubbles: true, cancelable: true }));
    assert(scale > initialScale, 'Wheel did not zoom');
    window.testZoom = scale;
    const stage = () => { const b = document.querySelector('.stage').getBoundingClientRect(); return [b.width, b.height]; };
    const area = stage(); await delay(5200);
    assert(el('app-status').hidden, 'Repeated position updates kept the notice visible');
    assert(same(stage(), area), 'Notice affected map area');
    assert(scale === testZoom, 'Position updates reset zoom');
    return { phase, passed: true, size, position, stage: area, dpi: devicePixelRatio, filtersSynced: true, wheelZoom: true, markerSynced: true, toastExpires: true };
  }
  if (phase === 'main-stale') {
    clearInterval(window.testTrackingTimer);
    window.dispatchEvent(new CustomEvent('tracking-stale'));
    el('none').click(); document.querySelector('[data-category="chest_glass"]').click();
    return { phase, passed: true };
  }
  if (phase === 'child-close') {
    assert(same(selected(), ['chest_glass']), 'Live filter updates not synced');
    assert(el('player-status').dataset.state === 'stale' && tracking.stale, 'Lost tracking still appears live');
    assert(scale === testZoom, 'Filter updates reset zoom');
    assert(!el('new-session'), 'Removed new-session control remains in the overlay');
    setTimeout(() => el('overlay-close').click(), 200);
    return { phase, passed: true, staleSynced: true, newSessionRemoved: true, closing: true };
  }
  if (phase === 'main-final') {
    for (let i = 0; i < 40 && (await windows()).length !== 1; i++) await delay(50);
    assert((await windows()).length === 1, 'Closing overlay also closed main or left an orphan');
    assert(el('compact').getAttribute('aria-pressed') === 'false', 'Main toggle not reset by overlay close');
    assert(tracking?.stale && !window.recognitionStatus().pinned, 'Closing overlay changed the main tracking state');
    assert(same(await native.innerSize(), testMainBefore.size), 'Main geometry changed');
    el('compact').click(); await delay(800);
    assert((await windows()).length === 2, 'Overlay cannot reopen');
    el('compact').click(); await delay(800);
    assert((await windows()).length === 1, 'Main toggle cannot close overlay');
    assert(same(JSON.parse(localStorage.getItem('aniimo-dungeon-preferences-v1')).categories, ['chest_glass']), 'Filters not persisted');
    return { phase, passed: true, mainRetained: true, bothCloseControlsWork: true, filtersPersisted: true };
  }
  throw Error('Unknown native test phase');
})()
