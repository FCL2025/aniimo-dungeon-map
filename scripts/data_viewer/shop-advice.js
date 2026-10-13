'use strict';
(() => {
  const { tickets, ticketRevenuePerRun, boxes } = window.SHOP_ADVICE;
  const el = id => document.getElementById(id);
  const fmt = number => new Intl.NumberFormat(I18n.locale).format(number);
  const p = (parent, key, values = {}) => {
    const node = document.createElement('p');
    I18n.bind(node, I18n.msg(key, values));
    parent.append(node);
  };
  const table = (parent, columns, rows) => {
    const element = document.createElement('table');
    element.className = 'shop-table';
    const head = element.createTHead().insertRow();
    for (const key of columns) {
      const th = document.createElement('th');
      th.scope = 'col'; I18n.bind(th, I18n.msg('shop.' + key)); head.append(th);
    }
    const body = element.createTBody();
    for (const values of rows) {
      const row = body.insertRow();
      for (const value of values) row.insertCell().textContent = fmt(value);
    }
    parent.append(element);
  };
  function renderTicket() {
    const content = el('ticket-advice-content'); content.replaceChildren();
    p(content, 'shop.ticketLead', {revenue:fmt(ticketRevenuePerRun), net:fmt(tickets[9].cumulativeNet)});
    table(content, ['ticketCount', 'ticketCost', 'ticketNet'],
      [3,6,10,15,20].map(count=>[count,tickets[count-1].cumulativeCost,tickets[count-1].cumulativeNet]));
    p(content, 'shop.ticketPlan');
    p(content, 'shop.ticketLimit');
  }
  function renderEgg() {
    const content = el('egg-advice-content'); content.replaceChildren();
    p(content, 'shop.eggLead', { cost:fmt(boxes[8].cumulativeCost) });
    table(content, ['boxRange', 'unitPrice', 'tierCost'], [[1, boxes[0].price, boxes[8].cumulativeCost], [10, boxes[9].price, boxes[18].cumulativeCost - boxes[8].cumulativeCost], [20, boxes[19].price, boxes[29].cumulativeCost - boxes[18].cumulativeCost]]);
    p(content, 'shop.eggRanges');
    p(content, 'shop.eggLimit');
  }
  for (const [name, render] of [['ticket', renderTicket], ['egg', renderEgg]]) {
    const button = el(name + '-advice-button'), dialog = el(name + '-advice-dialog');
    button.addEventListener('click', () => { render(); dialog.showModal(); });
    dialog.querySelector('.shop-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => button.focus({ preventScroll:true }));
    window.addEventListener('languagechange', () => { if (dialog.open) render(); });
  }
})();
