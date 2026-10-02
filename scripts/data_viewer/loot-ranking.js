'use strict';
(() => {
  const button = document.getElementById('loot-ranking-button');
  const dialog = document.getElementById('loot-ranking-dialog');
  const body = document.getElementById('loot-ranking-body');
  let renderedLocale;
  function render() {
    if (renderedLocale === I18n.locale) return;
    const number = new Intl.NumberFormat(I18n.locale, { maximumFractionDigits: 2 });
    const rows = LOOT_RANKING.map(item => {
      const row = document.createElement('tr');
      row.dataset.itemId = item.id;
      row.classList.toggle('loot-top', item.rank <= 3);
      const values = [item.rank, item.names[I18n.locale] ?? item.names.en,
        number.format(item.weight), number.format(item.sellPrice), number.format(item.sellPrice / item.weight)];
      values.forEach((value, index) => {
        const cell = document.createElement(index === 1 ? 'th' : 'td');
        if (index === 1) cell.scope = 'row';
        cell.textContent = value;
        row.append(cell);
      });
      return row;
    });
    body.replaceChildren(...rows);
    renderedLocale = I18n.locale;
  }
  button.addEventListener('click', () => { render(); dialog.showModal(); });
  document.getElementById('close-loot-ranking').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => button.focus({ preventScroll: true }));
  window.addEventListener('languagechange', () => { if (dialog.open) render(); });
})();
