'use strict';
(() => {
  const { msg, bind } = window.I18n, { candidates } = window.ManualMapCore;
  const el = id => document.getElementById(id), dialog = el('manual-map-dialog');
  const overlay = document.body.classList.contains('overlay');
  const maps = DUNGEON_DATA.maps, directionButtons = [];
  let filter = null, busy = false, pending = null, requestSequence = 0;
  const symbols = [['upLeft','↖'],['up','↑'],['upRight','↗'],['left','←'],null,['right','→'],['downLeft','↙'],['down','↓'],['downRight','↘']];
  const node = (tag, key, className) => {
    const element = document.createElement(tag);
    if (key) bind(element, msg(key));
    if (className) element.className = className;
    return element;
  };
  bind(el('manual-map-button'), msg(overlay ? 'manual.reset' : 'manual.open'));
  bind(el('manual-map-button'), msg('manual.title'), 'title');
  bind(el('manual-map-close'), msg('close'), 'attr:aria-label');
  bind(el('manual-map-close'), msg('close'), 'title');
  bind(el('manual-map-back'), msg('manual.back'), 'attr:aria-label');
  bind(el('manual-map-back'), msg('manual.back'), 'title');
  function positionDialog() {
    // A modal lives in the top layer, so its default center ignores the sidebar.
    const bounds = overlay ? { left:0, top:0, right:innerWidth, bottom:innerHeight, width:innerWidth, height:innerHeight }
      : document.querySelector('.stage').getBoundingClientRect();
    dialog.style.setProperty('--manual-map-inset', `${bounds.top}px ${innerWidth - bounds.right}px ${innerHeight - bounds.bottom}px ${bounds.left}px`);
    dialog.style.setProperty('--manual-map-width', `${Math.max(0, bounds.width - 16)}px`);
    dialog.style.setProperty('--manual-map-height', `${Math.max(0, bounds.height - 16)}px`);
    dialog.classList.toggle('manual-map-narrow', bounds.width <= 540);
    dialog.classList.toggle('manual-map-short', bounds.height <= 400);
  }
  if (!overlay) new ResizeObserver(positionDialog).observe(document.querySelector('.stage'));
  window.addEventListener('resize', positionDialog);
  for (const item of symbols) {
    if (!item) {
      const center = node('div', null, 'manual-map-center'), icon = node('img');
      icon.src = DUNGEON_DATA.icons.assets[DUNGEON_DATA.icons.categories.entrance].image;
      icon.alt = ''; center.append(icon, node('span', 'category.entrance')); el('manual-map-compass').append(center);
      continue;
    }
    const [direction, arrow] = item, matches = candidates(maps, direction);
    const button = node('button', null, 'manual-direction'), symbol = node('span', null, 'manual-direction-arrow');
    button.type = 'button'; button.dataset.direction = direction;
    button.classList.toggle('manual-direction-empty', !matches.length);
    symbol.textContent = arrow; symbol.setAttribute('aria-hidden', 'true');
    button.append(symbol, node('span', 'manual.' + direction));
    const count = node('span', null, 'manual-direction-count');
    bind(count, matches.length ? msg('manual.count', { count: matches.length }) : msg('manual.empty'));
    button.append(count); button.disabled = !matches.length;
    button.onclick = () => {
      if (matches.length === 1) void choose(matches[0].id);
      else { filter = direction; renderCandidates(); el('manual-map-result-title').focus(); }
    };
    directionButtons.push(button); el('manual-map-compass').append(button);
  }
  function svgNode(tag, attributes) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }
  function preview(map) {
    const svg = svgNode('svg', { viewBox: `0 0 ${map.size[0]} ${map.size[1]}`, 'aria-hidden': 'true' });
    svg.append(svgNode('image', { href: map.image, width: map.size[0], height: map.size[1] }));
    const geometry = map.portalGeometry;
    if (geometry) {
      const [x, y] = geometry.entrance, [ex, ey] = geometry.exit;
      svg.append(svgNode('line', { x1:x, y1:y, x2:ex, y2:ey, stroke:'#e8edf0', 'stroke-width':18, 'stroke-dasharray':'35 25' }));
      for (const [point, color] of [[geometry.entrance, '#79cabe'], [geometry.exit, '#ff8798']]) {
        svg.append(svgNode('circle', { cx:point[0], cy:point[1], r:65, fill:color, stroke:'#172731', 'stroke-width':22 }));
      }
    }
    return svg;
  }
  function renderCandidates() {
    const results = dialog.querySelector('.manual-map-results');
    results.hidden = filter === null;
    dialog.classList.toggle('has-candidates', filter !== null);
    el('manual-map-candidates').replaceChildren();
    for (const button of directionButtons) button.setAttribute('aria-pressed', String(button.dataset.direction === filter));
    el('manual-map-all').setAttribute('aria-pressed', String(filter === 'all'));
    if (filter === null) return;
    const matches = candidates(maps, filter === 'all' ? null : filter);
    bind(el('manual-map-result-title'), msg('manual.results', { direction:msg(filter === 'all' ? 'manual.all' : 'manual.' + filter), count:matches.length }));
    for (const map of matches) {
      const button = node('button', null, 'manual-map-card');
      button.type = 'button'; button.dataset.mapId = map.id; button.disabled = busy;
      bind(button, msg('map.name', { id:map.id }), 'attr:aria-label');
      button.append(preview(map));
      const label = node('strong'); label.textContent = String(map.id); button.append(label);
      // Distinguish the two westward exits without screen-scale-dependent pixel distances.
      const direction = ManualMapCore.direction(map);
      const geometry = map.portalGeometry;
      const hint = direction === 'left' && geometry.exit[1] - geometry.entrance[1] > geometry.distance * .15 ? 'manual.leftLower' : 'manual.' + direction;
      if (direction) button.append(node('span', hint));
      button.onclick = () => void choose(map.id); el('manual-map-candidates').append(button);
    }
  }
  function setBusy(value) {
    busy = value;
    for (const button of directionButtons) button.disabled = value || !candidates(maps, button.dataset.direction).length;
    for (const button of el('manual-map-candidates').children) button.disabled = value;
    el('manual-map-all').disabled = value;
  }
  async function enterManualMode(mapId) {
    if (!overlay) return window.enterManualMode(mapId);
    await window.manualMapReady;
    const requestId = ++requestSequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending = null; reject(msg('manual.retry')); }, 10000);
      pending = { requestId, resolve, reject, timer };
      window.__TAURI__.event.emitTo('main', 'map-overlay-manual', { requestId, mapId }).catch(error => {
        if (pending?.requestId !== requestId) return;
        clearTimeout(timer); pending = null; reject(error);
      });
    });
  }
  async function open() {
    if (busy) return;
    filter = null; renderCandidates(); el('manual-map-message').textContent = '';
    positionDialog();
    if (!dialog.open) dialog.showModal();
    setBusy(true);
    try { await enterManualMode(); }
    catch (error) { bind(el('manual-map-message'), I18n.error(error)); }
    finally { setBusy(false); if (dialog.open) directionButtons.find(button => !button.disabled)?.focus(); }
  }
  async function choose(mapId) {
    if (busy) return;
    setBusy(true); el('manual-map-message').textContent = '';
    try { await enterManualMode(mapId); dialog.close(); }
    catch (error) { bind(el('manual-map-message'), I18n.error(error)); }
    finally { setBusy(false); }
  }
  el('manual-map-button').onclick = () => void open();
  el('manual-map-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => el('manual-map-button').focus());
  el('manual-map-all').onclick = () => { filter = 'all'; renderCandidates(); el('manual-map-result-title').focus(); };
  el('manual-map-back').onclick = () => { filter = null; renderCandidates(); dialog.scrollTop = 0; directionButtons.find(button => !button.disabled)?.focus(); };
  window.addEventListener('recognition-ui', () => {
    if (!busy && el('recognition-button').getAttribute('aria-checked') === 'true' && dialog.open) dialog.close();
  });
  if (overlay) {
    window.manualMapReady = window.__TAURI__.event.listen('map-overlay-manual-result', ({ payload }) => {
      if (pending?.requestId !== payload.requestId) return;
      const request = pending; pending = null; clearTimeout(request.timer);
      payload.ok ? request.resolve() : request.reject(payload.error);
    });
  } else {
    window.manualMapReady = Promise.resolve(window.desktopReady).then(() => {
      let saved;
      try { saved = JSON.parse(localStorage.getItem('aniimo-dungeon-preferences-v1')); } catch { /* First run. */ }
      if (!maps.some(map => String(map.id) === String(saved?.map))) return open();
    });
  }
})();
