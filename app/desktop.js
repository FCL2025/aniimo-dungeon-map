'use strict';
(() => {
  const invoke = window.__TAURI__?.core.invoke, events = window.__TAURI__?.event;
  const el = id => document.getElementById(id), key = 'aniimo-dungeon-preferences-v1';
  let topmost = true, mapOverlay = false, restoring = true, noticeTimer;
  const report = window.showMapNotice = (text, duration = 5000) => {
    clearTimeout(noticeTimer); document.querySelector('.notice').hidden = true;
    el('app-status').textContent = text; el('app-status').hidden = false;
    noticeTimer = setTimeout(() => { el('app-status').hidden = true; el('app-status').textContent = ''; }, duration);
  };
  setTimeout(() => { document.querySelector('.notice').hidden = true; }, 5000);
  function renderButtons() {
    el('topmost').textContent = topmost ? '置頂：開' : '置頂：關';
    el('topmost').setAttribute('aria-pressed', String(topmost));
    el('compact').textContent = mapOverlay ? '地圖模式：開' : '地圖模式';
    el('compact').setAttribute('aria-pressed', String(mapOverlay));
    el('compact').title = mapOverlay ? '關閉獨立覆蓋地圖' : '開啟 448 × 464 的獨立覆蓋地圖';
  }
  function preferences() {
    return { map: el('map').value, difficulty: el('difficulty').value, quality: el('quality').value,
      supplements: el('supplements').checked,
      categories: [...document.querySelectorAll('[data-category]:checked')].map(e => e.dataset.category),
      topmost, compact: false };
  }
  function publishOverlay() {
    if (!events || !mapOverlay) return;
    events.emitTo('map-overlay', 'map-view-state', { ...preferences(), tracking: window.getTrackingSnapshot?.() || null,
      status: el('live-status').textContent, statusTitle: el('live-status').title, statusState: el('live-status').dataset.state,
      recognition: el('recognition-button').getAttribute('aria-checked') === 'true', recognitionBusy: el('recognition-button').disabled
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
      mapOverlay = value; renderButtons();
      const placement = await invoke('set_map_overlay', { enabled: value, gameWindowId: el('game-window').value || null });
      if (value) { publishOverlay(); report(placement?.gameFound ? '覆蓋地圖已開啟；原視窗可保留或最小化，再按「地圖模式」即可關閉。' : '覆蓋地圖已開啟在螢幕左側；可拖曳地宮編號調整位置。'); }
    } catch (error) { mapOverlay = false; renderButtons(); report('無法切換地圖模式：' + String(error)); }
    finally { el('compact').disabled = false; }
  }
  if (events) {
    window.overlayBridgeReady = Promise.all([
      events.listen('map-overlay-ready', () => { mapOverlay = true; renderButtons(); publishOverlay(); }),
      events.listen('map-overlay-closed', () => { mapOverlay = false; renderButtons(); }),
      events.listen('map-overlay-action', ({ payload }) => {
        if (payload === 'new-session') el('new-session').click();
        if (payload === 'recognition') el('recognition-button').click();
        publishOverlay();
      })
    ]).catch(error => report('覆蓋地圖連線失敗：' + String(error)));
  }
  for (const name of ['tracking-update', 'tracking-stale', 'recognition-ui']) window.addEventListener(name, publishOverlay);
  el('topmost').addEventListener('click', () => setPinned(!topmost));
  el('compact').addEventListener('click', async () => { await window.overlayBridgeReady; await setMapMode(!mapOverlay); });
  el('help-button').onclick = () => el('help-dialog').showModal();
  el('close-help').onclick = () => el('help-dialog').close();
  document.addEventListener('change', save);
  for (const id of ['all', 'none']) el(id).addEventListener('click', save);
  window.desktopReady = (async () => {
    try {
      const settings = JSON.parse(localStorage.getItem(key) || 'null');
      if (settings) {
        for (const id of ['map', 'difficulty', 'quality']) {
          if ([...el(id).options].some(o => o.value === String(settings[id]))) el(id).value = String(settings[id]);
        }
        if (typeof settings.supplements === 'boolean') el('supplements').checked = settings.supplements;
        if (Array.isArray(settings.categories)) for (const e of document.querySelectorAll('[data-category]')) e.checked = settings.categories.includes(e.dataset.category);
        el('map').dispatchEvent(new Event('change'));
        if (settings.topmost === false) await setPinned(false);
      }
      // Map mode is opened only by an explicit click; legacy compact settings never hide the panel.
    } catch { report('先前設定無法讀取，已使用預設值。'); }
    finally { restoring = false; renderButtons(); }
  })();
  renderButtons();
})();
