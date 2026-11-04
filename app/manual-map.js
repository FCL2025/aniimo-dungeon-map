'use strict';
(() => {
  const { msg, bind } = window.I18n, { candidates } = window.ManualMapCore;
  const el = id => document.getElementById(id), dialog = el('manual-map-dialog');
  const overlay = document.body.classList.contains('overlay');
  const maps = DUNGEON_DATA.maps, directionButtons = [];
  let filter = null, view = 'portals', busy = false, pending = null, requestSequence = 0;
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
  bind(el('manual-map-views'), msg('manual.view'), 'attr:aria-label');
  for (const kind of ['entrance', 'exit']) {
    const icon = node('img');
    icon.src = DUNGEON_DATA.icons.assets[DUNGEON_DATA.icons.categories[kind]].image;
    icon.alt = '';
    const label = dialog.querySelector('.manual-map-' + kind);
    // Keep the translated text separate so switching language preserves the icon.
    const wrapper = node('span', null, 'manual-map-legend-item');
    label.replaceWith(wrapper); wrapper.append(icon, label);
  }
  function positionDialog() {
    // Center the picker over the map area while leaving the toolbar and sidebar usable.
    const bounds = document.querySelector('.stage').getBoundingClientRect();
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
      filter = direction; renderCandidates(); dialog.scrollTop = 0; el('manual-map-result-title').focus();
    };
    directionButtons.push(button); el('manual-map-compass').append(button);
  }
  function svgNode(tag, attributes) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }
  function comparisonFrame(matches) {
    // Crop shared empty space, never fit each map independently: entrances and
    // pixel scale must match across the candidates currently being compared.
    const vectors = matches.map(map => ManualMapCore.vector(map)).filter(Boolean);
    const xs = [0, ...vectors.map(v => v.dx)], ys = [0, ...vectors.map(v => v.dy)];
    const left = Math.min(...xs), top = Math.min(...ys);
    const width = Math.max(...xs) - left, height = Math.max(...ys) - top;
    const padding = Math.max(1, width, height) * .18;
    return { box:[left - padding, top - padding, width + padding * 2, height + padding * 2], iconSize:padding * 1.25 };
  }
  function preview(map, frame) {
    const relative = view === 'portals' && ManualMapCore.vector(map);
    const svg = svgNode('svg', { viewBox: relative ? frame.box.join(' ') : `0 0 ${map.size[0]} ${map.size[1]}`, 'aria-hidden': 'true', class:'manual-map-preview' });
    if (relative) {
      const [x, y, width, height] = frame.box;
      svg.style.aspectRatio = `${width} / ${height}`;
      svg.append(svgNode('path', { d:`M ${x} 0 H ${x + width} M 0 ${y} V ${y + height}`, stroke:'#79cabe26', 'stroke-width':5, fill:'none' }));
    } else svg.append(svgNode('image', { href: map.image, width: map.size[0], height: map.size[1], class:'manual-map-terrain-image' }));
    const geometry = relative ? { entrance:[0, 0], exit:[relative.dx, relative.dy] } : ManualMapCore.vector(map) && map.portalGeometry;
    if (geometry) {
      const [x, y] = geometry.entrance, [ex, ey] = geometry.exit;
      svg.append(svgNode('line', { x1:x, y1:y, x2:ex, y2:ey, stroke:'#e8edf099', 'stroke-width':14, 'stroke-dasharray':'35 25' }));
      const iconSize = relative ? frame.iconSize : Math.max(...map.size) * .105;
      for (const kind of ['entrance', 'exit']) {
        const point = geometry[kind], icon = DUNGEON_DATA.icons.assets[DUNGEON_DATA.icons.categories[kind]].image;
        svg.append(svgNode('image', { href:icon, x:point[0] - iconSize / 2, y:point[1] - iconSize / 2, width:iconSize, height:iconSize, class:'manual-portal-' + kind }));
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
    el('manual-map-portals').setAttribute('aria-pressed', String(view === 'portals'));
    el('manual-map-terrain').setAttribute('aria-pressed', String(view === 'terrain'));
    bind(el('manual-map-view-hint'), msg(view === 'portals' ? 'manual.portalHint' : 'manual.terrainHint'));
    if (filter === null) return;
    const matches = candidates(maps, filter === 'all' ? null : filter);
    const frame = comparisonFrame(matches);
    bind(el('manual-map-result-title'), msg('manual.results', { direction:msg(filter === 'all' ? 'manual.all' : 'manual.' + filter), count:matches.length }));
    for (const map of matches) {
      const button = node('button', null, 'manual-map-card');
      button.type = 'button'; button.dataset.mapId = map.id; button.disabled = busy;
      bind(button, msg('map.name', { id:map.id }), 'attr:aria-label');
      button.append(preview(map, frame));
      const label = node('strong'); label.textContent = String(map.id); button.append(label);
      // Distinguish the two westward exits without screen-scale-dependent pixel distances.
      const direction = ManualMapCore.direction(map);
      const geometry = ManualMapCore.vector(map);
      const hint = direction === 'left' && geometry.dy > geometry.distance * .15 ? 'manual.leftLower' : 'manual.' + direction;
      const caption = node('span', null, 'manual-card-caption');
      if (direction) caption.append(node('span', hint, 'manual-card-direction'));
      const distanceHint = ManualMapCore.distanceHint(map, maps);
      if (distanceHint) caption.append(node('span', 'manual.' + distanceHint, 'manual-card-distance'));
      caption.id = `manual-card-caption-${map.id}`;
      button.append(caption); button.setAttribute('aria-describedby', caption.id);
      const nearby = filter !== 'all' && direction !== filter;
      button.classList.toggle('manual-map-nearby', nearby);
      if (nearby) caption.append(node('span', 'manual.nearby', 'manual-card-nearby'));
      button.onclick = () => void choose(map.id); el('manual-map-candidates').append(button);
    }
  }
  function setBusy(value) {
    busy = value;
    for (const button of directionButtons) button.disabled = value || !candidates(maps, button.dataset.direction).length;
    for (const button of el('manual-map-candidates').children) button.disabled = value;
    el('manual-map-all').disabled = value;
    el('manual-map-portals').disabled = value;
    el('manual-map-terrain').disabled = value;
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
    filter = null; view = 'portals'; renderCandidates(); el('manual-map-message').textContent = '';
    positionDialog();
    if (!dialog.open) dialog.show();
    setBusy(true);
    try { await enterManualMode(); }
    catch (error) { bind(el('manual-map-message'), I18n.error(error)); }
    finally { setBusy(false); if (dialog.open && dialog.contains(document.activeElement)) directionButtons.find(button => !button.disabled)?.focus(); }
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
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !dialog.open || document.querySelector('dialog:modal')) return;
    event.preventDefault();
    dialog.close();
  });
  el('manual-map-all').onclick = () => { filter = 'all'; renderCandidates(); dialog.scrollTop = 0; el('manual-map-result-title').focus(); };
  el('manual-map-back').onclick = () => { const previous = filter; filter = null; renderCandidates(); dialog.scrollTop = 0; (directionButtons.find(button => button.dataset.direction === previous) || directionButtons.find(button => !button.disabled))?.focus(); };
  for (const kind of ['portals', 'terrain']) el('manual-map-' + kind).onclick = () => { view = kind; renderCandidates(); };
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
      if (saved?.mode === 'pvp') return;
      if (!maps.some(map => String(map.id) === String(saved?.map))) return open();
    });
  }
})();
