import {
  getState, getFinance, setFinance, computeOrderProfit, computeMonthlyProfit,
  addMaterialItem, removeMaterialItem,
} from '../store.js';
import { money, escapeHtml } from '../format.js';
import { kpiCard } from '../ui.js';

export function renderFinance() {
  const state = getState();
  const monthlyProfit = computeMonthlyProfit();

  const totals = state.orders.reduce((acc, o) => {
    const { profit, costTotal } = computeOrderProfit(o.id);
    acc.revenue += o.amount;
    acc.cost += costTotal;
    acc.profit += profit;
    return acc;
  }, { revenue: 0, cost: 0, profit: 0 });

  const kpis = [
    kpiCard('fa-file-invoice-dollar', 'info', 'Выручка (все заказы)', money(totals.revenue)),
    kpiCard('fa-layer-group', 'warning', 'Себестоимость (все заказы)', money(totals.cost)),
    kpiCard('fa-sack-dollar', totals.profit >= 0 ? 'success' : 'danger', 'Прибыль (все заказы)', money(totals.profit)),
    kpiCard('fa-calendar-check', monthlyProfit >= 0 ? 'success' : 'danger', 'Прибыль за месяц', money(monthlyProfit)),
  ];

  const cards = state.orders.length
    ? [...state.orders].reverse().map((o) => renderOrderFinanceCard(o, state)).join('')
    : '<div class="empty-state">Заказов нет</div>';

  return `
    <div class="page-header">
      <h1>Финансы</h1>
    </div>
    <div class="kpi-row">${kpis.join('')}</div>
    <div class="finance-list">${cards}</div>
  `;
}

function renderOrderFinanceCard(o, state) {
  const f = getFinance(o.id);
  const { profit, remainder, costTotal } = computeOrderProfit(o.id);
  const hasItems = f.materialItems.length > 0;

  const materialRows = f.materialItems.map((it) => `
    <div class="mat-row">
      <span class="mat-row__name">${escapeHtml(it.name)}</span>
      <span class="mat-row__calc">${it.qty} × ${money(it.unitPrice)}</span>
      <span class="mat-row__sum">${money(it.qty * it.unitPrice)}</span>
      <button type="button" class="mat-row__remove" data-remove-item="${it.id}" data-order="${o.id}" title="Удалить материал">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `).join('');

  return `
    <div class="finance-card">
      <div class="finance-card__header">
        <div>
          <b>${escapeHtml(o.productType)} #${o.number}</b>
          <span class="row-item__sub">${escapeHtml(o.clientName)}</span>
        </div>
        <div class="finance-card__amount">${money(o.amount)}</div>
      </div>

      <div class="finance-card__grid">
        <label>Предоплата
          <input type="number" min="0" class="fin-input" data-field="prepayment" data-order="${o.id}" value="${f.prepayment}" />
        </label>
        <label>Остаток
          <div class="finance-card__readonly">${money(remainder)}</div>
        </label>
        <label>Аутсорс 1
          <input type="number" min="0" class="fin-input" data-field="costOutsource1" data-order="${o.id}" value="${f.costOutsource1}" />
        </label>
        <label>Аутсорс 2
          <input type="number" min="0" class="fin-input" data-field="costOutsource2" data-order="${o.id}" value="${f.costOutsource2}" />
        </label>
        <label>Зарплаты
          <input type="number" min="0" class="fin-input" data-field="salaries" data-order="${o.id}" value="${f.salaries}" />
        </label>
      </div>

      <div class="materials-calc">
        <div class="materials-calc__header">
          <span>Материалы</span>
          <b>${money(f.materials)}</b>
        </div>
        ${hasItems ? `<div class="mat-rows">${materialRows}</div>` : `
          <label class="materials-calc__manual">Сумма материалов (без разбивки)
            <input type="number" min="0" class="fin-input" data-field="materials" data-order="${o.id}" value="${f.materials}" />
          </label>
        `}
        <form class="mat-add-form" data-order="${o.id}">
          <input type="text" name="name" placeholder="Материал" required />
          <input type="number" name="unitPrice" placeholder="Цена/ед." min="0" step="0.01" required />
          <input type="number" name="qty" placeholder="Кол-во" min="0" step="1" value="1" required />
          <button type="submit" class="btn btn--sm"><i class="fa-solid fa-plus"></i></button>
        </form>
      </div>

      <div class="finance-card__footer">
        <span>Себестоимость: <b>${money(costTotal)}</b></span>
        <span class="finance-card__profit ${profit >= 0 ? 'text-pos' : 'text-neg'}">
          Прибыль: <b>${profit >= 0 ? '↑' : '↓'} ${money(Math.abs(profit))}</b>
        </span>
      </div>
    </div>
  `;
}

export function attachFinanceHandlers(root, rerender) {
  root.querySelectorAll('.fin-input').forEach((input) => {
    input.addEventListener('change', () => {
      setFinance(input.getAttribute('data-order'), { [input.getAttribute('data-field')]: Number(input.value) || 0 });
      rerender();
    });
  });

  root.querySelectorAll('[data-remove-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeMaterialItem(btn.getAttribute('data-order'), btn.getAttribute('data-remove-item'));
      rerender();
    });
  });

  root.querySelectorAll('.mat-add-form').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      addMaterialItem(form.getAttribute('data-order'), {
        name: fd.get('name'),
        unitPrice: fd.get('unitPrice'),
        qty: fd.get('qty'),
      });
      rerender();
    });
  });
}
