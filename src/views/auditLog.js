import { api } from '../api.js';
import { getState } from '../store.js';
import { money, escapeHtml } from '../format.js';

let entries = [];
let loading = true;
let hasLoadedOnce = false;
let employeeFilter = '';
let entityFilter = '';

const ENTITY_LABELS = {
  order: 'заказ', client: 'клиента', task: 'задачу', rework: 'переделку',
  partner: 'партнёра', employee: 'сотрудника', settings: 'настройки',
  payments: 'оплату', materials: 'материал', outsourcing: 'аутсорс',
  salaries: 'зарплату', 'other-expenses': 'расход',
};

function findLabel(entityType, entityId) {
  const state = getState();
  if (entityType === 'order') {
    const o = state.orders.find((x) => x.id === entityId);
    return o ? `№${o.number}` : '';
  }
  if (entityType === 'client') {
    const c = state.clients.find((x) => x.id === entityId);
    return c ? `«${c.name}»` : '';
  }
  if (entityType === 'employee') {
    const e = state.employees.find((x) => x.id === entityId);
    return e ? `«${e.name}»` : '';
  }
  if (entityType === 'partner') {
    const p = state.partners.find((x) => x.id === entityId);
    return p ? `«${p.name}»` : '';
  }
  if (entityType === 'task') {
    const t = state.tasks.find((x) => x.id === entityId);
    return t ? `«${t.name}»` : '';
  }
  return '';
}

function fieldLabel(key) {
  return {
    amount: 'сумму', deadline: 'срок', status: 'статус', clientName: 'имя клиента',
    clientPhone: 'телефон клиента', address: 'адрес', productType: 'тип изделия',
    managerId: 'ответственного', notes: 'комментарий', name: 'имя', phone: 'телефон',
    role: 'должность', accessRole: 'роль доступа', priority: 'приоритет',
    companyName: 'название компании', currency: 'валюту', stageBufferDays: 'буфер этапов',
  }[key] || key;
}

function fmtValue(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('ru-RU');
  return String(v);
}

function describe(entry) {
  const who = escapeHtml(entry.employeeName || 'Кто-то');
  const label = findLabel(entry.entityType, entry.entityId);
  const entityWord = ENTITY_LABELS[entry.entityType] || entry.entityType;

  switch (entry.action) {
    case 'order.create':
      return `${who} создал заказ №${entry.newValue?.number ?? ''} (${escapeHtml(entry.newValue?.clientName || '')})`;
    case 'order.delete':
      return `${who} удалил заказ №${entry.oldValue?.number ?? ''}`;
    case 'order.status_change':
      return `${who} изменил статус заказа ${label} на «${escapeHtml(entry.newValue?.status || '')}»`;
    case 'order.update': {
      const fields = Object.keys(entry.newValue || {});
      if (fields.length === 1) {
        const f = fields[0];
        return `${who} изменил ${fieldLabel(f)} заказа ${label} с ${fmtValue(entry.oldValue?.[f])} на ${fmtValue(entry.newValue?.[f])}`;
      }
      return `${who} изменил заказ ${label} (${fields.map(fieldLabel).join(', ')})`;
    }
    case 'client.create':
      return `${who} создал клиента «${escapeHtml(entry.newValue?.name || '')}»`;
    case 'client.delete':
      return `${who} удалил клиента «${escapeHtml(entry.oldValue?.name || '')}»`;
    case 'client.update':
      return `${who} изменил клиента ${label}`;
    case 'payments.create':
      return `${who} добавил оплату ${money(entry.newValue?.amount)} по заказу ${label}`;
    case 'payments.delete':
      return `${who} удалил оплату ${money(entry.oldValue?.amount)} по заказу ${label}`;
    case 'materials.create':
      return `${who} добавил материал «${escapeHtml(entry.newValue?.name || '')}» по заказу ${label}`;
    case 'materials.delete':
      return `${who} удалил материал «${escapeHtml(entry.oldValue?.name || '')}» по заказу ${label}`;
    case 'outsourcing.create':
    case 'salaries.create':
    case 'other-expenses.create':
      return `${who} добавил расход «${escapeHtml(entry.newValue?.name || '')}» (${money(entry.newValue?.amount)}) по заказу ${label}`;
    case 'outsourcing.delete':
    case 'salaries.delete':
    case 'other-expenses.delete':
      return `${who} удалил расход «${escapeHtml(entry.oldValue?.name || '')}» по заказу ${label}`;
    case 'task.create':
      return `${who} создал задачу «${escapeHtml(entry.newValue?.name || '')}»`;
    case 'task.update':
      return `${who} изменил задачу ${label}`;
    case 'task.delete':
      return `${who} удалил задачу «${escapeHtml(entry.oldValue?.name || '')}»`;
    case 'rework.create':
      return `${who} создал переделку по заказу (${escapeHtml(entry.newValue?.description || '')})`;
    case 'rework.status_change':
      return `${who} изменил статус переделки на «${escapeHtml(entry.newValue?.status || '')}»`;
    case 'partner.create':
      return `${who} добавил партнёра «${escapeHtml(entry.newValue?.name || '')}»`;
    case 'partner.delete':
      return `${who} удалил партнёра «${escapeHtml(entry.oldValue?.name || '')}»`;
    case 'employee.create':
      return `${who} создал сотрудника «${escapeHtml(entry.newValue?.name || '')}» (роль: ${escapeHtml(entry.newValue?.accessRole || '—')})`;
    case 'employee.update':
      return `${who} изменил сотрудника ${label}`;
    case 'employee.block':
      return `${who} заблокировал сотрудника ${label}`;
    case 'employee.unblock':
      return `${who} разблокировал сотрудника ${label}`;
    case 'employee.delete':
      return `${who} удалил сотрудника «${escapeHtml(entry.oldValue?.name || '')}»`;
    case 'settings.update':
      return `${who} изменил настройки системы`;
    default:
      return `${who}: ${escapeHtml(entry.action)} — ${entityWord} ${label}`;
  }
}

function fmtDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function renderAuditLog() {
  const state = getState();
  const employeeOptions = state.employees.map((e) => `<option value="${e.id}" ${employeeFilter === e.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('');
  const entityOptions = Object.keys(ENTITY_LABELS).map((k) => `<option value="${k}" ${entityFilter === k ? 'selected' : ''}>${escapeHtml(ENTITY_LABELS[k])}</option>`).join('');

  const rows = loading
    ? '<div class="empty-state">Загрузка...</div>'
    : (entries.length
      ? entries.map((entry) => `
        <div class="audit-row">
          <div class="audit-row__text">${describe(entry)}</div>
          <div class="audit-row__meta">
            <span>${fmtDateTime(entry.timestamp)}</span>
            <span>${escapeHtml(entry.ip || '')}</span>
          </div>
        </div>
      `).join('')
      : '<div class="empty-state">Записей не найдено</div>');

  return `
    <div class="page-header">
      <h1>Журнал действий</h1>
    </div>
    <div class="orders-toolbar">
      <select id="audit-employee-filter">
        <option value="">Все сотрудники</option>
        ${employeeOptions}
      </select>
      <select id="audit-entity-filter">
        <option value="">Все разделы</option>
        ${entityOptions}
      </select>
    </div>
    <div class="panel">
      <div class="panel__body audit-log">${rows}</div>
    </div>
  `;
}

export function attachAuditLogHandlers(root, rerender) {
  async function load() {
    loading = true;
    rerender();
    try {
      entries = await api.getAuditLog({ employeeId: employeeFilter, entityType: entityFilter, limit: 200 });
    } catch (e) {
      console.error('Failed to load audit log', e);
      entries = [];
    }
    loading = false;
    rerender();
  }

  const empSelect = root.querySelector('#audit-employee-filter');
  const entitySelect = root.querySelector('#audit-entity-filter');
  if (empSelect) empSelect.addEventListener('change', () => { employeeFilter = empSelect.value; load(); });
  if (entitySelect) entitySelect.addEventListener('change', () => { entityFilter = entitySelect.value; load(); });

  if (!hasLoadedOnce) {
    hasLoadedOnce = true;
    load();
  }
}
