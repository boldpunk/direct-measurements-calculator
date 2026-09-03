// MebelFlow data layer: entities, in-memory cache, business logic.
// State is hydrated once from the backend (see /server) via initStore(), then
// every getter below reads that in-memory cache synchronously — exactly like
// the old localStorage-backed version did. Mutators update the cache
// immediately (so the UI stays instant) and persist to the server in the
// background; a failed persist is logged to the console.
//
// Note: order numbers and any client/task records implicitly created as a
// side effect of another action (e.g. a new client from an order, or the
// task auto-created for a rework) are computed independently on the client
// and on the server. Within a session this is invisible — the local cache is
// self-consistent — and any drift resolves itself on the next reload when
// initStore() re-hydrates from the server, which is the source of truth.

import { api } from './api.js';

export const STAGE_DEFS = [
  { key: 'sale', name: 'Продажа', type: 'internal' },
  { key: 'measure', name: 'Замер', type: 'internal' },
  { key: 'design', name: 'Проектирование', type: 'internal' },
  { key: 'check', name: 'Проверка', type: 'internal' },
  { key: 'cutting', name: 'Аутсорс (распил/кромка)', type: 'outsource', service: 'распил' },
  { key: 'delivery', name: 'Доставка', type: 'internal' },
  { key: 'drilling', name: 'Присадка', type: 'internal' },
  { key: 'carpentry', name: 'Столярка', type: 'internal' },
  { key: 'painting', name: 'Покраска', type: 'outsource', service: 'покраска' },
  { key: 'assembly', name: 'Сборка', type: 'internal' },
  { key: 'handover', name: 'Сдача', type: 'internal' },
];

export const TASK_STATUSES = ['ожидает', 'в работе', 'проверка', 'готово'];
export const TASK_PRIORITIES = ['Низкий', 'Средний', 'Высокий', 'Срочно'];
export const PRODUCT_TYPES = ['Кухня', 'Шкаф', 'Гардеробная', 'Тумба', 'Стол', 'Комод', 'Другое'];
export const UNITS = ['шт.', 'лист', 'м', 'м²', 'кг', 'комплект'];

export const ORDER_STATUSES = [
  'Новый', 'Замер', 'Дизайн', 'Согласование', 'Закупка материалов',
  'Производство', 'Сборка', 'Установка', 'Готов', 'Завершён', 'Отменён',
];
export const CLOSED_STATUSES = ['Завершён', 'Отменён'];
export const KANBAN_COLUMNS = [
  { status: 'Замер', label: 'Замер' },
  { status: 'Дизайн', label: 'Дизайн' },
  { status: 'Согласование', label: 'Согласование' },
  { status: 'Закупка материалов', label: 'Материалы' },
  { status: 'Производство', label: 'Производство' },
  { status: 'Сборка', label: 'Сборка' },
  { status: 'Установка', label: 'Установка' },
  { status: 'Готов', label: 'Готов' },
];
const ORDER_STATUS_TONE = {
  'Новый': 'neutral',
  'Замер': 'info',
  'Дизайн': 'info',
  'Согласование': 'info',
  'Закупка материалов': 'warning',
  'Производство': 'warning',
  'Сборка': 'warning',
  'Установка': 'warning',
  'Готов': 'success',
  'Завершён': 'success',
  'Отменён': 'danger',
};
export function getOrderStatusTone(status) {
  return ORDER_STATUS_TONE[status] || 'neutral';
}

export const EMPLOYEE_ROLES = [
  'Основатель', 'Старший ПМ', 'Помощник ПМ', 'Конструктор',
  'Оператор', 'Столяр', 'Доставщик', 'Бригадир', 'Сборщик',
];
export const REWORK_REASONS = ['замер', 'производство', 'сборка'];
export const REWORK_STATUSES = ['открыто', 'в работе', 'готово'];
export const OUTSOURCE_SERVICES = ['распил', 'кромка', 'покраска'];
export const CURRENCIES = ['$', '€', '₽', "so'm"];

export const DEFAULT_SETTINGS = {
  companyName: 'Sobirov Mebel',
  currency: '$',
  stageBufferDays: 3,
};

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function ruDays(n) {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}

export function getOrderDeadlineInfo(order) {
  if (CLOSED_STATUSES.includes(order.status)) {
    return { text: order.status, tone: 'muted' };
  }
  const diffDays = Math.round((new Date(order.deadline) - new Date(todayISO())) / 86400000);
  if (diffDays < 0) return { text: `Просрочен на ${Math.abs(diffDays)} ${ruDays(diffDays)}`, tone: 'danger' };
  if (diffDays === 0) return { text: 'Сегодня', tone: 'warning' };
  if (diffDays <= 2) return { text: `Осталось ${diffDays} ${ruDays(diffDays)}`, tone: 'warning' };
  return { text: `Осталось ${diffDays} ${ruDays(diffDays)}`, tone: 'neutral' };
}

function pushActivity(order, text) {
  if (!order.activity) order.activity = [];
  order.activity.unshift({ id: uid('act'), timestamp: Date.now(), text });
  if (order.activity.length > 50) order.activity.length = 50;
}

function fmtMoney(n) {
  const currency = _state.settings?.currency || '$';
  return `${(Number(n) || 0).toLocaleString('ru-RU')} ${currency}`;
}

function logSyncError(action, err) {
  console.error(`MebelFlow: не удалось синхронизировать «${action}» с сервером`, err);
}

function findOrCreateClientLocal({ clientId, clientName, clientPhone, address }) {
  if (clientId) {
    const existing = _state.clients.find((c) => c.id === clientId);
    if (existing) return existing;
  }
  if (clientPhone) {
    const existing = _state.clients.find((c) => c.phone === clientPhone);
    if (existing) {
      if (address && !existing.address) existing.address = address;
      return existing;
    }
  }
  const client = { id: uid('cli'), name: clientName || 'Без имени', phone: clientPhone || '', address: address || '', createdAt: Date.now() };
  _state.clients.push(client);
  return client;
}

// ---- Hydration ----

let _state = null;

export function isHydrated() {
  return _state !== null;
}

export async function initStore() {
  _state = await api.getState();
}

export function resetStore() {
  _state = null;
}

export function getState() {
  return _state;
}

export function getSettings() {
  return _state.settings;
}

export function updateSettings(patch) {
  _state.settings = { ..._state.settings, ...patch };
  api.updateSettings(patch).catch((e) => logSyncError('настройки', e));
}

// ---- Clients ----

export function getClients() {
  return _state.clients;
}

export function createClient(data) {
  const client = { id: uid('cli'), name: data.name, phone: data.phone || '', address: data.address || '', createdAt: Date.now() };
  _state.clients.push(client);
  api.createClient(client).catch((e) => logSyncError('клиент', e));
  return client;
}

export function updateClient(clientId, patch) {
  const client = _state.clients.find((c) => c.id === clientId);
  if (!client) return;
  if (patch.name !== undefined) client.name = patch.name;
  if (patch.phone !== undefined) client.phone = patch.phone;
  if (patch.address !== undefined) client.address = patch.address;
  api.updateClient(clientId, patch).catch((e) => logSyncError('клиент', e));
}

export function deleteClient(clientId) {
  if (_state.orders.some((o) => o.clientId === clientId)) return false;
  _state.clients = _state.clients.filter((c) => c.id !== clientId);
  api.deleteClient(clientId).catch((e) => logSyncError('удаление клиента', e));
  return true;
}

export function getClientOrders(clientId) {
  return _state.orders.filter((o) => o.clientId === clientId);
}

export function getClientStats(clientId) {
  const orders = getClientOrders(clientId);
  const totalAmount = orders.reduce((sum, o) => sum + o.amount, 0);
  const debt = orders.reduce((sum, o) => sum + Math.max(0, computeOrderFinance(o.id).remainingAmount), 0);
  return { orderCount: orders.length, totalAmount, debt };
}

// ---- Orders & stages ----

export function createOrder(data) {
  const client = data.clientId
    ? _state.clients.find((c) => c.id === data.clientId)
    : findOrCreateClientLocal(data);

  const number = ++_state.orderSeq;
  const order = {
    id: uid('ord'),
    number,
    clientId: client ? client.id : null,
    clientName: data.clientName || client?.name || '',
    clientPhone: data.clientPhone || client?.phone || '',
    address: data.address || client?.address || '',
    productType: data.productType,
    managerId: data.managerId || null,
    amount: Number(data.amount) || 0,
    startDate: data.startDate || todayISO(),
    deadline: data.deadline || addDays(todayISO(), 14),
    status: data.status || 'Новый',
    needsCarpentry: data.needsCarpentry !== false,
    notes: data.notes || '',
    activity: [],
    createdAt: Date.now(),
  };
  _state.orders.push(order);
  pushActivity(order, 'Заказ создан');

  const bufferDays = (_state.settings || DEFAULT_SETTINGS).stageBufferDays;
  STAGE_DEFS.forEach((def, i) => {
    const skip = def.key === 'carpentry' && !order.needsCarpentry;
    const stage = {
      id: uid('stg'),
      orderId: order.id,
      defKey: def.key,
      name: def.name,
      type: def.type,
      service: def.service || null,
      order: i,
      assigneeId: null,
      partnerId: null,
      deadline: addDays(order.startDate, (i + 1) * bufferDays),
      status: skip ? 'готово' : (i === 0 ? 'в работе' : 'ожидает'),
      skipped: skip,
    };
    _state.stages.push(stage);
  });

  api.createOrder({ ...data, id: order.id }).catch((e) => logSyncError('заказ', e));
  return order;
}

export function updateOrder(orderId, patch) {
  const order = _state.orders.find((o) => o.id === orderId);
  if (!order) return;
  if (patch.clientName !== undefined) order.clientName = patch.clientName;
  if (patch.clientPhone !== undefined) order.clientPhone = patch.clientPhone;
  if (patch.address !== undefined) order.address = patch.address;
  if (patch.productType !== undefined) order.productType = patch.productType;
  if (patch.amount !== undefined) order.amount = Number(patch.amount) || 0;
  if (patch.deadline !== undefined) order.deadline = patch.deadline;
  if (patch.managerId !== undefined) order.managerId = patch.managerId || null;
  if (patch.notes !== undefined) order.notes = patch.notes;

  const client = _state.clients.find((c) => c.id === order.clientId);
  if (client) {
    if (patch.clientName !== undefined) client.name = patch.clientName;
    if (patch.clientPhone !== undefined) client.phone = patch.clientPhone;
    if (patch.address !== undefined && !client.address) client.address = patch.address;
  }
  api.updateOrder(orderId, patch).catch((e) => logSyncError('заказ', e));
}

export function updateOrderStatus(orderId, status) {
  const order = _state.orders.find((o) => o.id === orderId);
  if (!order) return;
  const from = order.status;
  if (from === status) return;
  order.status = status;
  pushActivity(order, `Статус изменён: ${from} → ${status}`);
  api.updateOrderStatus(orderId, status).catch((e) => logSyncError('статус заказа', e));
}

export function deleteOrder(orderId) {
  _state.orders = _state.orders.filter((o) => o.id !== orderId);
  _state.stages = _state.stages.filter((st) => st.orderId !== orderId);
  _state.tasks = _state.tasks.filter((t) => t.orderId !== orderId);
  _state.rework = _state.rework.filter((r) => r.orderId !== orderId);
  delete _state.finance[orderId];
  api.deleteOrder(orderId).catch((e) => logSyncError('удаление заказа', e));
}

function stagesOf(state, orderId) {
  return state.stages
    .filter((st) => st.orderId === orderId)
    .sort((a, b) => a.order - b.order);
}

export function getOrderStages(orderId) {
  return stagesOf(_state, orderId);
}

export function getActiveStage(orderId) {
  return getOrderStages(orderId).find((st) => !st.skipped && st.status !== 'готово');
}

export function completeStage(stageId) {
  const stage = _state.stages.find((st) => st.id === stageId);
  if (!stage) return;
  stage.status = 'готово';
  const stages = stagesOf(_state, stage.orderId);
  const next = stages.find((st) => !st.skipped && st.status === 'ожидает');
  if (next) next.status = 'в работе';
  api.completeStage(stage.orderId, stageId).catch((e) => logSyncError('этап', e));
}

export function setStageAssignment(stageId, { assigneeId, partnerId, deadline }) {
  const stage = _state.stages.find((st) => st.id === stageId);
  if (!stage) return;
  if (assigneeId !== undefined) stage.assigneeId = assigneeId || null;
  if (partnerId !== undefined) stage.partnerId = partnerId || null;
  if (deadline !== undefined) stage.deadline = deadline;
  api.setStageAssignment(stage.orderId, stageId, { assigneeId, partnerId, deadline }).catch((e) => logSyncError('этап', e));
}

export function isOverdue(deadline, status) {
  if (status === 'готово') return false;
  return deadline < todayISO();
}

export function isOrderActive(order) {
  return !CLOSED_STATUSES.includes(order.status);
}

export function isOrderOverdue(order) {
  return isOrderActive(order) && order.deadline < todayISO();
}

// ---- Production tasks ----

export function createTask(data) {
  const stage = _state.stages.find((st) => st.orderId === data.orderId && st.defKey === data.stageKey);
  const task = {
    id: uid('tsk'),
    orderId: data.orderId || null,
    stageId: stage ? stage.id : null,
    stageKey: data.stageKey,
    name: data.name,
    qty: Number(data.qty) || 1,
    assigneeId: data.assigneeId || null,
    deadline: data.deadline || addDays(todayISO(), 3),
    status: data.status || 'ожидает',
    priority: data.priority || 'Средний',
    comment: data.comment || '',
    createdAt: Date.now(),
  };
  _state.tasks.push(task);
  api.createTask({ ...data, id: task.id }).catch((e) => logSyncError('задача', e));
  return task;
}

export function updateTaskStatus(taskId, status) {
  const task = _state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.status = status;
  if (status === 'готово') {
    const rw = _state.rework.find((r) => r.taskId === taskId);
    if (rw) rw.status = 'готово';
  }
  api.updateTask(taskId, { status }).catch((e) => logSyncError('задача', e));
}

export function updateTask(taskId, patch) {
  const task = _state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  Object.assign(task, patch);
  api.updateTask(taskId, patch).catch((e) => logSyncError('задача', e));
}

export function deleteTask(taskId) {
  _state.tasks = _state.tasks.filter((t) => t.id !== taskId);
  api.deleteTask(taskId).catch((e) => logSyncError('удаление задачи', e));
}

// ---- Rework ----

export function createRework(data) {
  const rework = {
    id: uid('rwk'),
    orderId: data.orderId,
    reason: data.reason,
    description: data.description,
    photoUrl: data.photoUrl || '',
    responsibleId: data.responsibleId || null,
    urgency: data.urgency || 'срочно',
    status: 'открыто',
    costImpact: Number(data.costImpact) || 0,
    createdAt: Date.now(),
  };
  _state.rework.push(rework);

  const task = createTaskLocalOnly({
    orderId: data.orderId,
    stageKey: 'carpentry',
    name: `Переделка: ${data.description}`,
    qty: 1,
    assigneeId: data.responsibleId,
    deadline: addDays(todayISO(), 2),
    priority: 'Срочно',
    status: 'ожидает',
    comment: `Автоматически создано из переделки (${data.reason}).`,
  });
  rework.taskId = task.id;

  api.createRework({ ...data, id: rework.id }).catch((e) => logSyncError('переделка', e));
  return rework;
}

function createTaskLocalOnly(data) {
  const stage = _state.stages.find((st) => st.orderId === data.orderId && st.defKey === data.stageKey);
  const task = {
    id: uid('tsk'),
    orderId: data.orderId || null,
    stageId: stage ? stage.id : null,
    stageKey: data.stageKey,
    name: data.name,
    qty: Number(data.qty) || 1,
    assigneeId: data.assigneeId || null,
    deadline: data.deadline || addDays(todayISO(), 3),
    status: data.status || 'ожидает',
    priority: data.priority || 'Средний',
    comment: data.comment || '',
    createdAt: Date.now(),
  };
  _state.tasks.push(task);
  return task;
}

export function updateReworkStatus(reworkId, status) {
  const rw = _state.rework.find((r) => r.id === reworkId);
  if (!rw) return;
  rw.status = status;
  if (rw.taskId) {
    const task = _state.tasks.find((t) => t.id === rw.taskId);
    if (task && status === 'готово') task.status = 'готово';
  }
  api.updateReworkStatus(reworkId, status).catch((e) => logSyncError('переделка', e));
}

// ---- Outsource partners ----

export function createPartner(data) {
  const partner = {
    id: uid('ptn'),
    name: data.name,
    services: data.services || [],
    contacts: data.contacts || '',
    avgLeadDays: Number(data.avgLeadDays) || 0,
    rating: Number(data.rating) || 0,
    comment: data.comment || '',
  };
  _state.partners.push(partner);
  api.createPartner({ ...data, id: partner.id }).catch((e) => logSyncError('партнёр', e));
  return partner;
}

export function deletePartner(partnerId) {
  _state.partners = _state.partners.filter((p) => p.id !== partnerId);
  api.deletePartner(partnerId).catch((e) => logSyncError('удаление партнёра', e));
}

// ---- Employees ----

export function createEmployee(data) {
  const employee = {
    id: uid('emp'),
    name: data.name,
    role: data.role,
    phone: data.phone || '',
    email: data.email || null,
  };
  _state.employees.push(employee);
  api.createEmployee({ ...data, id: employee.id }).catch((e) => logSyncError('сотрудник', e));
  return employee;
}

export function deleteEmployee(employeeId) {
  _state.employees = _state.employees.filter((e) => e.id !== employeeId);
  api.deleteEmployee(employeeId).catch((e) => logSyncError('удаление сотрудника', e));
}

export function getEmployeeActiveTasks(employeeId) {
  return _state.tasks.filter((t) => t.assigneeId === employeeId && t.status !== 'готово');
}

// ---- Finance ----

function ensureFinance(orderId) {
  if (!_state.finance[orderId]) {
    _state.finance[orderId] = { payments: [], materials: [], outsourcing: [], salaries: [], otherExpenses: [] };
  }
  return _state.finance[orderId];
}

export function getFinance(orderId) {
  return ensureFinance(orderId);
}

export function addPayment(orderId, data) {
  const f = ensureFinance(orderId);
  const record = { id: uid('pay'), date: data.date || todayISO(), comment: data.comment || '', amount: Number(data.amount) || 0 };
  f.payments.push(record);
  const order = _state.orders.find((o) => o.id === orderId);
  if (order) pushActivity(order, `Добавлена оплата: ${fmtMoney(data.amount)}`);
  api.addPayment(orderId, { ...data, id: record.id }).catch((e) => logSyncError('оплата', e));
}
export function removePayment(orderId, id) {
  const f = ensureFinance(orderId);
  f.payments = f.payments.filter((p) => p.id !== id);
  api.removePayment(orderId, id).catch((e) => logSyncError('удаление оплаты', e));
}

export function addMaterial(orderId, data) {
  const f = ensureFinance(orderId);
  const record = { id: uid('mat'), name: data.name, qty: Number(data.qty) || 0, unit: data.unit || 'шт.', unitPrice: Number(data.unitPrice) || 0 };
  f.materials.push(record);
  const order = _state.orders.find((o) => o.id === orderId);
  if (order) pushActivity(order, `Добавлен материал: ${data.name}`);
  api.addMaterial(orderId, { ...data, id: record.id }).catch((e) => logSyncError('материал', e));
}
export function removeMaterial(orderId, id) {
  const f = ensureFinance(orderId);
  f.materials = f.materials.filter((m) => m.id !== id);
  api.removeMaterial(orderId, id).catch((e) => logSyncError('удаление материала', e));
}

export function addOutsourceExpense(orderId, data) {
  const f = ensureFinance(orderId);
  const record = { id: uid('out'), name: data.name, amount: Number(data.amount) || 0 };
  f.outsourcing.push(record);
  const order = _state.orders.find((o) => o.id === orderId);
  if (order) pushActivity(order, `Добавлен аутсорс: ${data.name}`);
  api.addOutsourceExpense(orderId, { ...data, id: record.id }).catch((e) => logSyncError('аутсорс', e));
}
export function removeOutsourceExpense(orderId, id) {
  const f = ensureFinance(orderId);
  f.outsourcing = f.outsourcing.filter((o) => o.id !== id);
  api.removeOutsourceExpense(orderId, id).catch((e) => logSyncError('удаление аутсорса', e));
}

export function addSalaryExpense(orderId, data) {
  const f = ensureFinance(orderId);
  const record = { id: uid('sal'), name: data.name, amount: Number(data.amount) || 0 };
  f.salaries.push(record);
  api.addSalaryExpense(orderId, { ...data, id: record.id }).catch((e) => logSyncError('зарплата', e));
}
export function removeSalaryExpense(orderId, id) {
  const f = ensureFinance(orderId);
  f.salaries = f.salaries.filter((sa) => sa.id !== id);
  api.removeSalaryExpense(orderId, id).catch((e) => logSyncError('удаление зарплаты', e));
}

export function addOtherExpense(orderId, data) {
  const f = ensureFinance(orderId);
  const record = { id: uid('exp'), name: data.name, amount: Number(data.amount) || 0 };
  f.otherExpenses.push(record);
  api.addOtherExpense(orderId, { ...data, id: record.id }).catch((e) => logSyncError('расход', e));
}
export function removeOtherExpense(orderId, id) {
  const f = ensureFinance(orderId);
  f.otherExpenses = f.otherExpenses.filter((e) => e.id !== id);
  api.removeOtherExpense(orderId, id).catch((e) => logSyncError('удаление расхода', e));
}

export function computeOrderFinance(orderId) {
  const order = _state.orders.find((o) => o.id === orderId);
  const f = getFinance(orderId);
  const materialsTotal = f.materials.reduce((sum, m) => sum + (Number(m.qty) || 0) * (Number(m.unitPrice) || 0), 0);
  const outsourcingTotal = f.outsourcing.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
  const salaryTotal = f.salaries.reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
  const otherExpensesTotal = f.otherExpenses.reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
  const costPrice = materialsTotal + outsourcingTotal + salaryTotal + otherExpensesTotal;
  const orderTotal = order ? order.amount : 0;
  const profit = orderTotal - costPrice;
  const margin = orderTotal > 0 ? (profit / orderTotal) * 100 : 0;
  const receivedAmount = f.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const remainingAmount = orderTotal - receivedAmount;
  return { materialsTotal, outsourcingTotal, salaryTotal, otherExpensesTotal, costPrice, profit, margin, receivedAmount, remainingAmount, orderTotal };
}

export function computeMonthlyProfit(monthOffset = 0) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const y = target.getFullYear();
  const m = target.getMonth();
  const orders = _state.orders.filter((o) => {
    const d = new Date(o.startDate);
    return d.getFullYear() === y && d.getMonth() === m;
  });
  return orders.reduce((sum, o) => sum + computeOrderFinance(o.id).profit, 0);
}

// ---- Dashboard / list helpers ----

export function getOverdueOrders() {
  return _state.orders.filter((o) => isOrderOverdue(o));
}

export function getInProgressOrders() {
  return _state.orders.filter((o) => isOrderActive(o));
}

export function getUnpaidOrders() {
  return _state.orders.filter((o) => isOrderActive(o) && computeOrderFinance(o.id).remainingAmount > 0);
}

export function getUpcomingDeadlines(days = 7) {
  const today = todayISO();
  const limit = addDays(today, days);
  return _state.orders
    .filter((o) => isOrderActive(o) && o.deadline >= today && o.deadline <= limit)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
}

export function getOrdersByStatusCounts() {
  const counts = {};
  ORDER_STATUSES.forEach((st) => { counts[st] = 0; });
  _state.orders.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
  return counts;
}

export function getCarpentryTasks() {
  return _state.tasks.filter((t) => t.stageKey === 'carpentry' || t.stageKey === 'drilling');
}

export { todayISO, addDays, uid };
