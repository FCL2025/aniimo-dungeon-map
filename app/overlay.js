'use strict';
(() => {
  const el = id => document.getElementById(id), { core, event } = window.__TAURI__;
  let noticeTimer, lastNotice = '', viewKey = '', lastTracking = '';
  function notice(text) {
    clearTimeout(noticeTimer); el('app-status').textContent = text; el('app-status').hidden = false;
    noticeTimer = setTimeout(() => { el('app-status').hidden = true; el('app-status').textContent = ''; }, 5000);
  }
  document.querySelector('.notice').hidden = true;
  el('recognition-button').textContent = '辨識';
  el('tracking-button').textContent = '追蹤';
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
  window.overlayReady = event.listen('map-view-state', ({ payload: state }) => {
    const nextKey = JSON.stringify([state.map, state.difficulty, state.iconSize, state.categories]);
    if (nextKey !== viewKey) {
      const mapChanged = el('map').value !== String(state.map);
      for (const id of ['map', 'difficulty']) if ([...el(id).options].some(o => o.value === String(state[id]))) el(id).value = String(state[id]);
      el('icon-size').value = String(Number.isFinite(state.iconSize) ? state.iconSize : 150);
      el('icon-size').dispatchEvent(new Event('input'));
      for (const e of document.querySelectorAll('[data-category]')) e.checked = state.categories.includes(e.dataset.category);
      el(mapChanged ? 'map' : 'difficulty').dispatchEvent(new Event('change'));
      viewKey = nextKey;
    }
    const trackingKey = JSON.stringify(state.tracking);
    if (trackingKey !== lastTracking) { window.dispatchEvent(new CustomEvent('tracking-update', { detail: state.tracking })); lastTracking = trackingKey; }
    const manualSelection = state.status === '手動選圖';
    el('live-status').textContent = manualSelection ? '' : state.status;
    el('live-status').title = manualSelection ? '' : state.statusTitle;
    el('live-status').dataset.state = state.statusState || 'waiting';
    el('recognition-button').setAttribute('aria-checked', String(state.recognition));
    el('recognition-button').title = state.recognition ? '關閉辨識' : '重新辨識本場地宮';
    el('recognition-button').disabled = state.recognitionBusy;
    el('tracking-button').setAttribute('aria-checked', String(!!state.trackingEnabled));
    el('tracking-button').title = state.trackingEnabled ? '關閉人物追蹤' : '開啟人物追蹤';
    el('tracking-button').disabled = state.trackingBusy;
    window.dispatchEvent(new Event('tracking-ui'));
    const noticeKey = JSON.stringify([state.map, state.status, state.statusState]);
    if (noticeKey !== lastNotice && state.statusTitle && !manualSelection) notice(state.statusTitle);
    lastNotice = noticeKey;
  }).then(() => event.emitTo('main', 'map-overlay-ready')).catch(error => notice('無法同步主視窗：' + String(error)));
  setInterval(() => { const point = window.getTrackingSnapshot?.(); if (point && !point.stale && Date.now() - point.at > 1500) window.dispatchEvent(new CustomEvent('tracking-stale')); }, 250);
})();
