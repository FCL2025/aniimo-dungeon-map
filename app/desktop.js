'use strict';
(() => {
  const invoke = window.__TAURI__?.core.invoke, events = window.__TAURI__?.event;
  const el = id => document.getElementById(id), key = 'aniimo-dungeon-preferences-v1', sizeKey = 'aniimo-overlay-size-v1';
  let topmost = true, mapOverlay = false, overlayPaused = false, hotkeyError = '', sidebarCollapsed = false, restoring = true, noticeTimer;
  const overlaySize = el('main-overlay-size');
  const savedSize = Number(localStorage.getItem(sizeKey));
  const initialSize = savedSize >= 50 && savedSize <= 150 && savedSize % 10 === 0 ? savedSize : 100;
  function showOverlaySize(percent) {
    overlaySize.value = String(percent);
    overlaySize.setAttribute('aria-valuetext', percent + '%');
    el('main-overlay-size-value').value = percent + '%';
  }
  function selectOverlaySize(percent, sendToOverlay = true) {
    if (!Number.isInteger(percent) || percent < 50 || percent > 150 || percent % 10 !== 0) return;
    showOverlaySize(percent);
    localStorage.setItem(sizeKey, String(percent));
    if (sendToOverlay && mapOverlay && events) {
      events.emitTo('map-overlay', 'map-overlay-size-request', percent).catch(error => report('無法調整覆蓋地圖大小：' + String(error)));
    }
  }
  showOverlaySize(initialSize);
  const report = window.showMapNotice = (text, duration = 5000) => {
    clearTimeout(noticeTimer); document.querySelector('.notice').hidden = true;
    el('app-status').textContent = text; el('app-status').hidden = false;
    noticeTimer = setTimeout(() => { el('app-status').hidden = true; el('app-status').textContent = ''; }, duration);
  };
  setTimeout(() => { document.querySelector('.notice').hidden = true; }, 5000);
  function renderSidebar() {
    document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
    el('sidebar').hidden = sidebarCollapsed;
    el('sidebar-toggle').setAttribute('aria-expanded', String(!sidebarCollapsed));
    el('sidebar-toggle').title = sidebarCollapsed ? '展開側欄' : '收合側欄';
    el('sidebar-toggle').setAttribute('aria-label', el('sidebar-toggle').title);
  }
  function renderButtons() {
    el('topmost').textContent = topmost ? '置頂：開' : '置頂：關';
    el('topmost').setAttribute('aria-pressed', String(topmost));
    el('compact').textContent = mapOverlay ? overlayPaused ? '地圖已隱藏 · F1' : hotkeyError ? '地圖模式：開' : '地圖模式：開 · F1' : '地圖模式';
    el('compact').setAttribute('aria-pressed', String(mapOverlay));
    el('compact').title = mapOverlay ? hotkeyError || (overlayPaused ? '按 F1 恢復覆蓋地圖；點此完全關閉' : '按 F1 暫時隱藏覆蓋地圖；點此完全關閉') : '開啟獨立覆蓋地圖，之後可用 F1 隱藏／恢復';
  }
  function preferences() {
    return { map: el('map').value, difficulty: el('difficulty').value, iconSize: Number(el('icon-size').value),
      supplements: el('supplements').checked, bestRoute: el('best-route').checked,
      routeStart: el('route-start').value, routeNumber: el('route-number').value, debugLog: el('debug-log').checked,
      categories: [...document.querySelectorAll('[data-category]:checked')].map(e => e.dataset.category),
      topmost, compact: false, sidebarCollapsed };
  }
  let overlayPublishQueued=false;
  function publishOverlay() {
    if (!events || !mapOverlay || overlayPublishQueued) return;
    overlayPublishQueued=true;
    // Microtasks also run when the main window is minimized; animation frames do not.
    queueMicrotask(() => { overlayPublishQueued=false; sendOverlayState(); });
  }
  function sendOverlayState() {
    if (!events || !mapOverlay) return;
    events.emitTo('map-overlay', 'map-view-state', { ...preferences(), tracking: window.getTrackingSnapshot?.() || null,
      status: el('live-status').textContent, statusTitle: el('live-status').title, statusState: el('live-status').dataset.state,
      recognition: el('recognition-button').getAttribute('aria-checked') === 'true', recognitionBusy: el('recognition-button').disabled,
      trackingEnabled: el('tracking-button').getAttribute('aria-checked') === 'true', trackingBusy: el('tracking-button').disabled
    }).catch(() => {});
  }
  function save() {
    if (restoring) return;
    try { localStorage.setItem(key, JSON.stringify(preferences())); }
    catch { report('設定無法儲存，請確認資料夾可寫入。'); }
    publishOverlay();
  }
  async function setPinned(value) {
    if (!invoke) { report('置頂功能需在桌面應用內使用。'); return; }
    el('topmost').disabled = true;
    try { topmost = await invoke('set_topmost', { enabled: value }); renderButtons(); save(); }
    catch (error) { report('無法設定置頂：' + String(error)); }
    finally { el('topmost').disabled = false; }
  }
  async function setMapMode(value) {
    if (!invoke) { report('地圖模式需在桌面應用內使用。'); return; }
    el('compact').disabled = true;
    try {
      mapOverlay = value; overlayPaused = false; hotkeyError = ''; renderButtons();
      const placement = await invoke('set_map_overlay', { enabled: value, gameWindowId: el('game-window').value || null });
      if (value) {
        hotkeyError = placement?.hotkeyError || ''; renderButtons(); publishOverlay();
        report(hotkeyError || '覆蓋地圖已開啟。按 F1 隱藏／恢復，隱藏時可點擊下方遊戲；拖曳上方移動圖示可調整位置。', hotkeyError ? 10000 : 5000);
      }
    } catch (error) { mapOverlay = false; renderButtons(); report('無法切換地圖模式：' + String(error)); }
    finally { el('compact').disabled = false; }
  }
  if (events) {
    window.overlayBridgeReady = Promise.all([
      events.listen('map-overlay-ready', () => { mapOverlay = true; renderButtons(); publishOverlay(); events.emitTo('map-overlay', 'map-overlay-size-request', Number(overlaySize.value)).catch(() => {}); }),
      events.listen('map-overlay-closed', () => { mapOverlay = false; overlayPaused = false; hotkeyError = ''; renderButtons(); }),
      events.listen('map-overlay-paused', ({ payload }) => {
        overlayPaused = payload; renderButtons();
        report(payload ? '覆蓋地圖已隱藏，可點擊下方遊戲。按 F1 恢復；辨識與追蹤繼續運作。' : '覆蓋地圖已恢復。按 F1 可再次隱藏。');
      }),
      events.listen('map-overlay-action', ({ payload }) => {
        if (payload === 'recognition') el('recognition-button').click();
        if (payload === 'tracking') el('tracking-button').click();
        publishOverlay();
      }),
      events.listen('map-overlay-size-selected', ({ payload }) => selectOverlaySize(Number(payload), false))
    ]).catch(error => report('覆蓋地圖連線失敗：' + String(error)));
  }
  for (const name of ['tracking-update', 'tracking-stale', 'recognition-ui']) window.addEventListener(name, publishOverlay);
  el('topmost').addEventListener('click', () => setPinned(!topmost));
  el('compact').addEventListener('click', async () => { await window.overlayBridgeReady; await setMapMode(!mapOverlay); });
  overlaySize.addEventListener('input', () => selectOverlaySize(Number(overlaySize.value)));
  el('main-overlay-size-reset').addEventListener('click', () => selectOverlaySize(100));
  el('sidebar-toggle').addEventListener('click', () => { sidebarCollapsed = !sidebarCollapsed; renderSidebar(); save(); });
  el('discord-link').addEventListener('click', async event => {
    if (invoke) event.preventDefault();
    if (invoke) {
      try { await invoke('open_discord'); }
      catch (error) { report('無法開啟 Discord，請在瀏覽器輸入 https://discord.gg/Yh235uyafn（' + String(error) + '）', 10000); }
    }
  });
  el('help-button').onclick = () => el('help-dialog').showModal();
  el('close-help').onclick = () => el('help-dialog').close();
  el('help-dialog').addEventListener('close', () => el('help-button').focus());
  document.addEventListener('change', save);
  el('icon-size').addEventListener('input', save);
  for (const id of ['all', 'none']) el(id).addEventListener('click', save);
  window.desktopReady = (async () => {
    try {
      const settings = JSON.parse(localStorage.getItem(key) || 'null');
      if (settings) {
        for (const id of ['map', 'difficulty']) {
          if ([...el(id).options].some(o => o.value === String(settings[id]))) el(id).value = String(settings[id]);
        }
        if (typeof settings.supplements === 'boolean') el('supplements').checked = settings.supplements;
        el('best-route').checked = settings.bestRoute === true;
        if (['auto', 'entrance', 'exit'].includes(settings.routeStart)) el('route-start').value = settings.routeStart;
        if (['1', '2'].includes(settings.routeNumber)) el('route-number').value = settings.routeNumber;
        el('debug-log').checked = settings.debugLog === true;
        sidebarCollapsed = settings.sidebarCollapsed === true;
        renderSidebar();
        if (Number.isFinite(settings.iconSize)) el('icon-size').value = String(Math.min(250, Math.max(75, settings.iconSize)));
        el('icon-size').dispatchEvent(new Event('input'));
        // The old chest checkbox covered both types, including with quality 5 selected.
        if (Array.isArray(settings.categories)) for (const e of document.querySelectorAll('[data-category]')) {
          e.checked = settings.categories.includes(e.dataset.category) ||
            (e.dataset.category.startsWith('chest_') && settings.categories.includes('chest'));
        }
        el('map').dispatchEvent(new Event('change'));
        if (settings.topmost === false) await setPinned(false);
      }
      // Map mode is opened only by an explicit click; only sidebarCollapsed hides the panel.
    } catch { report('先前設定無法讀取，已使用預設值。'); }
    finally { restoring = false; renderButtons(); renderSidebar(); }
  })();
  renderButtons();
})();
