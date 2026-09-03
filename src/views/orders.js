import {
  getState, createOrder, updateOrder, updateOrderStatus, deleteOrder,
  getOrderStages, completeStage, setStageAssignment, isOverdue, STAGE_DEFS,
  PRODUCT_TYPES, ORDER_STATUSES, getOrderDeadlineInfo,
  getFinance, computeOrderFinance,
  addPayment, removePayment, addMaterial, removeMaterial,
  addOutsourceExpense, removeOutsourceExpense, addSalaryExpense, removeSalaryExpense,
  addOtherExpense, removeOtherExpense, UNITS, todayISO,
} from '../store.js';
import { money, shortDate, escapeHtml, formatPhone, orderStatusBadgeClass, deadlineBadgeClass } from '../format.js';
import { openModal, closeModal, selectOptions } from '../ui.js';
import { renderPhoneField, attachPhoneFields } from '../phone-field.js';
import { renderMoneyField, attachMoneyFields } from '../money-field.js';

let selectedOrderId = null;
let currentQuery = '';
let currentFilter = 'all';
let currentStatusFilter = '';
let currentSort = 'deadline';

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
  if (currentStatusFilter) list = list.filter((o) => o.status === currentStatusFilter);

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
      <button class="btn btn--primary" data-action="new-order"><i class="fa-solid fa-plus"></i> Новый заказ</button>
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
      <td class="${fin.profit >= 0 ? 'text-pos' : 'text-neg'}">${money(fin.profit)}</td>
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
        <span class="${fin.profit >= 0 ? 'text-pos' : 'text-neg'}">Прибыль ${money(fin.profit)}</span>
      </div>
    </div>
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
        <select class="${orderStatusBadgeClass(order.status)} status-select" data-order-status="${order.id}">
          ${ORDER_STATUSES.map((s) => `<option value="${s}" ${s === order.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <button type="button" class="btn btn--sm" data-action="edit-order" data-id="${order.id}"><i class="fa-solid fa-pen"></i></button>
        <button type="button" class="btn btn--sm btn--danger-ghost" data-action="delete-order" data-id="${order.id}"><i class="fa-solid fa-trash"></i></button>
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
  const rows = finance.payments.map((p) => `
    <div class="pay-row">
      <span class="pay-row__date">${shortDate(p.date)}</span>
      <span class="pay-row__comment">${escapeHtml(p.comment || 'Оплата')}</span>
      <span class="pay-row__amount">${money(p.amount)}</span>
      <button type="button" class="mat-row__remove" data-remove-payment="${p.id}" data-order="${order.id}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>
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
      <form class="add-row-form add-row-form--payment" data-order="${order.id}">
        <input type="date" name="date" value="${todayISO()}" required />
        <input type="text" name="comment" placeholder="Комментарий" />
        <input type="number" name="amount" placeholder="Сумма" min="0" step="0.01" required />
        <button type="submit" class="btn btn--sm"><i class="fa-solid fa-plus"></i> Добавить оплату</button>
      </form>
      <div class="section-totals">
        <span>Получено: <b>${money(fin.receivedAmount)}</b></span>
        <span>Остаток: <b>${remainingLine}</b></span>
      </div>
    </div>
  `;
}

function renderMaterialsSection(order, finance) {
  const rows = finance.materials.map((m) => `
    <div class="mat-row">
      <span class="mat-row__name">${escapeHtml(m.name)}</span>
      <span class="mat-row__calc">${m.qty} ${escapeHtml(m.unit)} × ${money(m.unitPrice)}</span>
      <span class="mat-row__sum">${money(m.qty * m.unitPrice)}</span>
      <button type="button" class="mat-row__remove" data-remove-material="${m.id}" data-order="${order.id}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>
    </div>
  `).join('') || '<div class="empty-state empty-state--sm">Материалы пока не добавлены</div>';

  const materialsTotal = finance.materials.reduce((s, m) => s + m.qty * m.unitPrice, 0);

  return `
    <div class="order-detail__section-title">Материалы</div>
    <div class="section-block">
      <div class="mat-rows">${rows}</div>
      <form class="add-row-form add-row-form--material" data-order="${order.id}">
        <input type="text" name="name" placeholder="Материал" required />
        <input type="number" name="qty" placeholder="Кол-во" min="0" step="0.01" value="1" required />
        <select name="unit">${UNITS.map((u) => `<option>${u}</option>`).join('')}</select>
        <input type="number" name="unitPrice" placeholder="Цена/ед." min="0" step="0.01" required />
        <button type="submit" class="btn btn--sm"><i class="fa-solid fa-plus"></i></button>
      </form>
      <div class="section-totals"><span>Материалы: <b>${money(materialsTotal)}</b></span></div>
    </div>
  `;
}

const EXPENSE_ACTIONS = {
  outsourcing: { add: addOutsourceExpense, remove: removeOutsourceExpense, label: 'Итого аутсорс' },
  salary: { add: addSalaryExpense, remove: removeSalaryExpense, label: 'Итого зарплаты' },
  expense: { add: addOtherExpense, remove: removeOtherExpense, label: 'Итого' },
};

function renderExpenseSection(kind, title, placeholder, items, orderId) {
  const rows = items.map((it) => `
    <div class="mat-row">
      <span class="mat-row__name">${escapeHtml(it.name)}</span>
      <span class="mat-row__sum">${money(it.amount)}</span>
      <button type="button" class="mat-row__remove" data-remove-${kind}="${it.id}" data-order="${orderId}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>
    </div>
  `).join('') || `<div class="empty-state empty-state--sm">Пока не добавлено</div>`;

  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  return `
    <div class="order-detail__section-title">${title}</div>
    <div class="section-block">
      <div class="mat-rows">${rows}</div>
      <form class="add-row-form add-row-form--${kind}" data-order="${orderId}">
        <input type="text" name="name" placeholder="${placeholder}" required />
        <input type="number" name="amount" placeholder="Сумма" min="0" step="0.01" required />
        <button type="submit" class="btn btn--sm"><i class="fa-solid fa-plus"></i></button>
      </form>
      <div class="section-totals"><span>${EXPENSE_ACTIONS[kind].label}: <b>${money(total)}</b></span></div>
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
      <div class="finance-summary__row"><span>Материалы</span><b>${money(fin.materialsTotal)}</b></div>
      <div class="finance-summary__row"><span>Аутсорс</span><b>${money(fin.outsourcingTotal)}</b></div>
      <div class="finance-summary__row"><span>Зарплаты</span><b>${money(fin.salaryTotal)}</b></div>
      <div class="finance-summary__row"><span>Прочие расходы</span><b>${money(fin.otherExpensesTotal)}</b></div>
      <div class="finance-summary__row finance-summary__row--strong"><span>Себестоимость</span><b>${money(fin.costPrice)}</b></div>
      <div class="finance-summary__divider"></div>
      <div class="finance-summary__row finance-summary__row--big finance-summary__row--${profitTone}"><span>Прибыль</span><b>${money(fin.profit)}</b></div>
      <div class="finance-summary__row finance-summary__row--${profitTone}"><span>Маржа</span><b>${fin.margin.toFixed(1)}%</b></div>
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
              <select class="stage-row__select" data-stage-field="${st.type === 'outsource' ? 'partnerId' : 'assigneeId'}" data-stage-id="${st.id}">
                ${st.type === 'outsource'
                  ? selectOptions(
                      st.service ? state.partners.filter((p) => p.services.includes(st.service)) : state.partners,
                      'id', 'name', st.partnerId,
                    )
                  : selectOptions(state.employees, 'id', 'name', st.assigneeId)}
              </select>
              <input type="date" class="stage-row__date" data-stage-field="deadline" data-stage-id="${st.id}" value="${st.deadline}" />
            </div>
          `}
        </div>
        ${!st.skipped && st.status === 'в работе' ? `<button class="btn btn--sm" data-action="complete-stage" data-stage="${st.id}">Завершить</button>` : ''}
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
