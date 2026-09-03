import { getState, getCarpentryTasks, createTask, updateTaskStatus, isOverdue, TASK_STATUSES } from '../store.js';
import { shortDate, escapeHtml, priorityBadgeClass } from '../format.js';
import { openModal, closeModal, selectOptions } from '../ui.js';

export function renderCarpentry() {
  const tasks = getCarpentryTasks();
  const state = getState();

  const columns = TASK_STATUSES.map((status) => {
    const items = tasks.filter((t) => t.status === status);
    return `
      <div class="kanban-col" data-status="${status}">
        <div class="kanban-col__title">${status} <span class="kanban-col__count">${items.length}</span></div>
        <div class="kanban-col__body">
          ${items.map((t) => renderTaskCard(t, state)).join('') || '<div class="empty-state empty-state--sm">пусто</div>'}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="page-header">
      <h1>Столярка</h1>
      <button class="btn btn--primary" data-action="new-task"><i class="fa-solid fa-plus"></i> Новая задача</button>
    </div>
    <div class="kanban-board">${columns}</div>
  `;
}

function renderTaskCard(t, state) {
  const order = state.orders.find((o) => o.id === t.orderId);
  const assignee = state.employees.find((e) => e.id === t.assigneeId);
  const overdue = isOverdue(t.deadline, t.status);
  return `
    <div class="task-card ${overdue ? 'is-overdue' : ''}" data-task-id="${t.id}">
      <div class="task-card__top">
        <span class="${priorityBadgeClass(t.priority)}">${t.priority !== 'обычный' ? '<i class="fa-solid fa-fire"></i> ' : ''}${t.priority}</span>
        <span class="task-card__qty">×${t.qty}</span>
      </div>
      <div class="task-card__title">${escapeHtml(t.name)}</div>
      <div class="task-card__meta">${order ? `${escapeHtml(order.productType)} #${order.number}` : '—'}</div>
      <div class="task-card__footer">
        <span>${assignee ? escapeHtml(assignee.name) : 'не назначен'}</span>
        <span class="${overdue ? 'is-overdue' : ''}">${shortDate(t.deadline)}</span>
      </div>
      <select class="task-card__status" data-task-status="${t.id}">
        ${TASK_STATUSES.map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
  `;
}

export function attachCarpentryHandlers(root, rerender) {
  const newBtn = root.querySelector('[data-action="new-task"]');
  if (newBtn) newBtn.addEventListener('click', () => openNewTaskModal(rerender));

  root.querySelectorAll('[data-task-status]').forEach((sel) => {
    sel.addEventListener('change', () => {
      updateTaskStatus(sel.getAttribute('data-task-status'), sel.value);
      rerender();
    });
  });
}

function openNewTaskModal(rerender) {
  const state = getState();
  openModal('Новая задача', `
    <form id="task-form" class="form">
      <label>Заказ
        <select name="orderId" required>${selectOptions(state.orders.map((o) => ({ id: o.id, label: `${o.productType} #${o.number}` })), 'id', 'label')}</select>
      </label>
      <label>Название задачи<input name="name" required placeholder="Фасады МДФ 12 шт" /></label>
      <label>Количество<input name="qty" type="number" min="1" value="1" /></label>
      <label>Мастер
        <select name="assigneeId">${selectOptions(state.employees, 'id', 'name')}</select>
      </label>
      <label>Дедлайн<input name="deadline" type="date" required /></label>
      <label>Приоритет
        <select name="priority">
          <option value="обычный">обычный</option>
          <option value="срочный">срочный</option>
        </select>
      </label>
      <label>Комментарий<textarea name="comment" rows="2"></textarea></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Создать задачу</button>
      </div>
    </form>
  `);

  document.getElementById('task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    createTask({
      orderId: fd.get('orderId'),
      stageKey: 'carpentry',
      name: fd.get('name'),
      qty: fd.get('qty'),
      assigneeId: fd.get('assigneeId'),
      deadline: fd.get('deadline'),
      priority: fd.get('priority'),
      comment: fd.get('comment'),
    });
    closeModal();
    rerender();
  });
}
