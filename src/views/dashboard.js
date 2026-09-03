import {
  getState, getOverdueOrders, getInProgressOrders, getUnpaidOrders, getUpcomingDeadlines,
  getOrdersByStatusCounts, computeOrderFinance, computeMonthlyProfit, getOrderDeadlineInfo,
  ORDER_STATUSES, todayISO,
} from '../store.js';
import { money, escapeHtml, orderStatusBadgeClass, deadlineBadgeClass } from '../format.js';
import { kpiCard, card } from '../ui.js';
import { maskUnless, isOwnScopeOnly, currentEmployeeId } from '../permissions.js';
import { selectOrder } from './orders.js';

export function renderDashboard() {
  const state = getState();
  const ownOnly = isOwnScopeOnly('orders');
  const mine = (o) => !ownOnly || o.managerId === currentEmployeeId();

  const activeOrders = getInProgressOrders().filter(mine);
  const overdueOrders = getOverdueOrders().filter(mine);
  const unpaidOrders = getUnpaidOrders().filter(mine);
  const toReceive = unpaidOrders.reduce((sum, o) => sum + computeOrderFinance(o.id).remainingAmount, 0);
  const liveOrders = state.orders.filter((o) => o.status !== 'Отменён' && mine(o));
  const revenue = liveOrders.reduce((sum, o) => sum + o.amount, 0);
  const totalProfit = liveOrders.reduce((sum, o) => sum + computeOrderFinance(o.id).profit, 0);
  const monthlyProfit = computeMonthlyProfit();

  const kpis = [
    kpiCard('fa-layer-group', 'info', 'Активные заказы', `${activeOrders.length}`, '#/orders'),
    kpiCard('fa-fire', 'danger', 'С просрочкой', `${overdueOrders.length}`, '#/orders'),
    kpiCard('fa-hand-holding-dollar', 'warning', 'К оплате', money(toReceive), '#/orders'),
    kpiCard('fa-file-invoice-dollar', 'neutral', 'Выручка', maskUnless('seesFinanceAnalytics', money(revenue)), '#/orders'),
    kpiCard('fa-sack-dollar', totalProfit >= 0 ? 'success' : 'danger', 'Прибыль', maskUnless('seesProfit', money(totalProfit)), '#/orders'),
  ];

  const upcoming = getUpcomingDeadlines(7).filter(mine);
  const upcomingRows = upcoming.slice(0, 6).map((o) => `
    <div class="row-item deadline-item" data-order-id="${o.id}">
      <div class="row-item__title">#${o.number} — ${escapeHtml(o.productType)}</div>
      <span class="row-item__sub">${escapeHtml(daysPhrase(o.deadline))}</span>
    </div>
  `).join('') || emptyState('Ближайших сроков нет');

  const statusCounts = ownOnly
    ? state.orders.filter(mine).reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {})
    : getOrdersByStatusCounts();
  const statusRows = ORDER_STATUSES
    .filter((s) => s !== 'Завершён' && s !== 'Отменён' && statusCounts[s] > 0)
    .map((s) => `
      <div class="status-count-row">
        <span class="${orderStatusBadgeClass(s)}">${s}</span>
        <b>${statusCounts[s]}</b>
      </div>
    `).join('') || emptyState('Нет активных заказов');

  const orderRows = [...state.orders].filter(mine).reverse().slice(0, 5).map((o) => {
    const deadlineInfo = getOrderDeadlineInfo(o);
    return `
      <div class="row-item order-item" data-order-id="${o.id}">
        <div>
          <div class="row-item__title">${escapeHtml(o.productType)} #${o.number}</div>
          <div class="row-item__sub">${escapeHtml(o.clientName)}</div>
        </div>
        <div style="text-align:right">
          <div><span class="${orderStatusBadgeClass(o.status)}">${o.status}</span></div>
          <div class="row-item__meta ${deadlineInfo.tone === 'danger' ? 'is-overdue' : ''}" style="margin-top:4px">${money(o.amount)}</div>
        </div>
      </div>
    `;
  }).join('') || emptyState('Пока нет заказов');

  const openRework = state.rework.filter((r) => r.status !== 'готово');
  const reworkCost = openRework.reduce((sum, r) => sum + (r.costImpact || 0), 0);
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

  return `
    <div class="page-header">
      <h1>Главная</h1>
      <span class="row-item__sub">Прибыль за месяц: <b class="${monthlyProfit >= 0 ? 'text-pos' : 'text-neg'}">${maskUnless('seesProfit', money(monthlyProfit))}</b></span>
    </div>
    <div class="kpi-row">${kpis.join('')}</div>
    <div class="dash-grid">
      ${card('1', 'Ближайшие сроки', `<div class="row-list">${upcomingRows}</div>`)}
      ${card('2', 'Заказы по статусам', `<div class="status-count-list">${statusRows}</div><a class="link-more" href="#/production">Доска производства <i class="fa-solid fa-arrow-right"></i></a>`)}
      ${card('3', 'Последние заказы', `<div class="row-list">${orderRows}</div><a class="link-more" href="#/orders">Все заказы <i class="fa-solid fa-arrow-right"></i></a>`)}
      ${card('4', 'Переделки', `<div class="row-list">${reworkRows}</div>${reworkCost ? `<div class="finance-month">Влияние: <b class="text-neg">${money(reworkCost)}</b></div>` : ''}<a class="link-more" href="#/rework">Все переделки <i class="fa-solid fa-arrow-right"></i></a>`)}
    </div>
  `;
}

export function attachDashboardHandlers(root, rerender) {
  root.querySelectorAll('[data-order-id]').forEach((el) => {
    el.addEventListener('click', () => {
      selectOrder(el.getAttribute('data-order-id'));
      window.location.hash = '#/orders';
    });
  });
}

function daysPhrase(deadline) {
  const diff = Math.round((new Date(deadline) - new Date(todayISO())) / 86400000);
  if (diff <= 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  return `через ${diff} ${ruDays(diff)}`;
}

function ruDays(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}

function emptyState(text) {
  return `<div class="empty-state">${text}</div>`;
}
