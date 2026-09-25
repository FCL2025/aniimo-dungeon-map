// Run through agent-browser eval --stdin against an isolated native EXE.
// Seed a 0.2.2 profile as described in docs/設定保存驗證.md, then run phases in order.
// Prefix with window.preferenceTestPhase = 'upgrade' | 'restart' | 'moved'.
(async () => {
  const phase = window.preferenceTestPhase;
  const element = id => document.getElementById(id);
  const selected = () => [...document.querySelectorAll('[data-category]:checked')].map(e => e.dataset.category);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
  const state = () => ({
    map: element('map').value, difficulty: element('difficulty').value, quality: element('quality').value,
    supplements: element('supplements').checked, categories: selected(),
    topmost: element('topmost').getAttribute('aria-pressed') === 'true',
    compact: document.body.classList.contains('compact'),
  });
  const checkState = async expected => {
    assert(same(state(), expected), 'Unexpected restored controls: ' + JSON.stringify(state()));
    assert(await window.__TAURI__.window.getCurrentWindow().isAlwaysOnTop() === expected.topmost, 'Native topmost not restored');
  };
  const set = (id, value) => {
    const e = element(id);
    if (typeof value === 'boolean') e.checked = value; else e.value = value;
    e.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const expected = {
    map: '20036', difficulty: '5', quality: '5', supplements: true,
    categories: [], topmost: true, compact: false,
  };
  assert(document.querySelectorAll('[data-category]').length === 9, 'Expected 9 filter options');
  assert(!document.querySelector('[data-category="pot"], [data-category="cache"]'), 'Removed options still present');
  assert(DUNGEON_DATA.maps.length === 31, 'Missing dungeon maps');
  assert(DUNGEON_DATA.maps.every(m => m.pins.every(p => !['pot', 'cache'].includes(p.category))), 'Removed markers still embedded');
  assert(JSON.parse(localStorage.getItem('aniimo-capture-regions-v1')).mini[0] === .75, 'Capture region not carried over');
  assert(element('load-status').textContent === '', 'Map failed to load');
  assert(element('app-status').textContent === '', 'Settings error displayed');
  if (phase === 'upgrade') {
    await checkState({
      map: '20040', difficulty: '6', quality: '4', supplements: false,
      categories: ['egg', 'chest', 'stellarys_boss', 'exit'], topmost: false, compact: false,
    });
    element('all').click();
    assert(selected().length === 9, 'All must enable only supported categories');
    element('none').click();
    assert(element('filter-total').textContent === '0 個候選', 'Hidden filters still render markers');
    set('map', '20036'); set('difficulty', '5'); set('quality', '5'); set('supplements', true);
    element('topmost').click(); element('compact').click();
    await new Promise(resolve => setTimeout(resolve, 400));
    await checkState(expected);
  } else if (phase === 'restart') {
    await checkState(expected);
    assert(element('filter-total').textContent === '0 個候選', 'Empty category selection was lost on restart');
    for (const category of ['egg', 'key_blue']) document.querySelector(`[data-category="${category}"]`).click();
  } else if (phase === 'moved') {
    expected.categories = ['egg', 'key_blue'];
    await checkState(expected);
  } else {
    throw new Error('Unknown test phase');
  }
  assert(same(JSON.parse(localStorage.getItem('aniimo-dungeon-preferences-v1')), state()), 'Saved state differs from controls');
  return { phase, passed: true, state: state(), categories: 9, maps: 31 };
})()
