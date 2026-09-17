// "Заработная плата" — two things on one page:
// 1) the standalone payroll ledger (accrual != actual payout, partial
//    payouts, running debt) — not tied to any Order, matches a company-wide
//    spreadsheet workflow (employee / amount / date / description).
// 2) the existing per-order salary entries (orders.js's "Зарплаты" block),
//    kept as a secondary read-only list for continuity.
// Money math (can this payout happen, what's left owed) is always decided
// server-side — see server/src/routes/salary.js.

import {
  getState, getFinance, getAccrualTotals, createSalaryAccrual, updateSalaryAccrual, deleteSalaryAccrual,
  paySalaryAccrual, deleteSalaryPayout, SALARY_ACCRUAL_TYPES,
} from '../store.js';
import { money, shortDate, escapeHtml } from '../format.js';
import { can, maskUnless } from '../permissions.js';
import { openModal, closeModal, selectOptions, kpiCard } from '../ui.js';
import { selectOrder } from './orders.js';
import { renderPeriodFilter, attachPeriodFilter, getPeriodRange, inPeriodRange } from '../period-filter.js';
import { exportSalaryWorkbook } from '../export.js';
import { api } from '../api.js';

let currentPeriod = '';
let currentPeriodFrom = '';
let currentPeriodTo = '';
let currentEmployeeFilter = '';
let currentOrderQuery = '';
let expandedAccrualId = null;

const STATUS_TONE = { 'Не выплачено': 'danger', 'Частично выплачено': 'warning', 'Выплачено': 'success' };

// ---- New standalone accrual/payout ledger ----

function filteredAccruals(state) {
  return state.salaryAccruals
    .filter((a) => !currentEmployeeFilter || a.employeeId === currentEmployeeFilter)
    .map((a) => ({ accrual: a, ...getAccrualTotals(a.id) }));
}

function renderAccrualLedger(state) {
  if (!can('salaryPayments', 'view')) return '';
  const canCreate = can('salaryPayments', 'create');
  const canEdit = can('salaryPayments', 'edit');
  const canDelete = can('salaryPayments', 'delete');
  const range = getPeriodRange(currentPeriod, currentPeriodFrom, currentPeriodTo);
  const employeeById = new Map(state.employees.map((e) => [e.id, e]));

  const rows = filteredAccruals(state);
  const accruedInPeriod = rows
    .filter((r) => !currentPeriod || inPeriodRange(r.accrual.createdAt, range))
    .reduce((s, r) => s + (Number(r.accrual.amount) || 0), 0);
  const paidInPeriod = state.salaryPayouts
    .filter((p) => (!currentEmployeeFilter || p.employeeId === currentEmployeeFilter))
    .filter((p) => !currentPeriod || inPeriodRange(new Date(p.paymentDate).getTime(), range))
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const totalDebt = rows.reduce((s, r) => s + r.remaining, 0);
  const employeeCount = new Set(rows.map((r) => r.accrual.employeeId)).size;

  const orderById = new Map(state.orders.map((o) => [o.id, o]));
  const tableRows = rows.map(({ accrual, paid, remaining, status, payouts }) => {
    const employee = employeeById.get(accrual.employeeId);
    const linkedOrder = accrual.orderId ? orderById.get(accrual.orderId) : null;
    const expanded = expandedAccrualId === accrual.id;
    const historyRows = payouts.map((p) => `
      <div class="mat-row">
        <span class="mat-row__name">${shortDate(p.paymentDate)} ${p.paymentMethod ? `· ${escapeHtml(p.paymentMethod)}` : ''} ${p.comment ? `· ${escapeHtml(p.comment)}` : ''}</span>
        <span class="mat-row__sum">${maskUnless('seesSalaries', money(p.amount))}</span>
        ${canDelete ? `<button type="button" class="mat-row__remove" data-remove-payout="${p.id}" title="Удалить выплату"><i class="fa-solid fa-xmark"></i></button>` : '<span></span>'}
      </div>
    `).join('') || '<div class="empty-state empty-state--sm">Выплат ещё не было</div>';

    return `
      <tr>
        <td>${escapeHtml(employee?.name || '—')}</td>
        <td>
          ${escapeHtml(accrual.type)}${accrual.period ? ` · ${escapeHtml(accrual.period)}` : ''}
          ${accrual.comment ? `<div class="row-item__sub">${escapeHtml(accrual.comment)}</div>` : ''}
          ${linkedOrder ? `<button type="button" class="badge badge--muted" data-goto-order="${linkedOrder.id}" style="border:none;cursor:pointer;">#${linkedOrder.number} — ${escapeHtml(linkedOrder.clientName)}</button>` : ''}
        </td>
        <td>${maskUnless('seesSalaries', money(accrual.amount))}</td>
        <td>${maskUnless('seesSalaries', money(paid))}</td>
        <td>${maskUnless('seesSalaries', money(remaining))}</td>
        <td><span class="badge badge--tone-${STATUS_TONE[status]}">${status}</span></td>
        <td class="table-actions">
          <button type="button" class="btn btn--sm" data-action="toggle-history" data-id="${accrual.id}">${expanded ? 'Скрыть' : 'История'}</button>
          ${canCreate && remaining > 0 ? `<button type="button" class="btn btn--sm btn--primary" data-action="pay-accrual" data-id="${accrual.id}">Выплатить</button>` : ''}
          ${canEdit ? `<button type="button" class="btn btn--sm" data-action="edit-accrual" data-id="${accrual.id}" title="Изменить"><i class="fa-solid fa-pen"></i></button>` : ''}
          ${canDelete && !payouts.length ? `<button type="button" class="btn btn--sm btn--danger-ghost" data-action="delete-accrual" data-id="${accrual.id}"><i class="fa-solid fa-trash"></i></button>` : ''}
        </td>
      </tr>
      ${expanded ? `<tr><td colspan="7"><div class="section-block" style="margin:0;"><div class="mat-rows">${historyRows}</div></div></td></tr>` : ''}
    `;
  }).join('') || '<tr><td colspan="7" class="empty-state">Начислений нет</td></tr>';

  return `
    <div class="page-header" style="margin-top:24px;">
      <h1 style="font-size:1.3rem;">Учёт зарплат (начисления и выплаты)</h1>
      ${canCreate ? '<button type="button" class="btn btn--primary" id="new-accrual-btn"><i class="fa-solid fa-plus"></i> Начислить зарплату</button>' : ''}
    </div>
    <div class="kpi-row">
      ${kpiCard('fa-file-invoice-dollar', 'info', 'Начислено за период', maskUnless('seesSalaries', money(accruedInPeriod)))}
      ${kpiCard('fa-hand-holding-dollar', 'success', 'Выплачено за период', maskUnless('seesSalaries', money(paidInPeriod)))}
      ${kpiCard('fa-triangle-exclamation', totalDebt > 0 ? 'warning' : 'success', 'К выплате (всего)', maskUnless('seesSalaries', money(totalDebt)))}
      ${kpiCard('fa-users', 'neutral', 'Сотрудников', `${employeeCount}`)}
    </div>
    <div class="panel">
      <div class="panel__body" style="padding:0; overflow-x:auto">
        <table class="data-table">
          <thead>
            <tr><th>Сотрудник</th><th>Тип / период</th><th>Начислено</th><th>Выплачено</th><th>К выплате</th><th>Статус</th><th></th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function orderOptions(orders, selectedId) {
  return `<option value="">— не привязан —</option>` + [...orders].reverse().map((o) => `
    <option value="${o.id}" ${o.id === selectedId ? 'selected' : ''}>#${o.number} — ${escapeHtml(o.clientName)}</option>
  `).join('');
}

function openAccrualModal(rerender) {
  const state = getState();
  openModal('Начислить зарплату', `
    <form id="accrual-form" class="form">
      <label>Сотрудник
        <select name="employeeId" required>${selectOptions(state.employees, 'id', 'name', '')}</select>
      </label>
      <label>Заказ (необязательно)
        <select name="orderId">${orderOptions(state.orders, '')}</select>
      </label>
      <label>Период<input name="period" placeholder="напр. Сентябрь 2026" /></label>
      <label>Тип
        <select name="type">${SALARY_ACCRUAL_TYPES.map((t) => `<option ${t === 'Оклад' ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </label>
      <label>Сумма<input name="amount" type="number" min="0.01" step="0.01" required /></label>
      <label>Описание / объект<input name="comment" placeholder="напр. 12 коттедж (объект)" /></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Начислить</button>
      </div>
    </form>
  `);
  document.getElementById('accrual-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await createSalaryAccrual({
        employeeId: fd.get('employeeId'), orderId: fd.get('orderId'), period: fd.get('period'), type: fd.get('type'),
        amount: fd.get('amount'), comment: fd.get('comment'),
      });
      closeModal();
      rerender();
    } catch (err) {
      window.alert(err.message || 'Не удалось начислить зарплату');
      submitBtn.disabled = false;
    }
  });
}

function openEditAccrualModal(accrualId, rerender) {
  const state = getState();
  const accrual = state.salaryAccruals.find((a) => a.id === accrualId);
  if (!accrual) return;
  const { paid } = getAccrualTotals(accrualId);
  openModal('Изменить начисление', `
    <form id="edit-accrual-form" class="form">
      <label>Сотрудник
        <select name="employeeId" required>${selectOptions(state.employees, 'id', 'name', accrual.employeeId)}</select>
      </label>
      <label>Заказ (необязательно)
        <select name="orderId">${orderOptions(state.orders, accrual.orderId || '')}</select>
      </label>
      <label>Период<input name="period" value="${escapeHtml(accrual.period || '')}" /></label>
      <label>Тип
        <select name="type">${SALARY_ACCRUAL_TYPES.map((t) => `<option ${t === accrual.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </label>
      <label>Сумма ${paid > 0 ? `(уже выплачено: ${money(paid)}, нельзя уменьшить ниже этой суммы)` : ''}<input name="amount" type="number" min="${paid || 0.01}" step="0.01" value="${accrual.amount}" required /></label>
      <label>Описание / объект<input name="comment" value="${escapeHtml(accrual.comment || '')}" /></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Сохранить</button>
      </div>
    </form>
  `);
  document.getElementById('edit-accrual-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await updateSalaryAccrual(accrualId, {
        employeeId: fd.get('employeeId'), orderId: fd.get('orderId'), period: fd.get('period'), type: fd.get('type'),
        amount: fd.get('amount'), comment: fd.get('comment'),
      });
      closeModal();
      rerender();
    } catch (err) {
      window.alert(err.message || 'Не удалось изменить начисление');
      submitBtn.disabled = false;
    }
  });
}

function openPayoutModal(accrualId, rerender) {
  const { remaining } = getAccrualTotals(accrualId);
  openModal('Выплата зарплаты', `
    <form id="payout-form" class="form">
      <label>Сумма выплаты (остаток: ${money(remaining)})<input name="amount" type="number" min="0.01" max="${remaining}" step="0.01" value="${remaining}" required /></label>
      <label>Способ оплаты<input name="paymentMethod" placeholder="напр. Касса, Банк" /></label>
      <label>Дата<input name="paymentDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
      <label>Комментарий<input name="comment" /></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Выплатить</button>
      </div>
    </form>
  `);
  document.getElementById('payout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await paySalaryAccrual(accrualId, {
        amount: fd.get('amount'), paymentMethod: fd.get('paymentMethod'),
        paymentDate: fd.get('paymentDate'), comment: fd.get('comment'),
      });
      closeModal();
      rerender();
    } catch (err) {
      window.alert(err.message || 'Не удалось провести выплату');
      submitBtn.disabled = false;
    }
  });
}

// ---- Existing per-order salary entries (orders.js's "Зарплаты" block) ----

function collectOrderEntries(state) {
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

function renderOrderEntriesSection(state) {
  const rows = collectOrderEntries(state);
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
    <div class="page-header" style="margin-top:24px;">
      <h1 style="font-size:1.3rem;">Зарплаты по заказам</h1>
      <span class="row-item__sub">Записи из блока «Зарплаты» на странице заказа — входят в себестоимость заказа</span>
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

// ---- Page ----

export function renderSalary() {
  const state = getState();
  return `
    <div class="page-header">
      <h1>Заработная плата</h1>
      <span class="row-item__sub">Начисления, выплаты и задолженность по зарплате сотрудников</span>
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
      ${can('salaryPayments', 'view') ? '<button type="button" class="btn" id="salary-pdf-btn"><i class="fa-solid fa-file-pdf"></i> PDF</button>' : ''}
      <button type="button" class="btn" id="salary-export-btn"><i class="fa-solid fa-file-export"></i> Экспорт</button>
    </div>
    ${renderAccrualLedger(state)}
    ${renderOrderEntriesSection(state)}
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

  const newAccrualBtn = root.querySelector('#new-accrual-btn');
  if (newAccrualBtn) newAccrualBtn.addEventListener('click', () => openAccrualModal(rerender));

  root.querySelectorAll('[data-action="pay-accrual"]').forEach((btn) => {
    btn.addEventListener('click', () => openPayoutModal(btn.getAttribute('data-id'), rerender));
  });

  root.querySelectorAll('[data-action="edit-accrual"]').forEach((btn) => {
    btn.addEventListener('click', () => openEditAccrualModal(btn.getAttribute('data-id'), rerender));
  });

  root.querySelectorAll('[data-action="toggle-history"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      expandedAccrualId = expandedAccrualId === id ? null : id;
      rerender();
    });
  });

  root.querySelectorAll('[data-action="delete-accrual"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!window.confirm('Удалить начисление?')) return;
      try {
        await deleteSalaryAccrual(btn.getAttribute('data-id'));
        rerender();
      } catch (err) {
        window.alert(err.message || 'Не удалось удалить начисление');
      }
    });
  });

  root.querySelectorAll('[data-remove-payout]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!window.confirm('Удалить выплату?')) return;
      try {
        await deleteSalaryPayout(btn.getAttribute('data-remove-payout'));
        rerender();
      } catch (err) {
        window.alert(err.message || 'Не удалось удалить выплату');
      }
    });
  });

  const pdfBtn = root.querySelector('#salary-pdf-btn');
  if (pdfBtn) pdfBtn.addEventListener('click', async () => {
    const original = pdfBtn.innerHTML;
    pdfBtn.disabled = true;
    pdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      const blob = await api.getSalaryReportPdfBlob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      window.alert(e.message || 'Не удалось сформировать PDF');
    } finally {
      pdfBtn.disabled = false;
      pdfBtn.innerHTML = original;
    }
  });

  const exportBtn = root.querySelector('#salary-export-btn');
  if (exportBtn) exportBtn.addEventListener('click', async () => {
    const original = exportBtn.innerHTML;
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      const state = getState();
      await exportSalaryWorkbook(collectOrderEntries(state));
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

  root.querySelectorAll('[data-goto-order]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectOrder(btn.getAttribute('data-goto-order'));
      window.location.hash = '#/orders';
    });
  });
}
