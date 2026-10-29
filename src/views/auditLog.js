import { skeletonRows } from '../ui.js';
import { api } from '../api.js';
import { getState } from '../store.js';
import { money, escapeHtml } from '../format.js';

let entries = [];
let loading = true;
let hasLoadedOnce = false;
let employeeFilter = '';
let entityFilter = '';
// «Действия» (the audit trail) or «Ошибки» (AppError, see server/src/app-errors.js).
let tab = 'actions';
let appErrors = null;

const ENTITY_LABELS = {
  order: 'заказ', client: 'клиента', task: 'задачу', rework: 'переделку',
  partner: 'партнёра', employee: 'сотрудника', settings: 'настройки',
  payments: 'оплату', materials: 'материал', outsourcing: 'аутсорс',
  salaries: 'зарплату', 'other-expenses': 'расход',
  partnerBalanceTransaction: 'операцию взаиморасчёта',
  auth: 'входы в систему',
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
    case 'order.archive':
      return `${who} отправил в архив заказ №${entry.oldValue?.number ?? ''}`;
    case 'order.restore':
      return `${who} восстановил из архива заказ №${entry.newValue?.number ?? ''}`;
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
    case 'partnerBalance.create': {
      const v = entry.newValue || {};
      const kind = v.type === 'CREDIT' ? 'кредит' : 'дебит';
      return `${who} добавил ${kind} ${money(v.amount, v.currency)} партнёру «${escapeHtml(v.partnerName || '')}» (баланс: ${money(v.balanceAfter, v.currency)})`;
    }
    case 'partnerBalance.reverse': {
      const o = entry.oldValue || {};
      const v = entry.newValue || {};
      return `${who} сторнировал операцию ${money(o.amount, o.currency)} партнёра «${escapeHtml(o.partnerName || '')}» (баланс: ${money(v.balanceAfter, v.currency)})`;
    }
    case 'partnerBalance.update':
      return `${who} изменил комментарий операции взаиморасчёта`;
    case 'settings.update':
      return `${who} изменил настройки системы`;
    case 'auth.login':
      return `Вход в систему: ${who}${device(entry)}`;
    case 'auth.login_failed':
      return entry.employeeName
        ? `<span class="text-neg">Неверный пароль</span> при входе: ${who}${device(entry)}`
        : `<span class="text-neg">Попытка входа с неизвестным email</span> «${escapeHtml(entry.newValue?.email || '')}»${device(entry)}`;
    case 'auth.locked':
      return `<span class="text-neg">Блокировка на 15 минут</span> после 5 неверных паролей: ${who}${device(entry)}`;
    case 'auth.password_change':
      return `Смена пароля: ${who} — остальные устройства вышли из системы`;
    default:
      return `${who}: ${escapeHtml(entry.action)} — ${entityWord} ${label}`;
  }
}

// "· Android, Chrome" from the user agent — enough to spot an unfamiliar device.
function device(entry) {
  const ua = entry.userAgent || '';
  if (!ua) return '';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /YaBrowser/.test(ua) ? 'Яндекс' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  const label = [os, browser].filter(Boolean).join(', ');
  return label ? ` <span class="row-item__sub">· ${escapeHtml(label)}</span>` : '';
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
    ? skeletonRows(6)
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

  const tabs = `
    <div class="tabs" role="tablist">
      <button type="button" class="tabs__tab ${tab === 'actions' ? 'is-active' : ''}" data-audit-tab="actions"><i class="fa-solid fa-clock-rotate-left"></i><span>Действия</span></button>
      <button type="button" class="tabs__tab ${tab === 'errors' ? 'is-active' : ''}" data-audit-tab="errors"><i class="fa-solid fa-bug"></i><span>Ошибки${appErrors?.length ? ` · ${appErrors.length}` : ''}</span></button>
    </div>`;

  if (tab === 'errors') {
    return `
      <div class="page-header"><h1>Журнал действий</h1></div>
      ${tabs}
      <p class="form-hint" style="margin:0 0 10px">Ошибки из браузеров и приложения сотрудников и с сервера. Одинаковые собраны в одну строку со счётчиком; новая ошибка приходит и в Telegram, если подключён бот утренней сводки.</p>
      <div class="panel"><div class="panel__body audit-log">${renderErrors()}</div></div>
    `;
  }

  return `
    <div class="page-header">
      <h1>Журнал действий</h1>
    </div>
    ${tabs}
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

function renderErrors() {
  if (!appErrors) return skeletonRows(4);
  if (!appErrors.length) return '<div class="empty-state">Ошибок нет 👍</div>';
  return appErrors.map((e) => `
    <div class="audit-row app-error">
      <div class="audit-row__text">
        <span class="badge ${e.source === 'server' ? 'badge--urgent' : 'badge--muted'}">${e.source === 'server' ? 'сервер' : 'приложение'}</span>
        <b>${escapeHtml(e.message)}</b>
        ${e.count > 1 ? `<span class="row-item__sub">× ${e.count}</span>` : ''}
        <div class="row-item__sub">${e.employeeName ? `${escapeHtml(e.employeeName)} · ` : ''}${escapeHtml(e.url || '')}${device(e)}</div>
        ${e.stack ? `<details><summary class="row-item__sub">Подробности</summary><pre class="app-error__stack">${escapeHtml(e.stack)}</pre></details>` : ''}
      </div>
      <div class="audit-row__meta">
        <span>${fmtDateTime(e.lastAt)}</span>
        <button type="button" class="btn btn--sm" data-resolve-error="${e.id}"><i class="fa-solid fa-check"></i> Исправлено</button>
      </div>
    </div>
  `).join('');
}

export function attachAuditLogHandlers(root, rerender) {
  async function loadErrors() {
    try { appErrors = await api.getAppErrors(); } catch { appErrors = []; }
    rerender();
  }
  root.querySelectorAll('[data-audit-tab]').forEach((btn) => btn.addEventListener('click', () => {
    tab = btn.getAttribute('data-audit-tab');
    if (tab === 'errors') { appErrors = null; loadErrors(); }
    rerender();
  }));
  root.querySelectorAll('[data-resolve-error]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    await api.resolveAppError(btn.getAttribute('data-resolve-error')).catch(() => {});
    appErrors = appErrors.filter((e) => e.id !== btn.getAttribute('data-resolve-error'));
    rerender();
  }));
  if (appErrors === null && tab === 'actions') api.getAppErrors().then((list) => { appErrors = list; rerender(); }).catch(() => {});

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
