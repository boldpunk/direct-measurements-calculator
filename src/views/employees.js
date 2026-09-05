import { getState, getEmployeeActiveTasks, EMPLOYEE_ROLES, replaceEmployeeInState, removeEmployeeFromState } from '../store.js';
import { escapeHtml, formatPhone } from '../format.js';
import { openModal, closeModal } from '../ui.js';
import { renderPhoneField, attachPhoneFields } from '../phone-field.js';
import { api } from '../api.js';
import { can, currentEmployeeId } from '../permissions.js';
import {
  MODULES, MODULE_LABELS, ACTION_LABELS,
  FINANCIAL_FLAGS, FINANCIAL_FLAG_LABELS, SCOPE_FLAG_LABELS, emptyPermissions,
} from '../rbac-schema.js';

let rolePresets = null;

export function renderEmployees() {
  const state = getState();
  const canEdit = can('employees', 'edit');
  const canBlock = can('employees', 'block');
  const canDelete = can('employees', 'delete');
  const myId = currentEmployeeId();

  const rows = state.employees.map((e) => {
    const activeTasks = getEmployeeActiveTasks(e.id);
    const isMe = e.id === myId;
    return `
      <div class="employee-card ${e.isBlocked ? 'employee-card--blocked' : ''}">
        <div class="employee-card__avatar"><i class="fa-solid fa-user"></i></div>
        <div class="employee-card__body">
          <b>${escapeHtml(e.name)}</b> ${e.isBlocked ? '<span class="badge badge--muted">заблокирован</span>' : ''}
          <div class="row-item__sub">${escapeHtml(e.role)}${e.accessRole ? ` · ${escapeHtml(e.accessRole)}` : ''}</div>
          <div class="row-item__sub">${e.phone ? `<a class="tel-link" href="tel:${escapeHtml(e.phone.replace(/[^+\d]/g, ''))}">${escapeHtml(formatPhone(e.phone))}</a>` : '—'}</div>
        </div>
        <div class="employee-card__tasks">
          ${activeTasks.length
            ? `<a class="badge badge--muted" href="#/carpentry" title="Открыть доску Столярка">${activeTasks.length} задач</a>`
            : `<span class="badge badge--muted">0 задач</span>`}
        </div>
        <div class="employee-card__actions">
          ${canEdit ? `<button class="btn btn--sm" data-action="edit-employee" data-id="${e.id}" title="Изменить"><i class="fa-solid fa-pen"></i></button>` : ''}
          ${canBlock && !isMe ? `<button class="btn btn--sm" data-action="toggle-block" data-id="${e.id}" data-blocked="${e.isBlocked}">${e.isBlocked ? 'Разблокировать' : 'Заблокировать'}</button>` : ''}
          ${canDelete && !isMe ? `<button class="btn btn--sm btn--danger-ghost" data-action="delete-employee" data-id="${e.id}">Удалить</button>` : ''}
        </div>
      </div>
    `;
  }).join('') || '<div class="empty-state">Сотрудников нет</div>';

  return `
    <div class="page-header">
      <h1>Сотрудники</h1>
      ${can('employees', 'create') ? '<button class="btn btn--primary" data-action="new-employee"><i class="fa-solid fa-plus"></i> Добавить сотрудника</button>' : ''}
    </div>
    <div class="employee-list">${rows}</div>
  `;
}

export function attachEmployeesHandlers(root, rerender) {
  const newBtn = root.querySelector('[data-action="new-employee"]');
  if (newBtn) newBtn.addEventListener('click', () => openEmployeeModal(null, rerender));

  root.querySelectorAll('[data-action="edit-employee"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const emp = getState().employees.find((e) => e.id === btn.getAttribute('data-id'));
      if (emp) openEmployeeModal(emp, rerender);
    });
  });

  root.querySelectorAll('[data-action="toggle-block"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const nowBlocked = btn.getAttribute('data-blocked') !== 'true';
      btn.disabled = true;
      try {
        const updated = await api.blockEmployee(id, nowBlocked);
        replaceEmployeeInState(updated);
        rerender();
      } catch (e) {
        window.alert(e.message || 'Не удалось изменить статус сотрудника');
        btn.disabled = false;
      }
    });
  });

  root.querySelectorAll('[data-action="delete-employee"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!window.confirm('Удалить сотрудника?')) return;
      btn.disabled = true;
      try {
        await api.deleteEmployee(btn.getAttribute('data-id'));
        removeEmployeeFromState(btn.getAttribute('data-id'));
        rerender();
      } catch (e) {
        window.alert(e.message || 'Не удалось удалить сотрудника');
        btn.disabled = false;
      }
    });
  });
}

// ---- Permission matrix modal ----

function renderPermissionMatrix(permissions) {
  return Object.entries(MODULES).map(([mod, actions]) => `
    <div class="perm-module">
      <div class="perm-module__title">${MODULE_LABELS[mod]}</div>
      <div class="perm-module__actions">
        ${actions.map((a) => `
          <label class="checkbox-label perm-check">
            <input type="checkbox" data-perm-mod="${mod}" data-perm-action="${a}" ${permissions?.[mod]?.[a] ? 'checked' : ''} />
            ${ACTION_LABELS[a] || a}
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function renderFinancialSection(flags) {
  return FINANCIAL_FLAGS.map((f) => `
    <label class="checkbox-label">
      <input type="checkbox" data-fin-flag="${f}" ${flags?.[f] ? 'checked' : ''} /> ${FINANCIAL_FLAG_LABELS[f]}
    </label>
  `).join('');
}

function renderScopeSection(scope) {
  const all = scope?.allCompanyData !== false;
  return `
    <label class="checkbox-label">
      <input type="checkbox" id="scope-all" ${all ? 'checked' : ''} /> ${SCOPE_FLAG_LABELS.allCompanyData}
    </label>
    <div id="scope-own-fields" ${all ? 'hidden' : ''}>
      <label class="checkbox-label"><input type="checkbox" data-scope-flag="ownOrdersOnly" ${scope?.ownOrdersOnly ? 'checked' : ''} /> ${SCOPE_FLAG_LABELS.ownOrdersOnly}</label>
      <label class="checkbox-label"><input type="checkbox" data-scope-flag="ownRequestsOnly" ${scope?.ownRequestsOnly ? 'checked' : ''} /> ${SCOPE_FLAG_LABELS.ownRequestsOnly}</label>
      <label class="checkbox-label"><input type="checkbox" data-scope-flag="ownDepartmentOnly" ${scope?.ownDepartmentOnly ? 'checked' : ''} /> ${SCOPE_FLAG_LABELS.ownDepartmentOnly}</label>
    </div>
  `;
}

function attachScopeToggle(container) {
  const allEl = container.querySelector('#scope-all');
  const ownFields = container.querySelector('#scope-own-fields');
  if (!allEl || !ownFields) return;
  allEl.addEventListener('change', () => { ownFields.hidden = allEl.checked; });
}

function collectPermissions(form) {
  const perms = emptyPermissions();
  form.querySelectorAll('[data-perm-mod]').forEach((el) => {
    const mod = el.getAttribute('data-perm-mod');
    const action = el.getAttribute('data-perm-action');
    if (perms[mod]) perms[mod][action] = el.checked;
  });
  return perms;
}

function collectFinancialFlags(form) {
  const flags = {};
  form.querySelectorAll('[data-fin-flag]').forEach((el) => { flags[el.getAttribute('data-fin-flag')] = el.checked; });
  return flags;
}

function collectScopeFlags(form) {
  const allEl = form.querySelector('#scope-all');
  const all = allEl ? allEl.checked : true;
  const scope = { allCompanyData: all, ownOrdersOnly: false, ownRequestsOnly: false, ownDepartmentOnly: false };
  if (!all) {
    form.querySelectorAll('[data-scope-flag]').forEach((el) => { scope[el.getAttribute('data-scope-flag')] = el.checked; });
  }
  return scope;
}

async function openEmployeeModal(employee, rerender) {
  if (!rolePresets) {
    try { rolePresets = await api.getRolePresets(); } catch { rolePresets = {}; }
  }

  const permissions = employee?.permissions || emptyPermissions();
  const financialFlags = employee?.financialFlags || {};
  const scopeFlags = employee?.scopeFlags || { allCompanyData: true };
  const hasLoginAlready = !!employee?.email;

  openModal(employee ? 'Изменить сотрудника' : 'Новый сотрудник', `
    <form id="employee-form" class="form">
      <label>Имя<input name="name" required placeholder="Имя сотрудника" value="${employee ? escapeHtml(employee.name) : ''}" /></label>
      <label>Должность
        <select name="role">${EMPLOYEE_ROLES.map((r) => `<option ${employee?.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      </label>
      ${renderPhoneField({ name: 'phone', label: 'Контакты', value: employee ? employee.phone : '' })}
      <label>Email для входа <span class="form-hint">(необязательно)</span><input name="email" type="email" value="${employee ? escapeHtml(employee.email || '') : ''}" placeholder="employee@mebelflow.uz" /></label>
      <label>${employee ? 'Новый пароль' : 'Пароль'} <span class="form-hint">${employee ? '(оставьте пустым, чтобы не менять)' : '(необязательно, если вход не нужен)'}</span><input name="password" type="password" placeholder="••••••••" /></label>

      <div class="access-section" id="access-section" ${hasLoginAlready ? '' : 'hidden'}>
        <div class="order-detail__section-title">Роль доступа и разрешения</div>
        <label>Роль
          <select id="access-role-select">
            <option value="">— выберите роль —</option>
            ${Object.keys(rolePresets).map((r) => `<option value="${escapeHtml(r)}" ${employee?.accessRole === r ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}
            <option value="Индивидуальная" ${employee?.accessRole === 'Индивидуальная' ? 'selected' : ''}>Индивидуальная (настроить вручную)</option>
          </select>
        </label>
        <p class="form-hint">Выбор готовой роли заполнит разрешения ниже — их можно донастроить вручную.</p>
        <div class="perm-matrix" id="perm-matrix">${renderPermissionMatrix(permissions)}</div>
        <div class="order-detail__section-title">Финансовая видимость</div>
        <div class="fin-flags">${renderFinancialSection(financialFlags)}</div>
        <div class="order-detail__section-title">Область видимости</div>
        <div class="scope-flags" id="scope-flags">${renderScopeSection(scopeFlags)}</div>
      </div>

      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">${employee ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </form>
  `);

  const form = document.getElementById('employee-form');
  attachPhoneFields(form);
  attachScopeToggle(document.getElementById('scope-flags'));

  const emailInput = form.querySelector('[name="email"]');
  const accessSection = document.getElementById('access-section');
  emailInput.addEventListener('input', () => { accessSection.hidden = !emailInput.value; });

  const roleSelect = document.getElementById('access-role-select');
  roleSelect.addEventListener('change', () => {
    const preset = rolePresets[roleSelect.value];
    if (!preset) return;
    document.getElementById('perm-matrix').innerHTML = renderPermissionMatrix(preset.permissions);
    const finFlagsEl = form.querySelector('.fin-flags');
    finFlagsEl.innerHTML = renderFinancialSection(preset.financialFlags);
    const scopeFlagsEl = document.getElementById('scope-flags');
    scopeFlagsEl.innerHTML = renderScopeSection(preset.scopeFlags);
    attachScopeToggle(scopeFlagsEl);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const grantsLogin = !!fd.get('email');

    const payload = {
      name: fd.get('name'),
      role: fd.get('role'),
      phone: fd.get('phone'),
      email: fd.get('email') || null,
    };
    const password = fd.get('password');
    if (password) payload.password = password;

    if (grantsLogin) {
      const accessRole = roleSelect.value;
      if (!accessRole) {
        window.alert('Выберите роль доступа для сотрудника с email');
        return;
      }
      payload.accessRole = accessRole;
      payload.permissions = collectPermissions(form);
      payload.financialFlags = collectFinancialFlags(form);
      payload.scopeFlags = collectScopeFlags(form);
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const saved = employee
        ? await api.updateEmployee(employee.id, payload)
        : await api.createEmployee(payload);
      replaceEmployeeInState(saved);
      closeModal();
      rerender();
    } catch (err) {
      window.alert(err.message || 'Не удалось сохранить сотрудника');
      submitBtn.disabled = false;
    }
  });
}
