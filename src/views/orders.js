import {
  getState, createOrder, getOrderStages, completeStage, setStageAssignment,
  isOverdue, STAGE_DEFS,
} from '../store.js';
import { money, shortDate, escapeHtml, statusBadgeClass } from '../format.js';
import { openModal, closeModal, selectOptions } from '../ui.js';

let selectedOrderId = null;

export function selectOrder(orderId) {
  selectedOrderId = orderId;
}

export function renderOrders() {
  const state = getState();
  if (!selectedOrderId && state.orders.length) selectedOrderId = state.orders[state.orders.length - 1].id;

  const rows = [...state.orders].reverse().map((o) => `
    <tr class="${o.id === selectedOrderId ? 'is-selected' : ''}" data-order-row="${o.id}">
      <td>#${o.number}</td>
      <td>${escapeHtml(o.productType)}</td>
      <td>${escapeHtml(o.clientName)}</td>
      <td>${money(o.amount)}</td>
      <td>${shortDate(o.deadline)}</td>
      <td><span class="badge badge--stage-${o.status === 'завершён' ? 'done' : 'active'}">${o.status}</span></td>
    </tr>
  `).join('');

  return `
    <div class="page-header">
      <h1>Заказы</h1>
      <button class="btn btn--primary" data-action="new-order"><i class="fa-solid fa-plus"></i> Новый заказ</button>
    </div>
    <div class="orders-layout">
      <div class="panel">
        <div class="panel__body" style="padding:0; overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr><th>№</th><th>Изделие</th><th>Клиент</th><th>Сумма</th><th>Дедлайн</th><th>Статус</th></tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="6" class="empty-state">Заказов нет</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="panel" id="order-detail">
        ${selectedOrderId ? renderOrderDetail(selectedOrderId) : '<div class="empty-state">Выберите заказ</div>'}
      </div>
    </div>
  `;
}

function renderOrderDetail(orderId) {
  const state = getState();
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return '<div class="empty-state">Заказ не найден</div>';
  const stages = getOrderStages(orderId);

  const stageRows = stages.map((st) => {
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

  return `
    <div class="order-detail__header">
      <div>
        <h2>${escapeHtml(order.productType)} #${order.number}</h2>
        <div class="row-item__sub">${escapeHtml(order.clientName)} · ${order.clientPhone ? `<a class="tel-link" href="tel:${escapeHtml(order.clientPhone.replace(/[^+\d]/g, ''))}">${escapeHtml(order.clientPhone)}</a>` : '—'}</div>
      </div>
      <span class="badge badge--stage-${order.status === 'завершён' ? 'done' : 'active'}">${order.status}</span>
    </div>
    <div class="order-detail__stats">
      <div><span>Сумма</span><b>${money(order.amount)}</b></div>
      <div><span>Начало</span><b>${shortDate(order.startDate)}</b></div>
      <div><span>Дедлайн</span><b>${shortDate(order.deadline)}</b></div>
    </div>
    <div class="stage-pipeline">${stageRows}</div>
  `;
}

export function attachOrderHandlers(root, rerender) {
  root.querySelectorAll('[data-order-row]').forEach((row) => {
    row.addEventListener('click', () => {
      selectedOrderId = row.getAttribute('data-order-row');
      rerender();
    });
  });

  const newBtn = root.querySelector('[data-action="new-order"]');
  if (newBtn) newBtn.addEventListener('click', () => openNewOrderModal(rerender));

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
}

function openNewOrderModal(rerender) {
  openModal('Новый заказ', `
    <form id="order-form" class="form">
      <label>Клиент<input name="clientName" required placeholder="Имя клиента" /></label>
      <label>Телефон<input name="clientPhone" placeholder="+998 90 000-00-00" /></label>
      <label>Тип изделия
        <select name="productType">
          <option>Кухня</option>
          <option>Шкаф</option>
          <option>Гардеробная</option>
          <option>Другое</option>
        </select>
      </label>
      <label>Сумма договора, $<input name="amount" type="number" min="0" step="1" required /></label>
      <label>Дедлайн<input name="deadline" type="date" required /></label>
      <label class="checkbox-label"><input type="checkbox" name="needsCarpentry" checked /> Требует этап «Столярка»</label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Создать заказ</button>
      </div>
    </form>
  `);

  document.getElementById('order-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const order = createOrder({
      clientName: fd.get('clientName'),
      clientPhone: fd.get('clientPhone'),
      productType: fd.get('productType'),
      amount: fd.get('amount'),
      deadline: fd.get('deadline'),
      needsCarpentry: fd.get('needsCarpentry') === 'on',
    });
    selectedOrderId = order.id;
    closeModal();
    rerender();
  });
}
