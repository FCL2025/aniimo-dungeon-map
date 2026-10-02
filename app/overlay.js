'use strict';
(() => {
  const { msg, bind } = window.I18n;
  const el = id => document.getElementById(id), { core, event } = window.__TAURI__;
  let noticeTimer, lastNotice = '', viewKey = '', lastTracking = '';
  function notice(text) {
    clearTimeout(noticeTimer); bind(el('app-status'), text); el('app-status').hidden = false;
    noticeTimer = setTimeout(() => { el('app-status').hidden = true; el('app-status').textContent = ''; }, 5000);
  }
  document.querySelector('.notice').hidden = true;
  bind(el('recognition-button'), msg('recognition'));
  bind(el('tracking-button'), msg('tracking'));
  const size = el('overlay-size'), sizeKey = 'aniimo-overlay-size-v1';
  const savedSize = Number(localStorage.getItem(sizeKey));
  if (savedSize >= 50 && savedSize <= 150 && savedSize % 10 === 0) size.value = String(savedSize);
  let pendingSize = null, applyingSize = false;
  const showSize = percent => {
    size.value = String(percent);
    window.overlaySizeRatio = percent / 100;
    window.dispatchEvent(new Event('overlay-size-changed'));
    size.setAttribute('aria-valuetext', percent + '%');
    bind(size, msg('overlay.sizeValue', { value: percent }), 'title');
  };
  const applyPendingSize = async () => {
    if (applyingSize) return;
    applyingSize = true;
    while (pendingSize !== null) {
      const percent = pendingSize;
      pendingSize = null;
      try { await core.invoke('set_overlay_scale', { percent }); }
      catch (error) { notice(msg('error.operation', { error: I18n.error(error) })); }
    }
    applyingSize = false;
  };
  const resizeOverlay = (percent, notifyMain) => {
    if (!Number.isInteger(percent) || percent < 50 || percent > 150 || percent % 10 !== 0) return;
    showSize(percent);
    localStorage.setItem(sizeKey, String(percent));
    pendingSize = percent;
    void applyPendingSize();
    if (notifyMain) event.emitTo('main', 'map-overlay-size-selected', percent).catch(error => notice(String(error)));
  };
  size.addEventListener('input', () => {
    size.setAttribute('aria-valuetext', size.value + '%');
    bind(size, msg('overlay.sizePending', { value: size.value }), 'title');
  });
  size.addEventListener('change', () => resizeOverlay(Number(size.value), true));
  const sizeListener = event.listen('map-overlay-size-request', ({ payload }) => resizeOverlay(Number(payload), false));
  resizeOverlay(Number(size.value), false);
  el('overlay-close').onclick = () => core.invoke('set_map_overlay', { enabled: false }).catch(error => notice(String(error)));
  el('recognition-button').onclick = () => {
    el('recognition-button').disabled = true;
    event.emitTo('main', 'map-overlay-action', 'recognition').catch(error => { el('recognition-button').disabled = false; notice(String(error)); });
  };
  el('tracking-button').onclick = () => {
    el('tracking-button').disabled = true;
    event.emitTo('main', 'map-overlay-action', 'tracking').catch(error => { el('tracking-button').disabled = false; notice(String(error)); });
  };
  el('overlay-drag').onmousedown = e => { if (e.button === 0) { e.preventDefault(); core.invoke('drag_window').catch(error => notice(String(error))); } };
  window.overlayReady = Promise.all([sizeListener, event.listen('map-view-state', ({ payload: state }) => {
    I18n.setLocale(state.locale, { persist: false });
    const nextKey = JSON.stringify([state.map, state.difficulty, state.iconSize, state.supplements, state.bestRoute, state.routeStart, state.routeNumber, state.categories]);
    if (nextKey !== viewKey) {
      const mapChanged = el('map').value !== String(state.map);
      for (const id of ['map', 'difficulty']) if ([...el(id).options].some(o => o.value === String(state[id]))) el(id).value = String(state[id]);
      el('icon-size').value = String(Number.isFinite(state.iconSize) ? state.iconSize : 150);
      el('icon-size').dispatchEvent(new Event('input'));
      el('supplements').checked = state.supplements !== false;
      el('best-route').checked = state.bestRoute === true;
      el('route-start').value = ['auto', 'entrance', 'exit'].includes(state.routeStart) ? state.routeStart : 'auto';
      el('route-number').value = ['1', '2'].includes(state.routeNumber) ? state.routeNumber : '1';
      for (const e of document.querySelectorAll('[data-category]')) e.checked = state.categories.includes(e.dataset.category);
      el(mapChanged ? 'map' : 'difficulty').dispatchEvent(new Event('change'));
      viewKey = nextKey;
    }
    const trackingKey = JSON.stringify(state.tracking);
    if (trackingKey !== lastTracking) { window.dispatchEvent(new CustomEvent('tracking-update', { detail: state.tracking })); lastTracking = trackingKey; }
    const manualSelection = state.statusKey === 'status.manual';
    el('live-status').textContent = manualSelection ? '' : state.status;
    el('live-status').title = manualSelection ? '' : state.statusTitle;
    el('live-status').dataset.state = state.statusState || 'waiting';
    el('recognition-button').setAttribute('aria-checked', String(state.recognition));
    bind(el('recognition-button'), msg(state.recognition ? 'recognition.disable' : 'recognition.enable'), 'title');
    el('recognition-button').disabled = state.recognitionBusy;
    el('tracking-button').setAttribute('aria-checked', String(!!state.trackingEnabled));
    bind(el('tracking-button'), msg(state.trackingEnabled ? 'tracking.disable' : 'tracking.enable'), 'title');
    el('tracking-button').disabled = state.trackingBusy;
    window.dispatchEvent(new Event('tracking-ui'));
    const noticeKey = JSON.stringify([state.map, state.status, state.statusState]);
    if (noticeKey !== lastNotice && state.statusTitle && !manualSelection) notice(state.statusTitle);
    lastNotice = noticeKey;
  })]).then(() => event.emitTo('main', 'map-overlay-ready')).catch(error => notice(msg('error.operation', { error: I18n.error(error) })));
  setInterval(() => { const point = window.getTrackingSnapshot?.(); if (point && !point.stale && Date.now() - point.at > 1500) window.dispatchEvent(new CustomEvent('tracking-stale')); }, 250);
})();
