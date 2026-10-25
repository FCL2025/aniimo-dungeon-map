'use strict';
(() => {
  const invoke = window.__TAURI__?.core.invoke;
  const { msg, bind } = window.I18n;
  const el = id => document.getElementById(id);
  const dialog = el('update-dialog'), checkButton = el('check-update');
  const actionButton = el('update-action'), laterButton = el('update-later');
  let available = null, checking = false;

  if (!invoke) { checkButton.hidden = true; return; }

  async function check(manual = false) {
    if (checking) return;
    checking = true;
    checkButton.disabled = true;
    if (manual) window.showMapNotice(msg('update.checking'));
    try {
      available = await invoke('check_for_update');
      if (!available) {
        if (manual) window.showMapNotice(msg('update.current'));
        return;
      }
      bind(el('update-description'), msg('update.available', { version: available.version }));
      const notes = el('update-notes');
      notes.textContent = available.notes || '';
      notes.hidden = !notes.textContent.trim();
      bind(actionButton, msg('update.download'));
      el('update-progress').hidden = true;
      if (!dialog.open) dialog.showModal();
    } catch (error) {
      if (manual) window.showMapNotice(msg('update.failed', { error: I18n.error(error) }), 10000);
    } finally {
      checking = false;
      checkButton.disabled = false;
    }
  }

  async function applyUpdate() {
    if (!available) return;
    try {
      await invoke('open_portable_download');
      dialog.close();
      window.showMapNotice(msg('update.portableHint'), 10000);
    } catch (error) {
      bind(el('update-progress'), msg('update.failed', { error: I18n.error(error) }));
      el('update-progress').hidden = false;
    }
  }

  checkButton.addEventListener('click', () => check(true));
  actionButton.addEventListener('click', applyUpdate);
  laterButton.addEventListener('click', () => dialog.close());
  window.desktopReady?.then(() => setTimeout(() => check(false), 700));
})();
