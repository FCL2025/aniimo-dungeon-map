// Run with agent-browser eval --stdin in an isolated native EXE or the offline viewer.
(async () => {
  const el = id => document.getElementById(id), delay = ms => new Promise(r => setTimeout(r, ms));
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const change = (id, value) => { el(id).value = value; el(id).dispatchEvent(new Event('change', { bubbles: true })); };
  const wheel = (id, deltaY, options = {}) => el(id).dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...options }));
  await window.desktopReady;
  assert(DUNGEON_DATA.maps.length === 7, 'Expected seven maps');
  assert(document.querySelectorAll('[data-category]').length === 8, 'Expected eight categories');
  assert(!el('quality'), 'Quality selector still present');
  assert(!document.querySelector('[data-category="chest"], [data-category="key_blue"], [data-category="key_purple"]'), 'Old categories remain');
  change('map', '20037'); change('difficulty', '5');
  el('none').click(); document.querySelector('[data-category="chest_glass"]').click();
  assert(visible.length === 11 && visible.every(p => p.typeId === 2011), 'Glass filter contains incorrect chests');
  for (const id of [91320788, 91320829]) assert(visible.some(p => p.sourceId === id), 'Key-room glass chest missing');
  document.querySelector('[data-category="chest_gold"]').click();
  assert(visible.some(p => p.category === 'chest_gold'), 'Gold filter empty');
  document.querySelector('[data-category="chest_glass"]').click();
  assert(visible.every(p => [2004, 2007, 2010].includes(p.typeId)), 'Gold filter includes glass or low-tier chests');
  change('difficulty', '6');
  assert(visible.every(p => p.difficultyCandidates.includes(6)), 'Difficulty mismatch');
  const beforeScroll = document.querySelector('aside').scrollTop;
  assert(wheel('map', 100) === false && el('map').value === '20039', 'Wheel down failed');
  wheel('map', -100); assert(el('map').value === '20037', 'Wheel up failed');
  assert(document.querySelector('aside').scrollTop === beforeScroll, 'Selector wheel scrolled sidebar');
  wheel('map', 100, { ctrlKey: true }); assert(el('map').value === '20037', 'Ctrl-wheel switched maps');
  wheel('map', 0); assert(el('map').value === '20037', 'Horizontal wheel switched maps');
  change('map', el('map').options[0].value); wheel('map', -100);
  assert(el('map').selectedIndex === 0, 'Wheel wrapped at beginning');
  el('map').selectedIndex = el('map').options.length - 1; wheel('map', 100);
  assert(el('map').selectedIndex === el('map').options.length - 1, 'Wheel wrapped at end');
  wheel('difficulty', -3, { deltaMode: 1 }); assert(el('difficulty').value === '5', 'Line-mode wheel failed');
  wheel('difficulty', 3, { deltaMode: 1 }); assert(el('difficulty').value === '6', 'Difficulty wheel failed');
  change('map', '20037'); await delay(250);
  change('icon-size', '100'); const pin = visible[0], small = pinSize(pin);
  el('icon-size').value = '200'; el('icon-size').dispatchEvent(new Event('input', { bubbles: true }));
  assert(pinSize(pin) === small * 2 && el('icon-size-value').value === '200%', 'Size did not update live');
  assert(el('icon-size').getAttribute('aria-valuetext') === '200%', 'Accessible size not updated');
  // A click outside the old hit area must select the enlarged chest.
  el('none').click(); document.querySelector('[data-category="chest_glass"]').click();
  const target = visible.find(p => p.sourceId === 91320788);
  scale = 1; tx = width / 2 - target.pixel[0]; ty = height / 2 - target.pixel[1]; draw();
  const box = el('map-canvas').getBoundingClientRect();
  const point = { clientX: box.left + width / 2 + 17, clientY: box.top + height / 2 };
  // Pointerup tests the viewer's hit detection without artificial pointer capture.
  drag = { x: point.clientX, y: point.clientY, tx, ty };
  el('map-canvas').dispatchEvent(new PointerEvent('pointerup', point));
  assert(selected?.id === target.id, 'Enlarged hit area failed');
  const summary = { maps: 0, combinations: 0, categories: 8, wheel: true, iconScale: true, enlargedHitArea: true };
  for (const map of DUNGEON_DATA.maps) {
    change('map', map.id);
    const loaded = new Image(); loaded.src = map.image; await loaded.decode();
    assert(loaded.naturalWidth === 2048 && loaded.naturalHeight === 2048, 'Wrong map dimensions');
    summary.maps++;
    for (const difficulty of ['5', '6']) {
      change('difficulty', difficulty); el('all').click();
      assert(visible.every(p => !p.category.startsWith('chest_') || p.quality === 5), 'Low-tier chest visible');
      assert(visible.every(p => categories[p.category]), 'Unsupported marker visible');
      summary.combinations++;
    }
  }
  change('map', '20037'); change('difficulty', '5'); el('all').click();
  await delay(200);
  assert(!el('load-status').textContent && !el('icon-status').textContent, 'Asset loading error');
  if (window.desktopReady) {
    const saved = JSON.parse(localStorage.getItem('aniimo-dungeon-preferences-v1'));
    assert(saved.iconSize === 200 && saved.map === '20037' && !('quality' in saved), 'Preferences not saved');
  }
  return { passed: true, ...summary, iconSize: 200, candidates20037: visible.length };
})()
