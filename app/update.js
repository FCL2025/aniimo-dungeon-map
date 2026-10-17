'use strict';
(() => {
  const invoke = window.__TAURI__?.core.invoke;
  const events = window.__TAURI__?.event;
  const { msg, bind } = window.I18n;
  const el = id => document.getElementById(id);
  const dialog = el('update-dialog'), checkButton = el('check-update');
  const actionButton = el('update-action'), laterButton = el('update-later');
  let available = null, checking = false, installing = false;

  if (!invoke) { checkButton.hidden = true; return; }

  async function check(manual = false) {
    if (checking || installing) return;
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
      bind(actionButton, msg(available.canInstall ? 'update.install' : 'update.download'));
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
    if (!available || installing) return;
    if (!available.canInstall) {
      try {
        await invoke('open_portable_download');
        dialog.close();
        window.showMapNotice(msg('update.portableHint'), 10000);
      } catch (error) {
        bind(el('update-progress'), msg('update.failed', { error: I18n.error(error) }));
        el('update-progress').hidden = false;
      }
      return;
    }
    installing = true;
    actionButton.disabled = true;
    laterButton.disabled = true;
    bind(el('update-progress'), msg('update.downloading', { percent: '0' }));
    el('update-progress').hidden = false;
    try {
      await invoke('install_update');
      bind(el('update-progress'), msg('update.installing'));
    } catch (error) {
      bind(el('update-progress'), msg('update.failed', { error: I18n.error(error) }));
      installing = false;
      actionButton.disabled = false;
      laterButton.disabled = false;
    }
  }

  checkButton.addEventListener('click', () => check(true));
  actionButton.addEventListener('click', applyUpdate);
  laterButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (installing) event.preventDefault(); });
  events?.listen('update-download-progress', ({ payload }) => {
    if (!installing) return;
    const percent = payload.totalBytes
      ? String(Math.min(100, Math.floor(payload.downloadedBytes * 100 / payload.totalBytes)))
      : '…';
    bind(el('update-progress'), msg('update.downloading', { percent }));
  }).catch(() => {});
  window.desktopReady?.then(() => setTimeout(() => check(false), 700));
})();
