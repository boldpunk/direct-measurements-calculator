// "Заработная плата" — a standalone page listing every salary accrual
// across all orders (not just the current one), with filters by employee,
// period and order number. Per-order entry/editing still lives in the order
// detail's "Зарплаты" block (orders.js) — this page is the read-oriented
// cross-order view the ТЗ calls for.

import { getState, getFinance } from '../store.js';
import { money, shortDate, escapeHtml } from '../format.js';
import { can, maskUnless } from '../permissions.js';
import { selectOrder } from './orders.js';
import { renderPeriodFilter, attachPeriodFilter, getPeriodRange, inPeriodRange } from '../period-filter.js';
import { exportSalaryWorkbook } from '../export.js';

let currentPeriod = '';
let currentPeriodFrom = '';
let currentPeriodTo = '';
let currentEmployeeFilter = '';
let currentOrderQuery = '';

function collectEntries(state) {
  const range = getPeriodRange(currentPeriod, currentPeriodFrom, currentPeriodTo);
  const employeeById = new Map(state.employees.map((e) => [e.id, e]));
  const rows = [];
  for (const order of state.orders) {
    for (const entry of getFinance(order.id).salaries) {
      const entryTimestamp = entry.date ? new Date(entry.date).getTime() : order.createdAt;
      if (currentPeriod && !inPeriodRange(entryTimestamp, range)) continue;
      if (currentEmployeeFilter && entry.employeeId !== currentEmployeeFilter) continue;
      if (currentOrderQuery && !String(order.number).includes(currentOrderQuery.trim())) continue;
      rows.push({
        entry, order,
        createdByName: entry.createdById ? (employeeById.get(entry.createdById)?.name || '') : '',
      });
    }
  }
  return rows.sort((a, b) => (b.entry.date || '').localeCompare(a.entry.date || ''));
}

export function renderSalary() {
  const state = getState();
  const rows = collectEntries(state);
  const total = rows.reduce((sum, r) => sum + (Number(r.entry.amount) || 0), 0);

  const tableRows = rows.map((r) => `
    <tr data-order-row="${r.order.id}">
      <td>${escapeHtml(r.entry.name)}</td>
      <td>#${r.order.number} — ${escapeHtml(r.order.clientName)}</td>
      <td>${maskUnless('seesSalaries', money(r.entry.amount))}</td>
      <td>${r.entry.date ? shortDate(r.entry.date) : '—'}</td>
      <td>${escapeHtml(r.createdByName || '—')}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-state">Начислений нет</td></tr>';

  return `
    <div class="page-header">
      <h1>Заработная плата</h1>
      <span class="row-item__sub">Все начисления зарплат по всем заказам за выбранный период</span>
    </div>
    <div class="orders-toolbar">
      ${renderPeriodFilter('salary', { periodKey: currentPeriod, customFrom: currentPeriodFrom, customTo: currentPeriodTo })}
      <select id="salary-employee-filter">
        <option value="">Все сотрудники</option>
        ${state.employees.map((e) => `<option value="${e.id}" ${e.id === currentEmployeeFilter ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}
      </select>
      <div class="orders-toolbar__search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" id="salary-order-search" placeholder="№ заказа" value="${escapeHtml(currentOrderQuery)}" autocomplete="off" />
      </div>
      <button type="button" class="btn" id="salary-export-btn"><i class="fa-solid fa-file-export"></i> Экспорт</button>
    </div>
    <div class="panel">
      <div class="panel__body" style="padding:0 0 14px;">
        <div class="section-totals" style="padding:14px 16px 0;"><span>Итого за период: <b>${maskUnless('seesSalaries', money(total))}</b></span></div>
      </div>
      <div class="panel__body" style="padding:0; overflow-x:auto">
        <table class="data-table">
          <thead>
            <tr><th>Сотрудник</th><th>Заказ</th><th>Сумма</th><th>Дата начисления</th><th>Кто начислил</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

export function attachSalaryHandlers(root, rerender) {
  attachPeriodFilter(root, 'salary', (periodKey, from, to) => {
    currentPeriod = periodKey; currentPeriodFrom = from; currentPeriodTo = to; rerender();
  });

  const employeeFilter = root.querySelector('#salary-employee-filter');
  if (employeeFilter) employeeFilter.addEventListener('change', () => {
    currentEmployeeFilter = employeeFilter.value; rerender();
  });

  const orderSearch = root.querySelector('#salary-order-search');
  if (orderSearch) orderSearch.addEventListener('input', () => {
    currentOrderQuery = orderSearch.value; rerender();
  });

  const exportBtn = root.querySelector('#salary-export-btn');
  if (exportBtn) exportBtn.addEventListener('click', async () => {
    const original = exportBtn.innerHTML;
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      const state = getState();
      await exportSalaryWorkbook(collectEntries(state));
    } catch (e) {
      console.error('Salary export failed', e);
      window.alert('Не удалось создать файл экспорта.');
    } finally {
      exportBtn.disabled = false;
      exportBtn.innerHTML = original;
    }
  });

  root.querySelectorAll('[data-order-row]').forEach((row) => {
    row.addEventListener('click', () => {
      selectOrder(row.getAttribute('data-order-row'));
      window.location.hash = '#/orders';
    });
  });
}

