'use strict';
(() => {
  const { msg, bind } = window.I18n;
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
      events.emitTo('map-overlay', 'map-overlay-size-request', percent).catch(error => report(msg('error.operation', { error: I18n.error(error) })));
    }
  }
  showOverlaySize(initialSize);
  const report = window.showMapNotice = (text, duration = 5000) => {
    clearTimeout(noticeTimer); document.querySelector('.notice').hidden = true;
    bind(el('app-status'), text); el('app-status').hidden = false;
    noticeTimer = setTimeout(() => { el('app-status').hidden = true; el('app-status').textContent = ''; }, duration);
  };
  setTimeout(() => { document.querySelector('.notice').hidden = true; }, 5000);
  function renderSidebar() {
    document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
    el('sidebar').hidden = sidebarCollapsed;
    el('sidebar-toggle').setAttribute('aria-expanded', String(!sidebarCollapsed));
    bind(el('sidebar-toggle'), msg(sidebarCollapsed ? 'sidebar.expand' : 'sidebar.collapse'), 'title');
    bind(el('sidebar-toggle'), msg(sidebarCollapsed ? 'sidebar.expand' : 'sidebar.collapse'), 'attr:aria-label');
  }
  function renderButtons() {
    bind(el('topmost'), msg('switch', { label: msg('topmost'), state: msg(topmost ? 'on' : 'off') }));
    el('topmost').setAttribute('aria-pressed', String(topmost));
    bind(el('compact'), mapOverlay ? overlayPaused ? msg('overlay.hidden') : msg('switch', { label: msg('overlay'), state: msg('overlay.on', { shortcut: hotkeyError ? '' : ' · F1' }) }) : msg('overlay'));
    el('compact').setAttribute('aria-pressed', String(mapOverlay));
    bind(el('compact'), mapOverlay ? hotkeyError ? I18n.error(hotkeyError) : msg('overlay.closeHint') : msg('overlay.openHint'), 'title');
  }
  function preferences() {
    return { locale: I18n.locale, map: el('map').value, difficulty: el('difficulty').value, iconSize: Number(el('icon-size').value),
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
      status: el('live-status').textContent, statusTitle: el('live-status').title, statusState: el('live-status').dataset.state, statusKey: el('live-status').dataset.statusKey,
      recognition: el('recognition-button').getAttribute('aria-checked') === 'true', recognitionBusy: el('recognition-button').disabled,
      trackingEnabled: el('tracking-button').getAttribute('aria-checked') === 'true', trackingBusy: el('tracking-button').disabled
    }).catch(() => {});
  }
  function save() {
    if (restoring) return;
    try { localStorage.setItem(key, JSON.stringify(preferences())); }
    catch { report(msg('error.save')); }
    publishOverlay();
  }
  async function setPinned(value) {
    if (!invoke) { report(msg('error.desktop')); return; }
    el('topmost').disabled = true;
    try { topmost = await invoke('set_topmost', { enabled: value }); renderButtons(); save(); }
    catch (error) { report(msg('error.operation', { error: I18n.error(error) })); }
    finally { el('topmost').disabled = false; }
  }
  async function setMapMode(value) {
    if (!invoke) { report(msg('error.desktop')); return; }
    el('compact').disabled = true;
    try {
      mapOverlay = value; overlayPaused = false; hotkeyError = ''; renderButtons();
      const placement = await invoke('set_map_overlay', { enabled: value, gameWindowId: el('game-window').value || null });
      if (value) {
        hotkeyError = placement?.hotkeyError || ''; renderButtons(); publishOverlay();
        report(hotkeyError ? I18n.error(hotkeyError) : msg('help.overlay'), hotkeyError ? 10000 : 5000);
      }
    } catch (error) { mapOverlay = false; renderButtons(); report(msg('error.operation', { error: I18n.error(error) })); }
    finally { el('compact').disabled = false; }
  }
  if (events) {
    window.overlayBridgeReady = Promise.all([
      events.listen('map-overlay-ready', () => { mapOverlay = true; renderButtons(); publishOverlay(); events.emitTo('map-overlay', 'map-overlay-size-request', Number(overlaySize.value)).catch(() => {}); }),
      events.listen('map-overlay-closed', () => { mapOverlay = false; overlayPaused = false; hotkeyError = ''; renderButtons(); }),
      events.listen('map-overlay-paused', ({ payload }) => {
        overlayPaused = payload; renderButtons();
        report(msg(payload ? 'overlay.hidden' : 'overlay.openHint'));
      }),
      events.listen('map-overlay-action', ({ payload }) => {
        if (payload === 'recognition') el('recognition-button').click();
        if (payload === 'tracking') el('tracking-button').click();
        publishOverlay();
      }),
      events.listen('map-overlay-size-selected', ({ payload }) => selectOverlaySize(Number(payload), false))
    ]).catch(error => report(msg('error.operation', { error: I18n.error(error) })));
  }
  for (const name of ['tracking-update', 'tracking-stale', 'recognition-ui']) window.addEventListener(name, publishOverlay);
  window.addEventListener('languagechange', save);
  el('topmost').addEventListener('click', () => setPinned(!topmost));
  el('compact').addEventListener('click', async () => { await window.overlayBridgeReady; await setMapMode(!mapOverlay); });
  overlaySize.addEventListener('input', () => selectOverlaySize(Number(overlaySize.value)));
  el('main-overlay-size-reset').addEventListener('click', () => selectOverlaySize(100));
  el('sidebar-toggle').addEventListener('click', () => { sidebarCollapsed = !sidebarCollapsed; renderSidebar(); save(); });
  el('discord-link').addEventListener('click', async event => {
    if (invoke) event.preventDefault();
    if (invoke) {
      try { await invoke('open_discord'); }
      catch (error) { report(msg('error.operation', { error: String(error) + ' · https://discord.gg/Yh235uyafn' }), 10000); }
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
    } catch { report(msg('error.restore')); }
    finally { restoring = false; renderButtons(); renderSidebar(); }
  })();
  renderButtons();
})();
