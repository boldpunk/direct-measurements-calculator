import { getState, computeOrderFinance, computeMonthlyProfit, getOrderDeadlineInfo } from '../store.js';
import { money, escapeHtml, orderStatusBadgeClass, deadlineBadgeClass } from '../format.js';
import { kpiCard } from '../ui.js';
import { maskUnless } from '../permissions.js';
import { selectOrder } from './orders.js';

export function renderFinance() {
  const state = getState();
  const monthlyProfit = computeMonthlyProfit();

  const totals = state.orders.reduce((acc, o) => {
    const fin = computeOrderFinance(o.id);
    acc.revenue += o.amount;
    acc.cost += fin.costPrice;
    acc.profit += fin.profit;
    acc.received += fin.receivedAmount;
    acc.remaining += Math.max(0, fin.remainingAmount);
    return acc;
  }, { revenue: 0, cost: 0, profit: 0, received: 0, remaining: 0 });

  const kpis = [
    kpiCard('fa-file-invoice-dollar', 'info', 'Выручка (все заказы)', maskUnless('seesFinanceAnalytics', money(totals.revenue))),
    kpiCard('fa-layer-group', 'warning', 'Себестоимость (все заказы)', maskUnless('seesCostPrice', money(totals.cost))),
    kpiCard('fa-sack-dollar', totals.profit >= 0 ? 'success' : 'danger', 'Прибыль (все заказы)', maskUnless('seesProfit', money(totals.profit))),
    kpiCard('fa-hand-holding-dollar', 'neutral', 'К получению', maskUnless('seesFinanceAnalytics', money(totals.remaining))),
    kpiCard('fa-calendar-check', monthlyProfit >= 0 ? 'success' : 'danger', 'Прибыль за месяц', maskUnless('seesProfit', money(monthlyProfit))),
  ];

  const rows = [...state.orders].reverse().map((o) => {
    const fin = computeOrderFinance(o.id);
    const deadlineInfo = getOrderDeadlineInfo(o);
    return `
      <tr data-order-row="${o.id}">
        <td>${escapeHtml(o.productType)} #${o.number}</td>
        <td>${escapeHtml(o.clientName)}</td>
        <td>${money(o.amount)}</td>
        <td>${money(fin.receivedAmount)}</td>
        <td class="${fin.remainingAmount > 0 ? 'text-neg' : 'text-pos'}">${fin.remainingAmount > 0 ? money(fin.remainingAmount) : 'Оплачено'}</td>
        <td>${maskUnless('seesCostPrice', money(fin.costPrice))}</td>
        <td class="${fin.profit >= 0 ? 'text-pos' : 'text-neg'}"><b>${maskUnless('seesProfit', money(fin.profit))}</b></td>
        <td class="${fin.profit >= 0 ? 'text-pos' : 'text-neg'}">${maskUnless('seesMargin', `${fin.margin.toFixed(1)}%`)}</td>
        <td><span class="${orderStatusBadgeClass(o.status)}">${o.status}</span></td>
        <td><span class="${deadlineBadgeClass(deadlineInfo.tone)}">${deadlineInfo.text}</span></td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="10" class="empty-state">Заказов нет</td></tr>`;

  return `
    <div class="page-header">
      <h1>Финансы</h1>
      <span class="row-item__sub">Детальное редактирование оплат и расходов — на странице заказа</span>
    </div>
    <div class="kpi-row">${kpis.join('')}</div>
    <div class="panel">
      <div class="panel__body" style="padding:0; overflow-x:auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Заказ</th><th>Клиент</th><th>Сумма</th><th>Получено</th><th>Остаток</th>
              <th>Себестоимость</th><th>Прибыль</th><th>Маржа</th><th>Статус</th><th>Срок</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

export function attachFinanceHandlers(root, rerender) {
  root.querySelectorAll('[data-order-row]').forEach((row) => {
    row.addEventListener('click', () => {
      selectOrder(row.getAttribute('data-order-row'));
      window.location.hash = '#/orders';
    });
  });
}
