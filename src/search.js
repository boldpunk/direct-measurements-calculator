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
    if (
      matches(o.clientName, query) || matches(o.productType, query) || matches(`#${o.number}`, query)
      || matches(o.clientPhone, query) || matches(o.status, query)
    ) {
      results.push({
        icon: 'fa-box-open',
        title: `${o.productType} #${o.number}`,
        sub: `${o.clientName} · ${o.status}`,
        go: () => { selectOrder(o.id); window.location.hash = '#/orders'; },
      });
    }
  });

  state.tasks.forEach((t) => {
    const assignee = state.employees.find((e) => e.id === t.assigneeId);
    if (
      matches(t.name, query) || matches(t.comment, query) || matches(t.priority, query)
      || matches(t.status, query) || matches(assignee?.name, query)
    ) {
      const order = state.orders.find((o) => o.id === t.orderId);
      results.push({
        icon: 'fa-hammer',
        title: t.name,
        sub: `${order ? `${order.productType} #${order.number}` : 'Столярка'} · ${t.status}`,
        go: () => { window.location.hash = '#/carpentry'; },
      });
    }
  });

  state.rework.forEach((r) => {
    const order = state.orders.find((o) => o.id === r.orderId);
    if (matches(r.description, query) || matches(r.reason, query)) {
      results.push({
        icon: 'fa-rotate',
        title: r.description,
        sub: order ? `${order.productType} #${order.number} · ${r.status}` : r.status,
        go: () => { window.location.hash = '#/rework'; },
      });
    }
  });

  state.partners.forEach((p) => {
    if (matches(p.name, query) || matches(p.contacts, query) || matches(p.comment, query) || p.services.some((s) => matches(s, query))) {
      results.push({
        icon: 'fa-layer-group',
        title: p.name,
        sub: p.services.join(', '),
        go: () => { window.location.hash = '#/outsource'; },
      });
    }
  });

  state.employees.forEach((e) => {
    if (matches(e.name, query) || matches(e.role, query) || matches(e.phone, query)) {
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
