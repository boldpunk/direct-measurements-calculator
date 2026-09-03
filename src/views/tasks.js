import {
  getState, createTask, updateTask, updateTaskStatus, deleteTask,
  TASK_STATUSES, TASK_PRIORITIES, todayISO,
} from '../store.js';
import { shortDate, escapeHtml, priorityBadgeClass } from '../format.js';
import { openModal, closeModal, selectOptions } from '../ui.js';
import { selectOrder } from './orders.js';

let currentFilter = 'all';

const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'today', label: 'Сегодня' },
  { key: 'overdue', label: 'Просроченные' },
  { key: 'upcoming', label: 'Предстоящие' },
  { key: 'done', label: 'Выполненные' },
];

function matchesFilter(t) {
  const today = todayISO();
  const done = t.status === 'готово';
  switch (currentFilter) {
    case 'today': return !done && t.deadline === today;
    case 'overdue': return !done && t.deadline < today;
    case 'upcoming': return !done && t.deadline > today;
    case 'done': return done;
    default: return true;
  }
}

export function renderTasks() {
  const state = getState();
  const tasks = [...state.tasks].sort((a, b) => a.deadline.localeCompare(b.deadline)).filter(matchesFilter);

  const rows = tasks.map((t) => renderTaskRow(t, state)).join('') || '<div class="empty-state">Нет активных задач</div>';

  return `
    <div class="page-header">
      <h1>Задачи</h1>
      <button class="btn btn--primary" data-action="new-task"><i class="fa-solid fa-plus"></i> Новая задача</button>
    </div>
    <div class="orders-filters">
      ${FILTERS.map((f) => `<button type="button" class="chip ${f.key === currentFilter ? 'is-active' : ''}" data-task-filter="${f.key}">${f.label}</button>`).join('')}
    </div>
    <div class="task-list">${rows}</div>
  `;
}

function renderTaskRow(t, state) {
  const order = state.orders.find((o) => o.id === t.orderId);
  const assignee = state.employees.find((e) => e.id === t.assigneeId);
  const overdue = t.status !== 'готово' && t.deadline < todayISO();

  return `
    <div class="task-row-card ${overdue ? 'is-overdue' : ''}">
      <div class="task-row-card__main">
        <div class="task-row-card__title">${escapeHtml(t.name)}</div>
        <div class="task-row-card__meta">
          ${order ? `<a href="#/orders" data-open-order="${order.id}">${escapeHtml(order.productType)} #${order.number}</a> · ` : ''}
          ${assignee ? escapeHtml(assignee.name) : 'не назначен'} ·
          <span class="${overdue ? 'is-overdue' : ''}">${shortDate(t.deadline)}</span>
        </div>
      </div>
      <select class="${priorityBadgeClass(t.priority)} priority-select" data-task-priority="${t.id}">
        ${TASK_PRIORITIES.map((p) => `<option value="${p}" ${p === t.priority ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
      <select class="task-row-card__status" data-task-status="${t.id}">
        ${TASK_STATUSES.map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <button type="button" class="task-card__delete" data-action="delete-task" data-id="${t.id}" title="Удалить задачу">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `;
}

export function attachTasksHandlers(root, rerender) {
  root.querySelectorAll('[data-task-filter]').forEach((btn) => {
    btn.addEventListener('click', () => { currentFilter = btn.getAttribute('data-task-filter'); rerender(); });
  });

  root.querySelectorAll('[data-task-status]').forEach((sel) => {
    sel.addEventListener('change', () => { updateTaskStatus(sel.getAttribute('data-task-status'), sel.value); rerender(); });
  });
  root.querySelectorAll('[data-task-priority]').forEach((sel) => {
    sel.addEventListener('change', () => { updateTask(sel.getAttribute('data-task-priority'), { priority: sel.value }); rerender(); });
  });
  root.querySelectorAll('[data-action="delete-task"]').forEach((btn) => {
    btn.addEventListener('click', () => { deleteTask(btn.getAttribute('data-id')); rerender(); });
  });
  root.querySelectorAll('[data-open-order]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      selectOrder(link.getAttribute('data-open-order'));
      window.location.hash = '#/orders';
    });
  });

  const newBtn = root.querySelector('[data-action="new-task"]');
  if (newBtn) newBtn.addEventListener('click', () => openNewTaskModal(rerender));
}

function openNewTaskModal(rerender) {
  const state = getState();
  openModal('Новая задача', `
    <form id="general-task-form" class="form">
      <label>Название<input name="name" required placeholder="Заказать фасады" /></label>
      <label>Связанный заказ
        <select name="orderId">${selectOptions(state.orders.map((o) => ({ id: o.id, label: `${o.productType} #${o.number}` })), 'id', 'label')}</select>
      </label>
      <label>Ответственный
        <select name="assigneeId">${selectOptions(state.employees, 'id', 'name')}</select>
      </label>
      <label>Срок<input name="deadline" type="date" required value="${todayISO()}" /></label>
      <label>Приоритет
        <select name="priority">${TASK_PRIORITIES.map((p) => `<option ${p === 'Средний' ? 'selected' : ''}>${p}</option>`).join('')}</select>
      </label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Создать задачу</button>
      </div>
    </form>
  `);

  document.getElementById('general-task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    createTask({
      name: fd.get('name'),
      orderId: fd.get('orderId'),
      assigneeId: fd.get('assigneeId'),
      deadline: fd.get('deadline'),
      priority: fd.get('priority'),
    });
    closeModal();
    rerender();
  });
}
