import { getState, createEmployee, deleteEmployee, getEmployeeActiveTasks, EMPLOYEE_ROLES } from '../store.js';
import { escapeHtml, formatPhone } from '../format.js';
import { openModal, closeModal } from '../ui.js';
import { renderPhoneField, attachPhoneFields } from '../phone-field.js';

export function renderEmployees() {
  const state = getState();

  const rows = state.employees.map((e) => {
    const activeTasks = getEmployeeActiveTasks(e.id);
    return `
      <div class="employee-card">
        <div class="employee-card__avatar"><i class="fa-solid fa-user"></i></div>
        <div class="employee-card__body">
          <b>${escapeHtml(e.name)}</b>
          <div class="row-item__sub">${escapeHtml(e.role)}</div>
          <div class="row-item__sub">${e.phone ? `<a class="tel-link" href="tel:${escapeHtml(e.phone.replace(/[^+\d]/g, ''))}">${escapeHtml(formatPhone(e.phone))}</a>` : '—'}</div>
        </div>
        <div class="employee-card__tasks">
          ${activeTasks.length
            ? `<a class="badge badge--muted" href="#/carpentry" title="Открыть доску Столярка">${activeTasks.length} задач</a>`
            : `<span class="badge badge--muted">0 задач</span>`}
        </div>
        <button class="btn btn--sm btn--danger-ghost" data-action="delete-employee" data-id="${e.id}">Удалить</button>
      </div>
    `;
  }).join('') || '<div class="empty-state">Сотрудников нет</div>';

  return `
    <div class="page-header">
      <h1>Сотрудники</h1>
      <button class="btn btn--primary" data-action="new-employee"><i class="fa-solid fa-plus"></i> Добавить сотрудника</button>
    </div>
    <div class="employee-list">${rows}</div>
  `;
}

export function attachEmployeesHandlers(root, rerender) {
  const newBtn = root.querySelector('[data-action="new-employee"]');
  if (newBtn) newBtn.addEventListener('click', () => openNewEmployeeModal(rerender));

  root.querySelectorAll('[data-action="delete-employee"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      deleteEmployee(btn.getAttribute('data-id'));
      rerender();
    });
  });
}

function openNewEmployeeModal(rerender) {
  openModal('Новый сотрудник', `
    <form id="employee-form" class="form">
      <label>Имя<input name="name" required placeholder="Имя сотрудника" /></label>
      <label>Роль
        <select name="role">${EMPLOYEE_ROLES.map((r) => `<option value="${r}">${r}</option>`).join('')}</select>
      </label>
      ${renderPhoneField({ name: 'phone', label: 'Контакты' })}
      <label>Email для входа <span class="form-hint">(необязательно)</span><input name="email" type="email" placeholder="employee@mebelflow.uz" /></label>
      <label>Пароль <span class="form-hint">(необязательно)</span><input name="password" type="password" placeholder="Оставьте пустым, если вход не нужен" /></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Добавить</button>
      </div>
    </form>
  `);
  attachPhoneFields(document.getElementById('employee-form'));

  document.getElementById('employee-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    createEmployee({
      name: fd.get('name'),
      role: fd.get('role'),
      phone: fd.get('phone'),
      email: fd.get('email'),
      password: fd.get('password'),
    });
    closeModal();
    rerender();
  });
}
