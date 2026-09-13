import {
  getState, createOrder, updateOrder, updateOrderStatus, deleteOrder,
  getOrderStages, completeStage, setStageAssignment, isOverdue, STAGE_DEFS,
  PRODUCT_TYPES, ORDER_STATUSES, getOrderDeadlineInfo,
  getFinance, computeOrderFinance,
  addPayment, removePayment, addMaterial, removeMaterial,
  addStockMaterial, updateStockMaterialQty,
  addOrderService, updateOrderServiceQty, removeOrderService,
  addOutsourceExpense, removeOutsourceExpense, addSalaryExpense, removeSalaryExpense,
  addOtherExpense, removeOtherExpense, UNITS, todayISO,
} from '../store.js';
import { money, shortDate, escapeHtml, formatPhone, orderStatusBadgeClass, deadlineBadgeClass } from '../format.js';
import { openModal, closeModal, selectOptions } from '../ui.js';
import { renderPhoneField, attachPhoneFields } from '../phone-field.js';
import { renderMoneyField, attachMoneyFields } from '../money-field.js';
import { can, sees, maskUnless, isOwnScopeOnly, currentEmployeeId } from '../permissions.js';
import { api } from '../api.js';
import { renderPeriodFilter, attachPeriodFilter, getPeriodRange, inPeriodRange } from '../period-filter.js';

let selectedOrderId = null;
let currentQuery = '';
let currentFilter = 'all';
let currentStatusFilter = '';
let currentSort = 'deadline';
let currentPeriod = '';
let currentPeriodFrom = '';
let currentPeriodTo = '';

export function selectOrder(orderId) {
  selectedOrderId = orderId;
}

const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'Активные' },
  { key: 'overdue', label: 'Просроченные' },
  { key: 'unpaid', label: 'Не оплачены' },
  { key: 'done', label: 'Завершённые' },
];
const SORTS = [
  { key: 'deadline', label: 'По сроку' },
  { key: 'new', label: 'Сначала новые' },
  { key: 'amount', label: 'По сумме' },
  { key: 'profit', label: 'По прибыли' },
];

function matchesQuery(o, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    String(o.number).includes(s)
    || o.clientName.toLowerCase().includes(s)
    || (o.clientPhone || '').toLowerCase().includes(s)
    || o.productType.toLowerCase().includes(s)
  );
}

function matchesFilter(o, filter) {
  const fin = computeOrderFinance(o.id);
  switch (filter) {
    case 'active': return o.status !== 'Завершён' && o.status !== 'Отменён';
    case 'overdue': return o.status !== 'Завершён' && o.status !== 'Отменён' && o.deadline < todayISO();
    case 'unpaid': return o.status !== 'Отменён' && fin.remainingAmount > 0;
    case 'done': return o.status === 'Завершён';
    default: return true;
  }
}

function getFilteredOrders(state) {
  let list = state.orders.filter((o) => matchesQuery(o, currentQuery) && matchesFilter(o, currentFilter));
  if (isOwnScopeOnly('orders')) list = list.filter((o) => o.managerId === currentEmployeeId());
  if (currentStatusFilter) list = list.filter((o) => o.status === currentStatusFilter);
  if (currentPeriod) {
    const range = getPeriodRange(currentPeriod, currentPeriodFrom, currentPeriodTo);
    list = list.filter((o) => inPeriodRange(o.createdAt, range));
  }

  const withFin = list.map((o) => ({ o, fin: computeOrderFinance(o.id) }));
  switch (currentSort) {
    case 'new': withFin.sort((a, b) => b.o.createdAt - a.o.createdAt); break;
    case 'amount': withFin.sort((a, b) => b.o.amount - a.o.amount); break;
    case 'profit': withFin.sort((a, b) => b.fin.profit - a.fin.profit); break;
    default: withFin.sort((a, b) => a.o.deadline.localeCompare(b.o.deadline));
  }
  return withFin;
}

export function renderOrders() {
  const state = getState();
  if (!selectedOrderId && state.orders.length) selectedOrderId = state.orders[state.orders.length - 1].id;

  const rows = getFilteredOrders(state);

  const tableRows = rows.map(({ o, fin }) => orderRow(o, fin)).join('');
  const cardRows = rows.map(({ o, fin }) => orderListCard(o, fin)).join('');
  const empty = !rows.length ? '<div class="empty-state">Заказы не найдены</div>' : '';

  return `
    <div class="page-header">
      <h1>Заказы</h1>
      ${can('orders', 'create') ? '<button class="btn btn--primary" data-action="new-order"><i class="fa-solid fa-plus"></i> Новый заказ</button>' : ''}
    </div>

    <div class="orders-toolbar">
      <div class="orders-toolbar__search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" id="orders-search" placeholder="Номер, клиент, телефон, тип..." value="${escapeHtml(currentQuery)}" autocomplete="off" />
      </div>
      <select id="orders-status-filter">
        <option value="">Все статусы</option>
        ${ORDER_STATUSES.map((s) => `<option value="${s}" ${s === currentStatusFilter ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <select id="orders-sort">
        ${SORTS.map((s) => `<option value="${s.key}" ${s.key === currentSort ? 'selected' : ''}>${s.label}</option>`).join('')}
      </select>
      ${renderPeriodFilter('orders', { periodKey: currentPeriod, customFrom: currentPeriodFrom, customTo: currentPeriodTo })}
    </div>
    <div class="orders-filters">
      ${FILTERS.map((f) => `<button type="button" class="chip ${f.key === currentFilter ? 'is-active' : ''}" data-filter="${f.key}">${f.label}</button>`).join('')}
    </div>

    <div class="orders-layout">
      <div class="panel orders-table-panel">
        <div class="panel__body" style="padding:0; overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr><th>№</th><th>Клиент</th><th>Тип</th><th>Сумма</th><th>Получено</th><th>Остаток</th><th>Срок</th><th>Статус</th><th>Прибыль</th></tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
          ${empty}
        </div>
      </div>
      <div class="orders-cards-panel">${cardRows}${empty}</div>
      <div class="panel" id="order-detail">
        ${selectedOrderId ? renderOrderDetail(selectedOrderId) : '<div class="empty-state">Выберите заказ</div>'}
      </div>
    </div>
  `;
}

function orderRow(o, fin) {
  const deadlineInfo = getOrderDeadlineInfo(o);
  return `
    <tr class="${o.id === selectedOrderId ? 'is-selected' : ''}" data-order-row="${o.id}">
      <td>#${o.number}</td>
      <td>${escapeHtml(o.clientName)}</td>
      <td>${escapeHtml(o.productType)}</td>
      <td>${money(o.amount)}</td>
      <td>${money(fin.receivedAmount)}</td>
      <td class="${fin.remainingAmount > 0 ? 'text-neg' : 'text-pos'}">${fin.remainingAmount > 0 ? money(fin.remainingAmount) : 'Оплачено'}</td>
      <td><span class="${deadlineBadgeClass(deadlineInfo.tone)}">${deadlineInfo.text}</span></td>
      <td><span class="${orderStatusBadgeClass(o.status)}">${o.status}</span></td>
      <td class="${fin.profit >= 0 ? 'text-pos' : 'text-neg'}">${maskUnless('seesProfit', money(fin.profit))}</td>
    </tr>
  `;
}

function orderListCard(o, fin) {
  const deadlineInfo = getOrderDeadlineInfo(o);
  return `
    <div class="order-list-card ${o.id === selectedOrderId ? 'is-selected' : ''}" data-order-row="${o.id}">
      <div class="order-list-card__top">
        <b>${escapeHtml(o.productType)} #${o.number}</b>
        <span class="${orderStatusBadgeClass(o.status)}">${o.status}</span>
      </div>
      <div class="row-item__sub">${escapeHtml(o.clientName)}</div>
      <div class="order-list-card__row">
        <span>${money(o.amount)}</span>
        <span class="${deadlineBadgeClass(deadlineInfo.tone)}">${deadlineInfo.text}</span>
      </div>
      <div class="order-list-card__row">
        <span class="${fin.remainingAmount > 0 ? 'text-neg' : 'text-pos'}">${fin.remainingAmount > 0 ? `Остаток ${money(fin.remainingAmount)}` : 'Оплачено'}</span>
        <span class="${fin.profit >= 0 ? 'text-pos' : 'text-neg'}">Прибыль ${maskUnless('seesProfit', money(fin.profit))}</span>
      </div>
    </div>
  `;
}

function renderStatusControl(order) {
  if (!can('orders', 'edit')) {
    return `<span class="${orderStatusBadgeClass(order.status)}">${order.status}</span>`;
  }
  const options = ORDER_STATUSES.filter((s) => {
    if (s === 'Завершён') return can('orders', 'close') || s === order.status;
    if (s === 'Отменён') return can('orders', 'cancel') || s === order.status;
    return true;
  });
  return `
    <select class="${orderStatusBadgeClass(order.status)} status-select" data-order-status="${order.id}">
      ${options.map((s) => `<option value="${s}" ${s === order.status ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
  `;
}

// ---- Order detail ----

function renderOrderDetail(orderId) {
  const state = getState();
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return '<div class="empty-state">Заказ не найден</div>';

  const manager = state.employees.find((e) => e.id === order.managerId);
  const deadlineInfo = getOrderDeadlineInfo(order);
  const fin = computeOrderFinance(orderId);
  const finance = getFinance(orderId);

  return `
    <div class="order-detail__header">
      <div>
        <h2>${escapeHtml(order.productType)} #${order.number}</h2>
        <div class="row-item__sub">${escapeHtml(order.clientName)} · ${order.clientPhone ? `<a class="tel-link" href="tel:${escapeHtml(order.clientPhone.replace(/[^+\d]/g, ''))}">${escapeHtml(formatPhone(order.clientPhone))}</a>` : '—'}</div>
        ${order.address ? `<div class="row-item__sub"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(order.address)}</div>` : ''}
      </div>
      <div class="order-detail__actions">
        ${renderStatusControl(order)}
        <button type="button" class="btn btn--sm" data-action="order-pdf" data-id="${order.id}"><i class="fa-solid fa-file-pdf"></i> PDF</button>
        ${can('orders', 'edit') ? `<button type="button" class="btn btn--sm" data-action="edit-order" data-id="${order.id}"><i class="fa-solid fa-pen"></i></button>` : ''}
        ${can('orders', 'delete') ? `<button type="button" class="btn btn--sm btn--danger-ghost" data-action="delete-order" data-id="${order.id}"><i class="fa-solid fa-trash"></i></button>` : ''}
      </div>
    </div>
    <div class="order-detail__stats">
      <div><span>Сумма</span><b>${money(order.amount)}</b></div>
      <div><span>Начало</span><b>${shortDate(order.startDate)}</b></div>
      <div><span>Срок</span><b class="${deadlineBadgeClass(deadlineInfo.tone)}">${deadlineInfo.text}</b></div>
      <div><span>Ответственный</span><b>${manager ? escapeHtml(manager.name) : '—'}</b></div>
    </div>
    ${order.notes ? `<div class="order-detail__notes"><i class="fa-solid fa-note-sticky"></i> ${escapeHtml(order.notes)}</div>` : ''}

    ${renderPaymentsSection(order, finance, fin)}
    ${renderMaterialsSection(order, finance)}
    ${renderServicesSection(order, finance)}
    ${renderItemsSummary(order, fin)}
    ${renderExpenseSection('outsourcing', 'Аутсорс', 'Название (напр. Покраска)', finance.outsourcing, order.id)}
    ${renderExpenseSection('salary', 'Зарплаты', 'Сотрудник / работа', finance.salaries, order.id)}
    ${renderExpenseSection('expense', 'Прочие расходы', 'Название расхода', finance.otherExpenses, order.id)}
    ${renderFinanceSummary(order, fin)}

    <div class="order-detail__section-title">Этапы производства</div>
    <div class="stage-pipeline">${renderStagePipeline(orderId, state)}</div>

    ${renderActivity(order)}
  `;
}

function renderPaymentsSection(order, finance, fin) {
  const canDelete = can('finance', 'deletePayment');
  const rows = finance.payments.map((p) => `
    <div class="pay-row">
      <span class="pay-row__date">${shortDate(p.date)}</span>
      <span class="pay-row__comment">${escapeHtml(p.comment || 'Оплата')}</span>
      <span class="pay-row__amount">${money(p.amount)}</span>
      ${canDelete ? `<button type="button" class="mat-row__remove" data-remove-payment="${p.id}" data-order="${order.id}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>` : '<span></span>'}
    </div>
  `).join('') || '<div class="empty-state empty-state--sm">Оплат пока нет</div>';

  let remainingLine;
  if (fin.remainingAmount === 0) remainingLine = '<span class="text-pos">Оплачено</span>';
  else if (fin.remainingAmount < 0) remainingLine = `<span class="text-pos">Переплата ${money(Math.abs(fin.remainingAmount))}</span>`;
  else remainingLine = `<span class="text-neg">${money(fin.remainingAmount)}</span>`;

  return `
    <div class="order-detail__section-title">Оплаты</div>
    <div class="section-block">
      <div class="pay-rows">${rows}</div>
      ${can('finance', 'addPayment') ? `
        <form class="add-row-form add-row-form--payment" data-order="${order.id}">
          <input type="date" name="date" value="${todayISO()}" required />
          <input type="text" name="comment" placeholder="Комментарий" />
          <input type="number" name="amount" placeholder="Сумма" min="0" step="0.01" required />
          <button type="submit" class="btn btn--sm"><i class="fa-solid fa-plus"></i> Добавить оплату</button>
        </form>
      ` : ''}
      <div class="section-totals">
        <span>Получено: <b>${money(fin.receivedAmount)}</b></span>
        <span>Остаток: <b>${remainingLine}</b></span>
      </div>
    </div>
  `;
}

function materialRow(order, m, { canDelete, canEdit, seesPrices }) {
  return `
    <div class="mat-row">
      <span class="mat-row__name">${escapeHtml(m.name)}</span>
      <span class="mat-row__calc">
        ${m.source === 'stock' && canEdit ? `<button type="button" class="mat-row__remove" data-edit-material-qty="${m.id}" data-order="${order.id}" title="Изменить количество"><i class="fa-solid fa-pen"></i></button>` : ''}
        ${m.qty} ${escapeHtml(m.unit)} × ${seesPrices ? money(m.unitPrice) : maskUnless('seesPurchasePrices', '')}
      </span>
      <span class="mat-row__sum">${maskUnless('seesPurchasePrices', money(m.qty * m.unitPrice))}</span>
      ${canDelete ? `<button type="button" class="mat-row__remove" data-remove-material="${m.id}" data-order="${order.id}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>` : '<span></span>'}
    </div>
  `;
}

// Материалы is one unified section — both stock-sourced and manually-typed
// rows come from the same finance.materials list (source: 'stock'|'manual'),
// they're just two different ways of adding to it.
function renderMaterialsSection(order, finance) {
  const canDelete = can('finance', 'deletePayment');
  const canEdit = can('finance', 'editPayment');
  const seesPrices = sees('seesPurchasePrices');

  const rows = finance.materials.map((m) => materialRow(order, m, { canDelete, canEdit, seesPrices })).join('')
    || '<div class="empty-state empty-state--sm">Материалы пока не добавлены</div>';

  const materialsTotal = finance.materials.reduce((s, m) => s + m.qty * m.unitPrice, 0);

  return `
    <div class="order-detail__section-title">Материалы</div>
    <div class="section-block">
      ${canEdit ? `<button type="button" class="btn btn--sm" data-action="add-from-stock" data-order="${order.id}"><i class="fa-solid fa-warehouse"></i> Выбрать со склада</button>` : ''}
      <div class="mat-rows">${rows}</div>
      ${canEdit ? `
        <form class="add-row-form add-row-form--material" data-order="${order.id}">
          <input type="text" name="name" placeholder="Добавить вручную" required />
          <input type="number" name="qty" placeholder="Кол-во" min="0.01" step="0.01" value="1" required />
          <select name="unit">${UNITS.map((u) => `<option>${u}</option>`).join('')}</select>
          <input type="number" name="unitPrice" placeholder="Цена/ед." min="0" step="0.01" required />
          <button type="submit" class="btn btn--sm"><i class="fa-solid fa-plus"></i></button>
        </form>
      ` : ''}
      <div class="section-totals"><span>Материалы: <b>${materialsTotal ? maskUnless('seesPurchasePrices', money(materialsTotal)) : '—'}</b></span></div>
    </div>
  `;
}

function serviceRow(order, s, { canDelete, canEdit, seesPrices }) {
  return `
    <div class="mat-row">
      <span class="mat-row__name">${escapeHtml(s.name)}</span>
      <span class="mat-row__calc">
        ${canEdit ? `<button type="button" class="mat-row__remove" data-edit-service-qty="${s.id}" data-order="${order.id}" title="Изменить количество"><i class="fa-solid fa-pen"></i></button>` : ''}
        ${s.qty} ${escapeHtml(s.unit)} × ${seesPrices ? money(s.unitPrice) : maskUnless('seesPurchasePrices', '')}
      </span>
      <span class="mat-row__sum">${maskUnless('seesPurchasePrices', money(s.qty * s.unitPrice))}</span>
      ${canDelete ? `<button type="button" class="mat-row__remove" data-remove-service="${s.id}" data-order="${order.id}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>` : '<span></span>'}
    </div>
  `;
}

function renderServicesSection(order, finance) {
  const canDelete = can('finance', 'deletePayment');
  const canEdit = can('finance', 'editPayment');
  const seesPrices = sees('seesPurchasePrices');

  const rows = finance.services.map((s) => serviceRow(order, s, { canDelete, canEdit, seesPrices })).join('')
    || '<div class="empty-state empty-state--sm">Услуги пока не добавлены</div>';

  const servicesTotal = finance.services.reduce((s, x) => s + x.qty * x.unitPrice, 0);

  return `
    <div class="order-detail__section-title">Услуги</div>
    <div class="section-block">
      ${canEdit ? `<button type="button" class="btn btn--sm" data-action="add-service" data-order="${order.id}"><i class="fa-solid fa-screwdriver-wrench"></i> Добавить услугу</button>` : ''}
      <div class="mat-rows">${rows}</div>
      <div class="section-totals"><span>Услуги: <b>${servicesTotal ? maskUnless('seesPurchasePrices', money(servicesTotal)) : '—'}</b></span></div>
    </div>
  `;
}

// The literal "Материалы: — / Услуги: — / Итого: —" summary the new flow
// calls for — separate from the fuller ФИНАНСЫ panel below (profit/margin/
// cost breakdown), this is just the running total while building the order,
// with a one-click way to carry it into "Сумма договора" if it matches.
function renderItemsSummary(order, fin) {
  const canEdit = can('finance', 'editPayment');
  const itemsTotal = fin.materialsTotal + fin.servicesTotal;
  const fmt = (v) => (v ? maskUnless('seesPurchasePrices', money(v)) : '—');
  return `
    <div class="section-totals order-items-summary">
      <span>Материалы: <b>${fmt(fin.materialsTotal)}</b></span>
      <span>Услуги: <b>${fmt(fin.servicesTotal)}</b></span>
      <span>Итого позиций: <b>${fmt(itemsTotal)}</b></span>
      ${canEdit && itemsTotal > 0 && itemsTotal !== order.amount ? `<button type="button" class="btn btn--sm" data-action="apply-items-total" data-order="${order.id}" data-total="${itemsTotal}">Подставить в сумму договора</button>` : ''}
    </div>
  `;
}

const EXPENSE_ACTIONS = {
  outsourcing: { add: addOutsourceExpense, remove: removeOutsourceExpense, label: 'Итого аутсорс' },
  salary: { add: addSalaryExpense, remove: removeSalaryExpense, label: 'Итого зарплаты' },
  expense: { add: addOtherExpense, remove: removeOtherExpense, label: 'Итого' },
};

function renderExpenseSection(kind, title, placeholder, items, orderId) {
  const canDelete = can('finance', 'deletePayment');
  const financialFlag = kind === 'salary' ? 'seesSalaries' : null;
  const displayAmount = (amount) => (financialFlag ? maskUnless(financialFlag, money(amount)) : money(amount));

  const rows = items.map((it) => `
    <div class="mat-row">
      <span class="mat-row__name">${escapeHtml(it.name)}</span>
      <span class="mat-row__sum">${displayAmount(it.amount)}</span>
      ${canDelete ? `<button type="button" class="mat-row__remove" data-remove-${kind}="${it.id}" data-order="${orderId}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>` : '<span></span>'}
    </div>
  `).join('') || `<div class="empty-state empty-state--sm">Пока не добавлено</div>`;

  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  return `
    <div class="order-detail__section-title">${title}</div>
    <div class="section-block">
      <div class="mat-rows">${rows}</div>
      ${can('finance', 'editPayment') ? `
        <form class="add-row-form add-row-form--${kind}" data-order="${orderId}">
          <input type="text" name="name" placeholder="${placeholder}" required />
          <input type="number" name="amount" placeholder="Сумма" min="0" step="0.01" required />
          <button type="submit" class="btn btn--sm"><i class="fa-solid fa-plus"></i></button>
        </form>
      ` : ''}
      <div class="section-totals"><span>${EXPENSE_ACTIONS[kind].label}: <b>${displayAmount(total)}</b></span></div>
    </div>
  `;
}

function renderFinanceSummary(order, fin) {
  const profitTone = fin.profit > 0 ? (fin.margin < 15 ? 'orange' : 'pos') : 'neg';
  return `
    <div class="finance-summary">
      <div class="finance-summary__title">ФИНАНСЫ</div>
      <div class="finance-summary__row"><span>Стоимость заказа</span><b>${money(order.amount)}</b></div>
      <div class="finance-summary__row"><span>Получено</span><b>${money(fin.receivedAmount)}</b></div>
      <div class="finance-summary__row"><span>Остаток</span><b class="${fin.remainingAmount > 0 ? 'text-neg' : 'text-pos'}">${fin.remainingAmount > 0 ? money(fin.remainingAmount) : (fin.remainingAmount < 0 ? `Переплата ${money(Math.abs(fin.remainingAmount))}` : 'Оплачено')}</b></div>
      <div class="finance-summary__divider"></div>
      <div class="finance-summary__row"><span>Материалы</span><b>${maskUnless('seesPurchasePrices', money(fin.materialsTotal))}</b></div>
      <div class="finance-summary__row"><span>Услуги</span><b>${maskUnless('seesPurchasePrices', money(fin.servicesTotal))}</b></div>
      <div class="finance-summary__row"><span>Аутсорс</span><b>${money(fin.outsourcingTotal)}</b></div>
      <div class="finance-summary__row"><span>Зарплаты</span><b>${maskUnless('seesSalaries', money(fin.salaryTotal))}</b></div>
      <div class="finance-summary__row"><span>Прочие расходы</span><b>${money(fin.otherExpensesTotal)}</b></div>
      <div class="finance-summary__row finance-summary__row--strong"><span>Себестоимость</span><b>${maskUnless('seesCostPrice', money(fin.costPrice))}</b></div>
      <div class="finance-summary__divider"></div>
      <div class="finance-summary__row finance-summary__row--big finance-summary__row--${profitTone}"><span>Прибыль</span><b>${maskUnless('seesProfit', money(fin.profit))}</b></div>
      <div class="finance-summary__row finance-summary__row--${profitTone}"><span>Маржа</span><b>${maskUnless('seesMargin', `${fin.margin.toFixed(1)}%`)}</b></div>
    </div>
  `;
}

function renderStagePipeline(orderId, state) {
  const stages = getOrderStages(orderId);
  return stages.map((st) => {
    const overdue = isOverdue(st.deadline, st.status);
    return `
      <div class="stage-row ${st.skipped ? 'stage-row--skipped' : ''} ${overdue ? 'is-overdue' : ''}">
        <div class="stage-row__status stage-row__status--${st.status === 'готово' ? 'done' : st.status === 'в работе' ? 'active' : 'pending'}">
          <i class="fa-solid ${st.status === 'готово' ? 'fa-check' : st.status === 'в работе' ? 'fa-spinner' : 'fa-circle'}"></i>
        </div>
        <div class="stage-row__body">
          <div class="stage-row__title">
            ${escapeHtml(st.name)}
            ${st.type === 'outsource' ? '<span class="badge badge--muted">аутсорс</span>' : ''}
            ${st.skipped ? '<span class="badge badge--muted">пропущен</span>' : ''}
          </div>
          ${st.skipped ? '' : `
            <div class="stage-row__controls">
              <select class="stage-row__select" data-stage-field="${st.type === 'outsource' ? 'partnerId' : 'assigneeId'}" data-stage-id="${st.id}" ${can('production', 'assign') ? '' : 'disabled'}>
                ${st.type === 'outsource'
                  ? selectOptions(
                      st.service ? state.partners.filter((p) => p.services.includes(st.service)) : state.partners,
                      'id', 'name', st.partnerId,
                    )
                  : selectOptions(state.employees, 'id', 'name', st.assigneeId)}
              </select>
              <input type="date" class="stage-row__date" data-stage-field="deadline" data-stage-id="${st.id}" value="${st.deadline}" ${can('production', 'assign') ? '' : 'disabled'} />
            </div>
          `}
        </div>
        ${!st.skipped && st.status === 'в работе' && can('production', 'changeStatus') ? `<button class="btn btn--sm" data-action="complete-stage" data-stage="${st.id}">Завершить</button>` : ''}
      </div>
    `;
  }).join('');
}

function renderActivity(order) {
  const items = order.activity || [];
  const rows = items.slice(0, 15).map((a) => `
    <div class="activity-row">
      <div class="activity-row__time">${new Date(a.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
      <div class="activity-row__text">${escapeHtml(a.text)}</div>
    </div>
  `).join('') || '<div class="empty-state empty-state--sm">Пока нет истории</div>';

  return `
    <div class="order-detail__section-title">История</div>
    <div class="activity-list">${rows}</div>
  `;
}

// ---- Handlers ----

export function attachOrderHandlers(root, rerender) {
  root.querySelectorAll('[data-order-row]').forEach((row) => {
    row.addEventListener('click', () => {
      selectedOrderId = row.getAttribute('data-order-row');
      rerender();
    });
  });

  const newBtn = root.querySelector('[data-action="new-order"]');
  if (newBtn) newBtn.addEventListener('click', () => openNewOrderModal(rerender));

  const searchInput = root.querySelector('#orders-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => { currentQuery = searchInput.value; rerender(); });
  }
  const statusFilterSel = root.querySelector('#orders-status-filter');
  if (statusFilterSel) statusFilterSel.addEventListener('change', () => { currentStatusFilter = statusFilterSel.value; rerender(); });
  const sortSel = root.querySelector('#orders-sort');
  if (sortSel) sortSel.addEventListener('change', () => { currentSort = sortSel.value; rerender(); });
  attachPeriodFilter(root, 'orders', (periodKey, from, to) => {
    currentPeriod = periodKey; currentPeriodFrom = from; currentPeriodTo = to; rerender();
  });
  root.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => { currentFilter = btn.getAttribute('data-filter'); rerender(); });
  });

  root.querySelectorAll('[data-action="complete-stage"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      completeStage(btn.getAttribute('data-stage'));
      rerender();
    });
  });

  root.querySelectorAll('[data-stage-field]').forEach((el) => {
    el.addEventListener('change', () => {
      setStageAssignment(el.getAttribute('data-stage-id'), { [el.getAttribute('data-stage-field')]: el.value });
      rerender();
    });
  });

  const statusSelect = root.querySelector('[data-order-status]');
  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      updateOrderStatus(statusSelect.getAttribute('data-order-status'), statusSelect.value);
      rerender();
    });
  }

  const editBtn = root.querySelector('[data-action="edit-order"]');
  if (editBtn) editBtn.addEventListener('click', () => openEditOrderModal(editBtn.getAttribute('data-id'), rerender));

  const deleteBtn = root.querySelector('[data-action="delete-order"]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      const state = getState();
      const order = state.orders.find((o) => o.id === deleteBtn.getAttribute('data-id'));
      if (!order) return;
      if (window.confirm(`Удалить заказ ${order.productType} #${order.number}? Все связанные этапы, задачи, переделки и финансы будут удалены.`)) {
        deleteOrder(order.id);
        selectedOrderId = null;
        rerender();
      }
    });
  }

  attachRowRemoveHandlers(root, rerender);
  attachAddFormHandlers(root, rerender);
  attachStockPickerHandlers(root, rerender);
  attachServicePickerHandlers(root, rerender);

  const pdfBtn = root.querySelector('[data-action="order-pdf"]');
  if (pdfBtn) {
    pdfBtn.addEventListener('click', async () => {
      const orderId = pdfBtn.getAttribute('data-id');
      const original = pdfBtn.innerHTML;
      pdfBtn.disabled = true;
      pdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      try {
        const blob = await api.getOrderPdfBlob(orderId);
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
  }

  const applyTotalBtn = root.querySelector('[data-action="apply-items-total"]');
  if (applyTotalBtn) {
    applyTotalBtn.addEventListener('click', () => {
      updateOrder(applyTotalBtn.getAttribute('data-order'), { amount: Number(applyTotalBtn.getAttribute('data-total')) });
      rerender();
    });
  }
}

function attachStockPickerHandlers(root, rerender) {
  const addFromStockBtn = root.querySelector('[data-action="add-from-stock"]');
  if (addFromStockBtn) {
    addFromStockBtn.addEventListener('click', () => openStockPickerModal(addFromStockBtn.getAttribute('data-order'), rerender));
  }

  root.querySelectorAll('[data-edit-material-qty]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const orderId = btn.getAttribute('data-order');
      const materialId = btn.getAttribute('data-edit-material-qty');
      const finance = getFinance(orderId);
      const material = finance.materials.find((m) => m.id === materialId);
      if (!material) return;
      const input = window.prompt(`Новое количество (${material.unit}):`, material.qty);
      if (input === null) return;
      const qty = Number(input);
      if (!qty || qty <= 0) { window.alert('Введите количество больше 0'); return; }
      try {
        await updateStockMaterialQty(orderId, materialId, qty);
        rerender();
      } catch (e) {
        window.alert(e.message || 'Не удалось изменить количество');
      }
    });
  });
}

async function openStockPickerModal(orderId, rerender) {
  let stockItems = [];
  try {
    stockItems = await api.getStockItems({ status: 'active' });
  } catch (e) {
    window.alert(e.message || 'Не удалось загрузить склад');
    return;
  }
  openModal('Добавить материал со склада', `
    <form id="stock-pick-form" class="form">
      <label>Товар
        <select name="specId" id="stock-pick-select" required>
          <option value="">— выберите товар —</option>
          ${stockItems.map((it) => `<option value="${it.id}" data-unit="${escapeHtml(it.unit)}" data-price="${it.salePrice}" data-available="${it.available}">${escapeHtml(it.categoryName)} / ${escapeHtml(it.brandName)} / ${escapeHtml(it.productName)}${it.name ? ` — ${escapeHtml(it.name)}` : ''} (доступно: ${it.available} ${escapeHtml(it.unit)})</option>`).join('')}
        </select>
      </label>
      <label>Количество<input type="number" name="qty" id="stock-pick-qty" min="0.01" step="0.01" value="1" required /></label>
      <p class="form-hint" id="stock-pick-preview"></p>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Добавить</button>
      </div>
    </form>
  `);

  const form = document.getElementById('stock-pick-form');
  const select = document.getElementById('stock-pick-select');
  const qtyInput = document.getElementById('stock-pick-qty');
  const preview = document.getElementById('stock-pick-preview');

  function updatePreview() {
    const opt = select.selectedOptions[0];
    if (!opt || !opt.value) { preview.textContent = ''; return; }
    const price = Number(opt.dataset.price) || 0;
    const qty = Number(qtyInput.value) || 0;
    preview.textContent = `Цена: ${money(price)} × ${qty} = Сумма: ${money(price * qty)}`;
  }
  select.addEventListener('change', updatePreview);
  qtyInput.addEventListener('input', updatePreview);
  updatePreview();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const specId = select.value;
    const qty = Number(qtyInput.value) || 0;
    if (!specId) { window.alert('Выберите товар'); return; }
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await addStockMaterial(orderId, { specId, qty });
      closeModal();
      rerender();
    } catch (err) {
      window.alert(err.message || 'Не удалось добавить материал');
      submitBtn.disabled = false;
    }
  });
}

function attachServicePickerHandlers(root, rerender) {
  const addServiceBtn = root.querySelector('[data-action="add-service"]');
  if (addServiceBtn) {
    addServiceBtn.addEventListener('click', () => openServicePickerModal(addServiceBtn.getAttribute('data-order'), rerender));
  }

  root.querySelectorAll('[data-edit-service-qty]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const orderId = btn.getAttribute('data-order');
      const serviceLineId = btn.getAttribute('data-edit-service-qty');
      const finance = getFinance(orderId);
      const line = finance.services.find((s) => s.id === serviceLineId);
      if (!line) return;
      const input = window.prompt(`Новое количество (${line.unit}):`, line.qty);
      if (input === null) return;
      const qty = Number(input);
      if (!qty || qty <= 0) { window.alert('Введите количество больше 0'); return; }
      try {
        await updateOrderServiceQty(orderId, serviceLineId, qty);
        rerender();
      } catch (e) {
        window.alert(e.message || 'Не удалось изменить количество');
      }
    });
  });
}

async function openServicePickerModal(orderId, rerender) {
  let services = [];
  try {
    services = await api.getServices({ status: 'active' });
  } catch (e) {
    window.alert(e.message || 'Не удалось загрузить услуги');
    return;
  }
  openModal('Добавить услугу', `
    <form id="service-pick-form" class="form">
      <label>Услуга
        <select name="serviceId" id="service-pick-select" required>
          <option value="">— выберите услугу —</option>
          ${services.map((s) => `<option value="${s.id}" data-unit="${escapeHtml(s.unit)}" data-price="${s.price}">${escapeHtml(s.category ? `${s.category} / ` : '')}${escapeHtml(s.name)} (${money(s.price)} / ${escapeHtml(s.unit)})</option>`).join('')}
        </select>
      </label>
      <label>Количество<input type="number" name="qty" id="service-pick-qty" min="0.01" step="0.01" value="1" required /></label>
      <p class="form-hint" id="service-pick-preview"></p>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Добавить</button>
      </div>
    </form>
  `);

  const form = document.getElementById('service-pick-form');
  const select = document.getElementById('service-pick-select');
  const qtyInput = document.getElementById('service-pick-qty');
  const preview = document.getElementById('service-pick-preview');

  function updatePreview() {
    const opt = select.selectedOptions[0];
    if (!opt || !opt.value) { preview.textContent = ''; return; }
    const price = Number(opt.dataset.price) || 0;
    const qty = Number(qtyInput.value) || 0;
    preview.textContent = `Цена: ${money(price)} × ${qty} = Сумма: ${money(price * qty)}`;
  }
  select.addEventListener('change', updatePreview);
  qtyInput.addEventListener('input', updatePreview);
  updatePreview();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const serviceId = select.value;
    const qty = Number(qtyInput.value) || 0;
    if (!serviceId) { window.alert('Выберите услугу'); return; }
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await addOrderService(orderId, { serviceId, qty });
      closeModal();
      rerender();
    } catch (err) {
      window.alert(err.message || 'Не удалось добавить услугу');
      submitBtn.disabled = false;
    }
  });
}

function attachRowRemoveHandlers(root, rerender) {
  root.querySelectorAll('[data-remove-payment]').forEach((btn) => btn.addEventListener('click', () => {
    removePayment(btn.getAttribute('data-order'), btn.getAttribute('data-remove-payment'));
    rerender();
  }));
  root.querySelectorAll('[data-remove-material]').forEach((btn) => btn.addEventListener('click', () => {
    removeMaterial(btn.getAttribute('data-order'), btn.getAttribute('data-remove-material'));
    rerender();
  }));
  root.querySelectorAll('[data-remove-service]').forEach((btn) => btn.addEventListener('click', () => {
    removeOrderService(btn.getAttribute('data-order'), btn.getAttribute('data-remove-service'));
    rerender();
  }));
  root.querySelectorAll('[data-remove-outsourcing]').forEach((btn) => btn.addEventListener('click', () => {
    removeOutsourceExpense(btn.getAttribute('data-order'), btn.getAttribute('data-remove-outsourcing'));
    rerender();
  }));
  root.querySelectorAll('[data-remove-salary]').forEach((btn) => btn.addEventListener('click', () => {
    removeSalaryExpense(btn.getAttribute('data-order'), btn.getAttribute('data-remove-salary'));
    rerender();
  }));
  root.querySelectorAll('[data-remove-expense]').forEach((btn) => btn.addEventListener('click', () => {
    removeOtherExpense(btn.getAttribute('data-order'), btn.getAttribute('data-remove-expense'));
    rerender();
  }));
}

function attachAddFormHandlers(root, rerender) {
  const payForm = root.querySelector('.add-row-form--payment');
  if (payForm) payForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(payForm);
    addPayment(payForm.getAttribute('data-order'), { date: fd.get('date'), comment: fd.get('comment'), amount: fd.get('amount') });
    rerender();
  });

  const matForm = root.querySelector('.add-row-form--material');
  if (matForm) matForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(matForm);
    addMaterial(matForm.getAttribute('data-order'), { name: fd.get('name'), qty: fd.get('qty'), unit: fd.get('unit'), unitPrice: fd.get('unitPrice') });
    rerender();
  });

  const outForm = root.querySelector('.add-row-form--outsourcing');
  if (outForm) outForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(outForm);
    addOutsourceExpense(outForm.getAttribute('data-order'), { name: fd.get('name'), amount: fd.get('amount') });
    rerender();
  });

  const salForm = root.querySelector('.add-row-form--salary');
  if (salForm) salForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(salForm);
    addSalaryExpense(salForm.getAttribute('data-order'), { name: fd.get('name'), amount: fd.get('amount') });
    rerender();
  });

  const expForm = root.querySelector('.add-row-form--expense');
  if (expForm) expForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(expForm);
    addOtherExpense(expForm.getAttribute('data-order'), { name: fd.get('name'), amount: fd.get('amount') });
    rerender();
  });
}

// ---- Create / edit modal ----

function orderFormFields(order) {
  const state = getState();
  return `
    <label>Клиент<input name="clientName" required placeholder="Имя клиента" value="${order ? escapeHtml(order.clientName) : ''}" /></label>
    ${renderPhoneField({ name: 'clientPhone', value: order ? order.clientPhone : '' })}
    <label>Адрес<input name="address" placeholder="Город, улица, дом" value="${order ? escapeHtml(order.address || '') : ''}" /></label>
    <label>Тип изделия
      <select name="productType">
        ${PRODUCT_TYPES.map((t) => `<option ${order?.productType === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </label>
    <label>Ответственный
      <select name="managerId">${selectOptions(state.employees, 'id', 'name', order?.managerId)}</select>
    </label>
    ${renderMoneyField({ name: 'amount', label: 'Сумма договора', value: order ? order.amount : '', required: true })}
    <label>Срок выполнения<input name="deadline" type="date" required value="${order ? order.deadline : ''}" /></label>
    <label>Комментарий<textarea name="notes" rows="2" placeholder="Детали заказа">${order ? escapeHtml(order.notes || '') : ''}</textarea></label>
    ${order ? '' : '<label class="checkbox-label"><input type="checkbox" name="needsCarpentry" checked /> Требует этап «Столярка»</label>'}
  `;
}

function openNewOrderModal(rerender) {
  openModal('Новый заказ', `
    <form id="order-form" class="form">
      ${orderFormFields(null)}
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Создать заказ</button>
      </div>
    </form>
  `);
  attachPhoneFields(document.getElementById('order-form'));
  attachMoneyFields(document.getElementById('order-form'));

  document.getElementById('order-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const order = createOrder({
      clientName: fd.get('clientName'),
      clientPhone: fd.get('clientPhone'),
      address: fd.get('address'),
      productType: fd.get('productType'),
      managerId: fd.get('managerId'),
      amount: fd.get('amount'),
      deadline: fd.get('deadline'),
      notes: fd.get('notes'),
      needsCarpentry: fd.get('needsCarpentry') === 'on',
    });
    selectedOrderId = order.id;
    closeModal();
    rerender();
  });
}

function openEditOrderModal(orderId, rerender) {
  const order = getState().orders.find((o) => o.id === orderId);
  if (!order) return;

  openModal('Изменить заказ', `
    <form id="order-edit-form" class="form">
      ${orderFormFields(order)}
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Сохранить</button>
      </div>
    </form>
  `);
  attachPhoneFields(document.getElementById('order-edit-form'));
  attachMoneyFields(document.getElementById('order-edit-form'));

  document.getElementById('order-edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    updateOrder(orderId, {
      clientName: fd.get('clientName'),
      clientPhone: fd.get('clientPhone'),
      address: fd.get('address'),
      productType: fd.get('productType'),
      managerId: fd.get('managerId'),
      amount: fd.get('amount'),
      deadline: fd.get('deadline'),
      notes: fd.get('notes'),
    });
    closeModal();
    rerender();
  });
}
