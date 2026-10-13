'use strict';
(() => {
  const { locales, messages, bindings: staticBindings } = window.ANIIMO_LOCALES;
  const storageKey = 'aniimo-language-v1', fallback = 'en', defaultLocale = 'zh-TW';
  const bindings = new Map();
  let locale = defaultLocale, picker, menu, trigger, cleanupQueued = false;
  const valid = value => locales.some(item => item.code === value);
  try { const saved = localStorage.getItem(storageKey); if (valid(saved)) locale = saved; } catch { /* Private/restricted storage still permits switching. */ }
  const msg = (key, params = {}) => ({ i18n: key, params });
  function format(value) {
    if (value == null) return '';
    if (typeof value !== 'object' || !value.i18n) return String(value);
    const template = messages[locale]?.[value.i18n] ?? messages[fallback]?.[value.i18n] ?? messages[defaultLocale]?.[value.i18n] ?? value.i18n;
    return template.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(value.params, name) ? format(value.params[name]) : match);
  }
  const t = (key, params) => format(msg(key, params));
  function error(value) {
    if (value?.i18n) return value;
    const text = String(value?.message ?? value ?? '');
    if (text.startsWith('找不到伊莫')) return msg('game.missing');
    if (text.startsWith('遊戲已最小化')) return msg('game.minimized');
    if (text.startsWith('遊戲擷取已結束')) return msg('capture.restart');
    if (text.startsWith('F1 無法使用')) return msg('overlay.hotkeyFailed');
    const captureErrors = ['遊戲畫面尺寸無效。', '無法讀取擷取畫面。', '小地圖範圍無效。', '覆蓋地圖大小無效', '找不到螢幕'];
    if (captureErrors.includes(text)) return msg('capture.invalid');
    if (text.startsWith('無法擷取遊戲視窗：')) return msg('error.operation', { error: text.slice('無法擷取遊戲視窗：'.length) });
    return text;
  }
  function bind(node, value, property = 'textContent') {
    if (!node) return;
    let properties = bindings.get(node);
    if (!properties) bindings.set(node, properties = new Map());
    const rendered = format(value);
    properties.set(property, { value, rendered });
    if (property.startsWith('attr:')) node.setAttribute(property.slice(5), rendered);
    else node[property] = rendered;
    if (!cleanupQueued) {
      cleanupQueued = true;
      queueMicrotask(() => { cleanupQueued = false; for (const node of bindings.keys()) if (!node.isConnected) bindings.delete(node); });
    }
  }
  function refreshBindings() {
    for (const [node, properties] of bindings) {
      if (!node.isConnected) { bindings.delete(node); continue; }
      for (const [property, entry] of properties) {
        const current = property.startsWith('attr:') ? node.getAttribute(property.slice(5)) : node[property];
        // A caller may have cleared a transient message since it was bound.
        if (current !== entry.rendered) { properties.delete(property); continue; }
        bind(node, entry.value, property);
      }
    }
  }
  function applyStatic() {
    bind(document.querySelector('title'), msg(document.body.classList.contains('overlay') ? 'app.overlayTitle' : 'app.title'));
    const footer = document.querySelector('footer'), version = footer?.textContent.match(/\d+\.\d+\.\d+/)?.[0];
    if (version) bind(footer, msg('footer', { version }));
    for (const [selector, key, attribute] of staticBindings) {
      for (const element of document.querySelectorAll(selector)) {
        if (attribute) bind(element, msg(key), 'attr:' + attribute);
        else {
          // Translate the label's text node, preserving inputs, icons and counters.
          const node = [...element.childNodes].find(child => child.nodeType === 3 && child.textContent.trim());
          if (node) bind(node, msg(key));
        }
      }
    }
    for (const element of document.querySelectorAll('[data-i18n]')) bind(element, msg(element.dataset.i18n));
  }
  function updatePicker() {
    if (!trigger) return;
    trigger.querySelector('.language-name').textContent = locales.find(item => item.code === locale).name;
    trigger.title = t('language');
    trigger.setAttribute('aria-label', t('language') + ': ' + trigger.querySelector('.language-name').textContent);
    menu.setAttribute('aria-label', t('language'));
    for (const option of menu.children) option.setAttribute('aria-selected', String(option.dataset.locale === locale));
  }
  function setLocale(next, { persist = true } = {}) {
    if (!valid(next) || next === locale) return false;
    locale = next;
    if (persist) { try { localStorage.setItem(storageKey, locale); } catch { /* Session-only selection. */ } }
    document.documentElement.lang = locale;
    refreshBindings(); updatePicker();
    syncWindowTitle();
    window.dispatchEvent(new CustomEvent('languagechange', { detail: { locale } }));
    return true;
  }
  function syncWindowTitle() {
    window.__TAURI__?.window?.getCurrentWindow().setTitle(document.title).catch(() => {});
  }
  function closeMenu(focus = false) {
    if (!menu) return;
    menu.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus();
  }
  function positionMenu() {
    if (!menu || menu.hidden) return;
    const box = trigger.getBoundingClientRect();
    menu.style.width = Math.min(238, innerWidth - 16) + 'px';
    menu.style.left = Math.max(8, Math.min(box.left, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, box.bottom + 6) + 'px';
    menu.style.maxHeight = Math.max(90, innerHeight - box.bottom - 14) + 'px';
  }
  function openMenu() {
    menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); positionMenu();
    const selected = menu.querySelector('[aria-selected="true"]');
    selected.focus({ preventScroll: true }); selected.scrollIntoView({ block: 'nearest' });
  }
  function mountPicker() {
    if (document.body.classList.contains('overlay')) return;
    const sidebar = document.querySelector('aside'); if (!sidebar) return;
    picker = document.createElement('div'); picker.className = 'language-picker';
    trigger = document.createElement('button'); trigger.id = 'language-button'; trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', 'language-menu');
    trigger.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg><span class="language-name"></span><span aria-hidden="true">▾</span>';
    menu = document.createElement('div'); menu.id = 'language-menu'; menu.className = 'language-menu'; menu.hidden = true; menu.setAttribute('role', 'listbox');
    for (const item of locales) {
      const option = document.createElement('button'); option.type = 'button'; option.tabIndex = -1;
      option.setAttribute('role', 'option'); option.lang = item.code; option.dataset.locale = item.code; option.textContent = item.name;
      option.onclick = () => { setLocale(item.code); closeMenu(true); }; menu.append(option);
    }
    trigger.onclick = () => menu.hidden ? openMenu() : closeMenu(true);
    trigger.onkeydown = event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); openMenu(); } };
    menu.onkeydown = event => {
      const options = [...menu.children], index = options.indexOf(document.activeElement);
      let next = index;
      if (event.key === 'ArrowDown') next = (index + 1) % options.length;
      else if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = options.length - 1;
      else if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
      else if (event.key === 'Tab') { closeMenu(true); return; }
      else return;
      event.preventDefault(); options[next].focus();
    };
    document.addEventListener('pointerdown', event => { if (!picker.contains(event.target) && !menu.contains(event.target)) closeMenu(); });
    document.addEventListener('focusin', event => { if (!picker.contains(event.target) && !menu.contains(event.target)) closeMenu(); });
    window.addEventListener('resize', positionMenu);
    window.addEventListener('blur', () => closeMenu());
    sidebar.addEventListener('scroll', () => closeMenu());
    picker.append(trigger); sidebar.prepend(picker); document.body.append(menu); updatePicker();
  }
  window.I18n = { t, msg, format, bind, error, setLocale, get locale() { return locale; }, locales, storageKey };
  document.documentElement.lang = locale;
  window.addEventListener('storage', event => { if (event.key === storageKey) setLocale(event.newValue || defaultLocale, { persist: false }); });
  // Scripts are loaded at the end of the body, before controllers bind dynamic text.
  applyStatic(); mountPicker(); syncWindowTitle();
})();
