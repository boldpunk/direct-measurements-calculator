import { getState, getFinance, setFinance, computeOrderProfit, computeMonthlyProfit } from '../store.js';
import { money, escapeHtml } from '../format.js';

export function renderFinance() {
  const state = getState();
  const monthlyProfit = computeMonthlyProfit();

  const rows = state.orders.map((o) => {
    const f = getFinance(o.id);
    const { profit, remainder } = computeOrderProfit(o.id);
    return `
      <tr data-order-id="${o.id}">
        <td>${escapeHtml(o.productType)} #${o.number}</td>
        <td>${money(o.amount)}</td>
        <td><input type="number" min="0" class="fin-input" data-field="prepayment" value="${f.prepayment}" /></td>
        <td>${money(remainder)}</td>
        <td><input type="number" min="0" class="fin-input" data-field="costOutsource1" value="${f.costOutsource1}" /></td>
        <td><input type="number" min="0" class="fin-input" data-field="costOutsource2" value="${f.costOutsource2}" /></td>
        <td><input type="number" min="0" class="fin-input" data-field="materials" value="${f.materials}" /></td>
        <td><input type="number" min="0" class="fin-input" data-field="salaries" value="${f.salaries}" /></td>
        <td class="${profit >= 0 ? 'text-pos' : 'text-neg'}"><b>${money(profit)}</b></td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="9" class="empty-state">Заказов нет</td></tr>`;

  return `
    <div class="page-header">
      <h1>Финансы</h1>
      <div class="finance-month">Прибыль за месяц: <b class="${monthlyProfit >= 0 ? 'text-pos' : 'text-neg'}">${money(monthlyProfit)}</b></div>
    </div>
    <div class="panel">
      <div class="panel__body" style="padding:0; overflow-x:auto">
        <table class="data-table data-table--finance">
          <thead>
            <tr>
              <th>Заказ</th><th>Сумма</th><th>Предоплата</th><th>Остаток</th>
              <th>Аутсорс 1</th><th>Аутсорс 2</th><th>Материалы</th><th>Зарплаты</th><th>Прибыль</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

export function attachFinanceHandlers(root, rerender) {
  root.querySelectorAll('.fin-input').forEach((input) => {
    input.addEventListener('change', () => {
      const tr = input.closest('tr');
      const orderId = tr.getAttribute('data-order-id');
      setFinance(orderId, { [input.getAttribute('data-field')]: Number(input.value) || 0 });
      rerender();
    });
  });
}
