// Prefix window.hotkeyTestPhase with setup / remember / hidden / restored / conflict.
// Use a hidden isolated EXE with ANIIMO_TEST_SHOW_OVERLAY=1 and the offscreen Aniimo.exe fixture.
(async () => {
  const el = id => document.getElementById(id), assert = (ok, msg) => { if (!ok) throw Error(msg); };
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const phase = window.hotkeyTestPhase;
  if (phase === 'setup') {
    await window.desktopReady; await window.overlayBridgeReady;
    const games = await window.__TAURI__.core.invoke('game_windows');
    const fixture = games.find(g => g.title === 'Aniimo overlay test fixture');
    assert(fixture, 'Missing offscreen fixture');
    if (![...el('game-window').options].some(o => o.value === fixture.id)) el('game-window').add(new Option(fixture.title, fixture.id));
    el('game-window').value = fixture.id;
    el('map').value = '20037'; el('map').dispatchEvent(new Event('change', { bubbles: true }));
    el('none').click(); document.querySelector('[data-category="chest_glass"]').click();
    el('icon-size').value = '175'; el('icon-size').dispatchEvent(new Event('input', { bubbles: true }));
    el('compact').click();
    await delay(50);
    for (let i = 0; i < 100 && el('compact').disabled; i++) await delay(30);
    assert(el('compact').textContent.includes('F1') && !el('app-status').textContent.includes('無法'), 'F1 did not register');
    window.hotkeyTestTracking = () => window.dispatchEvent(new CustomEvent('tracking-update', { detail: { mapId: 20037, pixel: [640, 1350], at: Date.now() } }));
    window.hotkeyTestTimer = setInterval(window.hotkeyTestTracking, 300);
    hotkeyTestTracking();
    window.hotkeyPreferences = localStorage.getItem('aniimo-dungeon-preferences-v1');
    return { passed: true, phase, gameWindow: fixture.id };
  }
  if (phase === 'remember') {
    await window.overlayReady; await delay(300);
    zoom(1.6); tx += 21; ty -= 15; draw();
    selectPin(visible.find(p => p.sourceId === 91320788));
    window.hotkeyBaseline = { scale, tx, ty, selected: selected.id, map: current.id, pins: visible.map(p => p.id), iconSize: el('icon-size').value, trackingAt: tracking.at };
    return { passed: true, phase, ...hotkeyBaseline };
  }
  if (phase === 'hidden') {
    assert(el('compact').textContent === '地圖已隱藏 · F1', 'Main button did not reflect hidden state');
    assert(el('compact').getAttribute('aria-pressed') === 'true', 'Temporary hide closed map mode');
    assert(localStorage.getItem('aniimo-dungeon-preferences-v1') === hotkeyPreferences, 'Temporary hide changed saved preferences');
    assert((await window.__TAURI__.window.getAllWindows()).length === 2, 'Overlay was destroyed');
    return { passed: true, phase, mainLabel: el('compact').textContent };
  }
  if (phase === 'restored') {
    assert(window.hotkeyBaseline, 'Overlay reloaded and lost JS state');
    const old = hotkeyBaseline;
    assert(scale === old.scale && tx === old.tx && ty === old.ty, 'View transform reset');
    assert(selected.id === old.selected && current.id === old.map, 'Selection or map reset');
    assert(JSON.stringify(visible.map(p => p.id)) === JSON.stringify(old.pins) && el('icon-size').value === old.iconSize, 'Filters or size reset');
    assert(tracking.at > old.trackingAt && !el('locate-player').disabled, 'Tracking updates did not continue');
    return { passed: true, phase, zoomPreserved: true, selectionPreserved: true, filterPreserved: true, trackingContinues: true };
  }
  if (phase === 'conflict') {
    assert(el('compact').getAttribute('aria-pressed') === 'true', 'Conflict disabled map mode');
    assert(el('app-status').textContent.includes('F1 無法使用') && el('compact').title.includes('F1 無法使用'), 'Conflict was silent');
    return { passed: true, phase, notice: el('app-status').textContent };
  }
  throw Error('Unknown phase');
})()
