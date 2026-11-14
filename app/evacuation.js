'use strict';
(() => {
  const {msg,bind} = I18n, el = id => document.getElementById(id);
  const invoke = window.__TAURI__?.core.invoke, button = el('evacuation-button'), panel = el('evacuation-panel');
  let active = false, busy = false, generation = 0, timer = null, state = 'idle', report = null, error = null;
  let operations = Promise.resolve();
  const enqueue = action => operations = operations.catch(() => {}).then(action);
  function render() {
    bind(panel, msg('evac.title'), 'attr:aria-label');
    panel.hidden = window.getGameMode?.() === 'pvp';
    panel.dataset.state = state;
    button.disabled = busy || panel.hidden;
    button.dataset.active = String(active);
    button.setAttribute('aria-busy', String(active));
    bind(button, msg(active ? 'evac.cancel' : 'evac.start'), 'title');
    bind(el('evacuation-button-text'), msg(active ? 'evac.running' : 'evac.start'));
    bind(el('evacuation-status'), msg(state === 'error' ? 'evac.error' : report?.audioFailed ? 'evac.audioFailed' : `evac.${state}`,
      state === 'error' ? {error:I18n.error(error)} : undefined));
  }
  async function stop(nextState = 'idle', nextError = null) {
    const current = ++generation;
    clearTimeout(timer); timer = null; active = false; busy = true; state = nextState; error = nextError; render();
    try { if (invoke) await enqueue(() => invoke('stop_evacuation')); }
    catch (failure) { if (current === generation) { state = 'error'; error = failure; } }
    finally { if (current === generation) { busy = false; render(); } }
  }
  async function poll(current) {
    if (!active || current !== generation) return;
    try {
      const result = await invoke('evacuation_status');
      if (!active || current !== generation) return;
      report = result;
      if (result.state === 'completed') { await stop('completed'); return; }
      if (result.state === 'error' || result.state === 'idle') { await stop('error', result.error || msg('capture.restart')); return; }
      state = result.state === 'paused' ? 'paused' : result.matched ? 'confirming' : 'watching'; render();
      timer = setTimeout(() => poll(current), 1000); // Status only; native capture/recognition is paced at 2 s.
    } catch (failure) { if (current === generation) await stop('error', failure); }
  }
  async function start() {
    const current = ++generation;
    active = true; busy = true; state = 'watching'; report = null; error = null; render();
    try {
      if (!invoke) throw msg('error.desktop');
      const windowId = el('game-window')?.value || window.trackingStatus?.().gameWindowId || null;
      await enqueue(() => invoke('start_evacuation', {windowId}));
      if (current !== generation) return;
      busy = false; render(); void poll(current);
    } catch (failure) { if (current === generation) await stop('error', failure); }
  }
  button.onclick = () => {
    if (busy || window.getGameMode?.() === 'pvp') return;
    return active ? stop() : start();
  };
  window.addEventListener('game-mode-change', () => {
    if (window.getGameMode?.() === 'pvp' && (active || busy)) void stop(); else render();
  });
  window.evacuationStatus = () => ({active,busy,state,report});
  render();
})();
