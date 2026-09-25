'use strict';
(() => {
  const invoke = window.__TAURI__?.core.invoke;
  const key = 'aniimo-dungeon-preferences-v1';
  const pin = document.getElementById('topmost');
  const compactButton = document.getElementById('compact');
  const status = document.getElementById('app-status');
  let topmost = true, compact = false;
  const report = text => { status.textContent = text; };
  const renderButtons = () => {
    pin.textContent = topmost ? '置頂：開' : '置頂：關';
    pin.setAttribute('aria-pressed', String(topmost));
    compactButton.textContent = compact ? '展開面板' : '地圖模式';
    compactButton.setAttribute('aria-pressed', String(compact));
  };
  function save() {
    try {
      localStorage.setItem(key, JSON.stringify({
        map: document.getElementById('map').value,
        difficulty: document.getElementById('difficulty').value,
        quality: document.getElementById('quality').value,
        supplements: document.getElementById('supplements').checked,
        categories: [...document.querySelectorAll('[data-category]:checked')].map(e => e.dataset.category),
        topmost, compact
      }));
    } catch { report('設定無法儲存，請確認資料夾可寫入。'); }
  }
  async function setPinned(value) {
    if (!invoke) { report('置頂功能需在桌面應用內使用。'); return; }
    pin.disabled = true;
    try { topmost = await invoke('set_topmost', { enabled: value }); renderButtons(); save(); }
    catch (error) { report('無法設定置頂：' + String(error)); }
    finally { pin.disabled = false; }
  }
  async function setCompact(value) {
    compactButton.disabled = true;
    try {
      if (invoke) await invoke('set_compact', { enabled: value });
      compact = value;
      document.body.classList.toggle('compact', compact);
      renderButtons(); save();
    } catch (error) { report('無法調整視窗：' + String(error)); }
    finally { compactButton.disabled = false; }
  }
  pin.addEventListener('click', () => setPinned(!topmost));
  compactButton.addEventListener('click', () => setCompact(!compact));
  document.getElementById('help-button').onclick = () => document.getElementById('help-dialog').showModal();
  document.getElementById('close-help').onclick = () => document.getElementById('help-dialog').close();
  document.addEventListener('change', save);
  for (const id of ['all', 'none']) document.getElementById(id).addEventListener('click', save);
  try {
    const settings = JSON.parse(localStorage.getItem(key) || 'null');
    if (settings) {
      for (const id of ['map', 'difficulty', 'quality']) {
        const select = document.getElementById(id);
        if ([...select.options].some(o => o.value === String(settings[id]))) select.value = String(settings[id]);
      }
      if (typeof settings.supplements === 'boolean') document.getElementById('supplements').checked = settings.supplements;
      if (Array.isArray(settings.categories)) for (const element of document.querySelectorAll('[data-category]')) element.checked = settings.categories.includes(element.dataset.category);
      // Rebuild the viewer once after all controls have been restored.
      document.getElementById('map').dispatchEvent(new Event('change'));
      if (settings.topmost === false) setPinned(false);
      if (settings.compact === true) setCompact(true);
    }
  } catch { report('先前設定無法讀取，已使用預設值。'); }
  renderButtons();
})();
