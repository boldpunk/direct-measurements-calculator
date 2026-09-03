import {
  getState, getOverdueOrders, getInProgressOrders, getCarpentryTasks,
  getActiveStage, computeMonthlyProfit, isOverdue,
} from '../store.js';
import { money, shortDate, escapeHtml, statusBadgeClass, priorityBadgeClass } from '../format.js';
import { kpiCard, card } from '../ui.js';

export function renderDashboard() {
  const state = getState();
  const overdue = getOverdueOrders();
  const inProgress = getInProgressOrders();
  const carpentryTasks = getCarpentryTasks();
  const openRework = state.rework.filter((r) => r.status !== 'готово');
  const reworkCost = openRework.reduce((sum, r) => sum + (r.costImpact || 0), 0);
  const monthlyProfit = computeMonthlyProfit();

  const kpis = [
    kpiCard('fa-fire', 'danger', 'Просрочено', `${overdue.length} <small>заказ${plural(overdue.length)}</small>`, '#/orders'),
    kpiCard('fa-clock', 'warning', 'В работе', `${inProgress.length} <small>заказов</small>`, '#/orders'),
    kpiCard('fa-hammer', 'info', 'Столярка', `${carpentryTasks.length} <small>задач</small>`, '#/carpentry'),
    kpiCard('fa-rotate', 'success', 'Переделки', `${openRework.length} <small>откр.</small> ${money(reworkCost)}`, '#/rework'),
  ];

  const orderRows = state.orders.slice(-5).reverse().map((o) => {
    const active = getActiveStage(o.id);
    return `
      <div class="row-item">
        <div>
          <div class="row-item__title">${escapeHtml(o.productType)} #${o.number}</div>
          <div class="row-item__sub">${escapeHtml(o.clientName)}</div>
        </div>
        <div class="row-item__meta ${active && isOverdue(active.deadline, active.status) ? 'is-overdue' : ''}">
          ${active ? shortDate(active.deadline) : money(o.amount)}
        </div>
      </div>
    `;
  }).join('') || emptyState('Пока нет заказов');

  const carpentryCols = ['ожидает', 'в работе', 'проверка', 'готово'].map((status) => {
    const items = carpentryTasks.filter((t) => t.status === status).slice(0, 3);
    return `
      <div class="mini-col">
        <div class="mini-col__title">${status}</div>
        ${items.map((t) => `
          <div class="mini-card ${t.priority === 'срочный' || t.priority === 'переделка' ? 'mini-card--hot' : ''}">
            ${t.priority !== 'обычный' ? '<i class="fa-solid fa-fire"></i> ' : ''}${escapeHtml(t.name)}
          </div>
        `).join('') || ''}
      </div>
    `;
  }).join('');

  const reworkRows = state.rework.slice(-3).reverse().map((r) => {
    const order = state.orders.find((o) => o.id === r.orderId);
    return `
      <div class="row-item">
        <div>
          <div class="row-item__title"><i class="fa-solid fa-fire" style="color:#f97316"></i> ${escapeHtml(order ? order.productType + ' #' + order.number : '—')}</div>
          <div class="row-item__sub">${escapeHtml(r.description)}</div>
        </div>
        <span class="${r.urgency === 'срочно' ? 'badge badge--urgent' : 'badge badge--muted'}">${r.urgency}</span>
      </div>
    `;
  }).join('') || emptyState('Переделок нет');

  const financeRows = state.orders.slice(-3).reverse().map((o) => {
    const f = state.finance[o.id] || {};
    const cost = (f.costOutsource1 || 0) + (f.costOutsource2 || 0) + (f.materials || 0) + (f.salaries || 0);
    const profit = o.amount - cost;
    return `
      <div class="row-item">
        <div class="row-item__title">${escapeHtml(o.productType)} #${o.number}</div>
        <div class="row-item__meta">${money(o.amount)} ${money(cost)} <b class="${profit >= 0 ? 'text-pos' : 'text-neg'}">${profit >= 0 ? '↑' : '↓'} ${money(Math.abs(profit))}</b></div>
      </div>
    `;
  }).join('') || emptyState('Нет данных');

  return `
    <div class="kpi-row">${kpis.join('')}</div>
    <div class="dash-grid">
      ${card('1', 'Заказы', `<div class="row-list">${orderRows}</div><a class="link-more" href="#/orders">Все заказы <i class="fa-solid fa-arrow-right"></i></a>`)}
      ${card('2', 'Столярка', `<div class="mini-board">${carpentryCols}</div><a class="link-more" href="#/carpentry">Открыть доску <i class="fa-solid fa-arrow-right"></i></a>`)}
      ${card('3', 'Переделки', `<div class="row-list">${reworkRows}</div><a class="link-more" href="#/rework">Все переделки <i class="fa-solid fa-arrow-right"></i></a>`)}
      ${card('4', 'Финансы', `<div class="row-list">${financeRows}</div><div class="finance-month">Прибыль за месяц: <b class="${monthlyProfit >= 0 ? 'text-pos' : 'text-neg'}">${money(monthlyProfit)}</b></div>`)}
    </div>
  `;
}

function plural(n) {
  return n === 1 ? '' : 'ов';
}

function emptyState(text) {
  return `<div class="empty-state">${text}</div>`;
}
