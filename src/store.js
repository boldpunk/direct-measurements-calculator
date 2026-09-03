// MebelFlow data layer: entities, persistence, business logic.
// Client-side only — everything lives in localStorage under STORAGE_KEY.

const STORAGE_KEY = 'mebelflow_data_v1';

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
export const TASK_PRIORITIES = ['обычный', 'срочный', 'переделка'];
export const ORDER_STATUSES = ['лид', 'в продаже', 'в производстве', 'завершён'];
export const EMPLOYEE_ROLES = [
  'Основатель', 'Старший ПМ', 'Помощник ПМ', 'Конструктор',
  'Оператор', 'Столяр', 'Доставщик', 'Бригадир', 'Сборщик',
];
export const REWORK_REASONS = ['замер', 'производство', 'сборка'];
export const REWORK_STATUSES = ['открыто', 'в работе', 'готово'];
export const OUTSOURCE_SERVICES = ['распил', 'кромка', 'покраска'];

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

function seed() {
  const employees = [
    { id: 'emp_ivan', name: 'Иван', role: 'Старший ПМ', phone: '+998 90 123-45-67' },
    { id: 'emp_akhmad', name: 'Ахмад', role: 'Столяр', phone: '+998 90 222-33-44' },
    { id: 'emp_alexey', name: 'Алексей', role: 'Сборщик', phone: '+998 90 333-44-55' },
    { id: 'emp_anna', name: 'Анна', role: 'Бригадир', phone: '+998 90 444-55-66' },
    { id: 'emp_aimad', name: 'Аимад', role: 'Доставщик', phone: '+998 90 555-66-77' },
    { id: 'emp_salim', name: 'Салим', role: 'Конструктор', phone: '+998 90 666-77-88' },
  ];

  const partners = [
    { id: uid('ptn'), name: 'ДСП-Раскрой Ташкент', services: ['распил', 'кромка'], contacts: '+998 71 200-10-10', avgLeadDays: 2, rating: 4, comment: 'Стабильно, иногда срывает сроки на кромке.' },
    { id: uid('ptn'), name: 'КрасПро', services: ['покраска'], contacts: '+998 71 300-20-20', avgLeadDays: 3, rating: 5, comment: 'Лучшее качество эмали в городе.' },
  ];

  const state = {
    orders: [],
    stages: [],
    tasks: [],
    rework: [],
    partners,
    employees,
    finance: {}, // orderId -> { prepayment, costOutsource1, costOutsource2, materials, salaries }
    orderSeq: 114,
  };

  const s = createState(state);

  const o1 = addOrder(s, {
    clientName: 'Иван Петров', clientPhone: '+998 90 111-22-33',
    productType: 'Кухня', amount: 5000, startDate: addDays(todayISO(), -20),
    deadline: addDays(todayISO(), 5), needsCarpentry: true,
  }, 120);
  const o2 = addOrder(s, {
    clientName: 'Расул Каримов', clientPhone: '+998 90 222-33-44',
    productType: 'Шкаф', amount: 1800, startDate: addDays(todayISO(), -10),
    deadline: addDays(todayISO(), -1), needsCarpentry: false,
  }, 118);
  const o3 = addOrder(s, {
    clientName: 'Флот Юсупов', clientPhone: '+998 90 333-44-55',
    productType: 'Кухня', amount: 4200, startDate: addDays(todayISO(), -15),
    deadline: addDays(todayISO(), -3), needsCarpentry: true,
  }, 115);

  // Push orders further along their stage pipeline for a realistic demo.
  advanceTo(s, o1.id, 'carpentry');
  advanceTo(s, o2.id, 'cutting');
  advanceTo(s, o3.id, 'carpentry');

  addTask(s, {
    orderId: o1.id, stageKey: 'carpentry', name: 'Фасады МДФ 12 шт', qty: 12,
    assigneeId: 'emp_akhmad', deadline: addDays(todayISO(), 2), priority: 'срочный',
    status: 'в работе',
  });
  addTask(s, {
    orderId: o1.id, stageKey: 'drilling', name: 'Присадка корпусов', qty: 8,
    assigneeId: 'emp_ivan', deadline: addDays(todayISO(), 1), priority: 'обычный',
    status: 'готово',
  });
  addTask(s, {
    orderId: o3.id, stageKey: 'carpentry', name: 'Каркас нижних шкафов', qty: 6,
    assigneeId: 'emp_akhmad', deadline: addDays(todayISO(), -1), priority: 'срочный',
    status: 'ожидает',
  });

  s.state.finance[o1.id] = { prepayment: 2400, costOutsource1: 900, costOutsource2: 700, materials: 500, salaries: 900 };
  s.state.finance[o2.id] = { prepayment: 900, costOutsource1: 400, costOutsource2: 300, materials: 250, salaries: 300 };
  s.state.finance[o3.id] = { prepayment: 2100, costOutsource1: 700, costOutsource2: 500, materials: 400, salaries: 700 };

  addRework(s, {
    orderId: o1.id, reason: 'замер', description: 'Фасад неправильный размер',
    responsibleId: 'emp_anna', urgency: 'срочно', costImpact: 2200,
  });
  addRework(s, {
    orderId: o2.id, reason: 'сборка', description: 'Скол на боковине при сборке',
    responsibleId: 'emp_alexey', urgency: 'обычный', costImpact: 2000,
  });

  state.orderSeq = Math.max(state.orderSeq, ...state.orders.map((o) => o.number));

  return s.state;
}

function createState(state) {
  return { state };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to load MebelFlow data, reseeding.', e);
  }
  return seed();
}

let _state = load();

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
}

export function getState() {
  return _state;
}

export function resetDemoData() {
  _state = seed();
  save();
}

// ---- Orders & stages ----

function addOrder(s, data, forcedNumber) {
  const state = s.state;
  const number = forcedNumber ?? ++state.orderSeq;
  const order = {
    id: uid('ord'),
    number,
    clientName: data.clientName,
    clientPhone: data.clientPhone,
    productType: data.productType,
    amount: Number(data.amount) || 0,
    startDate: data.startDate || todayISO(),
    deadline: data.deadline || addDays(todayISO(), 14),
    status: 'в продаже',
    needsCarpentry: data.needsCarpentry !== false,
    createdAt: Date.now(),
  };
  state.orders.push(order);

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
      deadline: addDays(order.startDate, (i + 1) * 3),
      status: skip ? 'готово' : (i === 0 ? 'в работе' : 'ожидает'),
      skipped: skip,
    };
    state.stages.push(stage);
  });

  return order;
}

export function createOrder(data) {
  const order = addOrder({ state: _state }, data);
  save();
  return order;
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

function advanceTo(s, orderId, targetKey) {
  const stages = stagesOf(s.state, orderId);
  for (const st of stages) {
    if (st.skipped) continue;
    if (st.defKey === targetKey) {
      st.status = 'в работе';
      break;
    }
    st.status = 'готово';
  }
  syncOrderStatus(s.state, orderId);
}

export function completeStage(stageId) {
  const stage = _state.stages.find((st) => st.id === stageId);
  if (!stage) return;
  stage.status = 'готово';
  const stages = stagesOf(_state, stage.orderId);
  const next = stages.find((st) => !st.skipped && st.status === 'ожидает');
  if (next) next.status = 'в работе';
  syncOrderStatus(_state, stage.orderId);
  save();
}

export function setStageAssignment(stageId, { assigneeId, partnerId, deadline }) {
  const stage = _state.stages.find((st) => st.id === stageId);
  if (!stage) return;
  if (assigneeId !== undefined) stage.assigneeId = assigneeId || null;
  if (partnerId !== undefined) stage.partnerId = partnerId || null;
  if (deadline !== undefined) stage.deadline = deadline;
  save();
}

function syncOrderStatus(state, orderId) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return;
  const real = stagesOf(state, orderId).filter((st) => !st.skipped);
  if (real.every((st) => st.status === 'готово')) {
    order.status = 'завершён';
  } else if (real.slice(1).some((st) => st.status !== 'ожидает')) {
    order.status = 'в производстве';
  } else {
    order.status = 'в продаже';
  }
}

export function isOverdue(deadline, status) {
  if (status === 'готово') return false;
  return deadline < todayISO();
}

// ---- Production tasks ----

function addTask(s, data) {
  const state = s.state;
  const stage = state.stages.find((st) => st.orderId === data.orderId && st.defKey === data.stageKey);
  const task = {
    id: uid('tsk'),
    orderId: data.orderId,
    stageId: stage ? stage.id : null,
    stageKey: data.stageKey,
    name: data.name,
    qty: Number(data.qty) || 1,
    assigneeId: data.assigneeId || null,
    deadline: data.deadline || addDays(todayISO(), 3),
    status: data.status || 'ожидает',
    priority: data.priority || 'обычный',
    comment: data.comment || '',
    createdAt: Date.now(),
  };
  state.tasks.push(task);
  return task;
}

export function createTask(data) {
  const task = addTask({ state: _state }, data);
  save();
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
  save();
}

export function updateTask(taskId, patch) {
  const task = _state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  Object.assign(task, patch);
  save();
}

export function deleteTask(taskId) {
  _state.tasks = _state.tasks.filter((t) => t.id !== taskId);
  save();
}

// ---- Rework ----

function addRework(s, data) {
  const state = s.state;
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
  state.rework.push(rework);

  const task = addTask(s, {
    orderId: data.orderId,
    stageKey: 'carpentry',
    name: `Переделка: ${data.description}`,
    qty: 1,
    assigneeId: data.responsibleId,
    deadline: addDays(todayISO(), 2),
    priority: 'переделка',
    status: 'ожидает',
    comment: `Автоматически создано из переделки (${data.reason}).`,
  });
  rework.taskId = task.id;

  return rework;
}

export function createRework(data) {
  const rework = addRework({ state: _state }, data);
  save();
  return rework;
}

export function updateReworkStatus(reworkId, status) {
  const rw = _state.rework.find((r) => r.id === reworkId);
  if (!rw) return;
  rw.status = status;
  if (rw.taskId) {
    const task = _state.tasks.find((t) => t.id === rw.taskId);
    if (task && status === 'готово') task.status = 'готово';
  }
  save();
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
  save();
  return partner;
}

export function deletePartner(partnerId) {
  _state.partners = _state.partners.filter((p) => p.id !== partnerId);
  save();
}

// ---- Employees ----

export function createEmployee(data) {
  const employee = {
    id: uid('emp'),
    name: data.name,
    role: data.role,
    phone: data.phone || '',
  };
  _state.employees.push(employee);
  save();
  return employee;
}

export function deleteEmployee(employeeId) {
  _state.employees = _state.employees.filter((e) => e.id !== employeeId);
  save();
}

export function getEmployeeActiveTasks(employeeId) {
  return _state.tasks.filter((t) => t.assigneeId === employeeId && t.status !== 'готово');
}

// ---- Finance ----

export function getFinance(orderId) {
  return _state.finance[orderId] || { prepayment: 0, costOutsource1: 0, costOutsource2: 0, materials: 0, salaries: 0 };
}

export function setFinance(orderId, patch) {
  const current = getFinance(orderId);
  _state.finance[orderId] = { ...current, ...patch };
  save();
}

export function computeOrderProfit(orderId) {
  const order = _state.orders.find((o) => o.id === orderId);
  if (!order) return { profit: 0, remainder: 0, costTotal: 0 };
  const f = getFinance(orderId);
  const costTotal = (Number(f.costOutsource1) || 0) + (Number(f.costOutsource2) || 0) + (Number(f.materials) || 0) + (Number(f.salaries) || 0);
  const profit = order.amount - costTotal;
  const remainder = order.amount - (Number(f.prepayment) || 0);
  return { profit, remainder, costTotal };
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
  return orders.reduce((sum, o) => sum + computeOrderProfit(o.id).profit, 0);
}

// ---- Dashboard helpers ----

export function getOverdueOrders() {
  return _state.orders.filter((o) => {
    if (o.status === 'завершён') return false;
    const active = getActiveStage(o.id);
    return active && isOverdue(active.deadline, active.status);
  });
}

export function getInProgressOrders() {
  return _state.orders.filter((o) => o.status !== 'завершён' && o.status !== 'лид');
}

export function getCarpentryTasks() {
  return _state.tasks.filter((t) => t.stageKey === 'carpentry' || t.stageKey === 'drilling');
}

export { todayISO, addDays, uid };
