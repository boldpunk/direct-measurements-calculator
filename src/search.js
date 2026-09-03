import { getState } from './store.js';
import { escapeHtml } from './format.js';
import { selectOrder } from './views/orders.js';

function matches(text, query) {
  return String(text ?? '').toLowerCase().includes(query);
}

function computeResults(rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const state = getState();
  const results = [];

  state.orders.forEach((o) => {
    if (matches(o.clientName, query) || matches(o.productType, query) || matches(`#${o.number}`, query)) {
      results.push({
        icon: 'fa-box-open',
        title: `${o.productType} #${o.number}`,
        sub: o.clientName,
        go: () => { selectOrder(o.id); window.location.hash = '#/orders'; },
      });
    }
  });

  state.tasks.forEach((t) => {
    if (matches(t.name, query)) {
      const order = state.orders.find((o) => o.id === t.orderId);
      results.push({
        icon: 'fa-hammer',
        title: t.name,
        sub: order ? `${order.productType} #${order.number}` : 'Столярка',
        go: () => { window.location.hash = '#/carpentry'; },
      });
    }
  });

  state.partners.forEach((p) => {
    if (matches(p.name, query)) {
      results.push({
        icon: 'fa-layer-group',
        title: p.name,
        sub: p.services.join(', '),
        go: () => { window.location.hash = '#/outsource'; },
      });
    }
  });

  state.employees.forEach((e) => {
    if (matches(e.name, query)) {
      results.push({
        icon: 'fa-user',
        title: e.name,
        sub: e.role,
        go: () => { window.location.hash = '#/employees'; },
      });
    }
  });

  return results.slice(0, 8);
}

export function initSearch(rerender) {
  const input = document.getElementById('global-search');
  const panel = document.getElementById('search-results');
  if (!input || !panel) return;

  function renderPanel(results) {
    if (!results.length) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    panel.innerHTML = results.map((r, i) => `
      <div class="search-results__item" data-result-index="${i}">
        <i class="fa-solid ${r.icon}"></i>
        <div>
          <div class="search-results__title">${escapeHtml(r.title)}</div>
          <div class="search-results__sub">${escapeHtml(r.sub || '')}</div>
        </div>
      </div>
    `).join('');
    panel.hidden = false;

    panel.querySelectorAll('[data-result-index]').forEach((el) => {
      el.addEventListener('click', () => {
        results[Number(el.getAttribute('data-result-index'))].go();
        input.value = '';
        panel.hidden = true;
        panel.innerHTML = '';
        rerender();
      });
    });
  }

  input.addEventListener('input', () => renderPanel(computeResults(input.value)));
  input.addEventListener('focus', () => { if (input.value.trim()) renderPanel(computeResults(input.value)); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.topbar__search')) {
      panel.hidden = true;
    }
  });
}
