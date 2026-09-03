import { getState, updateOrderStatus, getOrderDeadlineInfo, KANBAN_COLUMNS, ORDER_STATUSES } from '../store.js';
import { escapeHtml, deadlineBadgeClass } from '../format.js';
import { selectOrder } from './orders.js';

export function renderProduction() {
  const state = getState();

  const cols = KANBAN_COLUMNS.map((col) => {
    const orders = state.orders.filter((o) => o.status === col.status);
    return `
      <div class="prod-col" data-status="${escapeHtml(col.status)}">
        <div class="prod-col__title">${escapeHtml(col.label)} <span class="kanban-col__count">${orders.length}</span></div>
        <div class="prod-col__body" data-drop-status="${escapeHtml(col.status)}">
          ${orders.map((o) => renderCard(o, state)).join('') || '<div class="empty-state empty-state--sm">пусто</div>'}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="page-header">
      <h1>Производство</h1>
      <span class="row-item__sub">Перетащите карточку или выберите статус — доска Kanban по этапам заказа</span>
    </div>
    <div class="prod-board">${cols}</div>
  `;
}

function renderCard(o, state) {
  const manager = state.employees.find((e) => e.id === o.managerId);
  const deadlineInfo = getOrderDeadlineInfo(o);
  return `
    <div class="prod-card" data-order-id="${o.id}" draggable="true">
      <div class="prod-card__title">${escapeHtml(o.productType)} #${o.number}</div>
      <div class="prod-card__sub">${escapeHtml(o.clientName)}</div>
      <div class="prod-card__footer">
        <span>${manager ? escapeHtml(manager.name) : 'не назначен'}</span>
        <span class="${deadlineBadgeClass(deadlineInfo.tone)}">${deadlineInfo.text}</span>
      </div>
      <select class="prod-card__status-select" data-order-status="${o.id}" title="Изменить статус">
        ${ORDER_STATUSES.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
  `;
}

export function attachProductionHandlers(root, rerender) {
  root.querySelectorAll('[data-order-status]').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      updateOrderStatus(sel.getAttribute('data-order-status'), sel.value);
      rerender();
    });
  });

  root.querySelectorAll('.prod-card__title, .prod-card__sub').forEach((el) => {
    el.addEventListener('click', () => {
      const card = el.closest('[data-order-id]');
      selectOrder(card.getAttribute('data-order-id'));
      window.location.hash = '#/orders';
    });
  });

  let draggedId = null;
  root.querySelectorAll('.prod-card').forEach((card) => {
    card.addEventListener('dragstart', () => {
      draggedId = card.getAttribute('data-order-id');
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
  });

  root.querySelectorAll('[data-drop-status]').forEach((col) => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('is-drop-target');
    });
    col.addEventListener('dragleave', () => col.classList.remove('is-drop-target'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('is-drop-target');
      if (draggedId) {
        updateOrderStatus(draggedId, col.getAttribute('data-drop-status'));
        draggedId = null;
        rerender();
      }
    });
  });
}
