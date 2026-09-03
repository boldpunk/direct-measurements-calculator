// MebelFlow data layer: entities, persistence, business logic.
// Client-side only — everything lives in localStorage under STORAGE_KEY.

const STORAGE_KEY = 'mebelflow_data_v2';

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

function fmtMoneyOn(state, n) {
  const currency = state.settings?.currency || '$';
  return `${(Number(n) || 0).toLocaleString('ru-RU')} ${currency}`;
}

// ---- Seed data ----

function findOrCreateClientOn(state, { name, phone, address }) {
  if (phone) {
    const existing = state.clients.find((c) => c.phone === phone);
    if (existing) {
      if (address && !existing.address) existing.address = address;
      return existing;
    }
  }
  const client = { id: uid('cli'), name: name || 'Без имени', phone: phone || '', address: address || '', createdAt: Date.now() };
  state.clients.push(client);
  return client;
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
    clients: [],
    finance: {},
    orderSeq: 106,
    settings: { ...DEFAULT_SETTINGS },
  };

  const s = { state };

  const o1 = addOrder(s, {
    clientName: 'Иван Петров', clientPhone: '+998 90 111-22-33', address: 'г. Ташкент, ул. Мирзо-Улугбека, 12',
    productType: 'Кухня', amount: 5000, startDate: addDays(todayISO(), -20),
    deadline: addDays(todayISO(), 5), needsCarpentry: true, managerId: 'emp_ivan',
    status: 'Производство', notes: 'Фасады МДФ, ручки чёрные матовые.',
  }, 120);
  const o2 = addOrder(s, {
    clientName: 'Расул Каримов', clientPhone: '+998 90 222-33-44', address: 'г. Ташкент, массив Чиланзар, 45',
    productType: 'Шкаф', amount: 1800, startDate: addDays(todayISO(), -10),
    deadline: addDays(todayISO(), -1), needsCarpentry: false, managerId: 'emp_ivan',
    status: 'Установка',
  }, 118);
  const o3 = addOrder(s, {
    clientName: 'Флот Юсупов', clientPhone: '+998 90 333-44-55', address: 'г. Ташкент, массив Себзар, 8',
    productType: 'Кухня', amount: 4200, startDate: addDays(todayISO(), -15),
    deadline: addDays(todayISO(), -3), needsCarpentry: true, managerId: 'emp_ivan',
    status: 'Сборка', notes: 'Клиент просил ускорить — вторая просрочка подряд.',
  }, 115);
  const o4 = addOrder(s, {
    clientName: 'Дилноза Ахмедова', clientPhone: '+998 90 777-88-99', address: 'г. Ташкент, ул. Амира Темура, 100',
    productType: 'Гардеробная', amount: 3200, startDate: addDays(todayISO(), -4),
    deadline: addDays(todayISO(), 2), needsCarpentry: true, managerId: 'emp_ivan',
    status: 'Дизайн',
  }, 121);
  const o5 = addOrder(s, {
    clientName: 'Шерзод Рахимов', clientPhone: '+998 90 888-99-00', address: 'г. Ташкент, ул. Бунёдкор, 22',
    productType: 'Тумба', amount: 650, startDate: addDays(todayISO(), -6),
    deadline: addDays(todayISO(), 1), needsCarpentry: false, managerId: 'emp_ivan',
    status: 'Готов',
  }, 122);
  const o6 = addOrder(s, {
    clientName: 'Иван Петров', clientPhone: '+998 90 111-22-33',
    productType: 'Стол', amount: 900, startDate: addDays(todayISO(), -40),
    deadline: addDays(todayISO(), -25), needsCarpentry: false, managerId: 'emp_ivan',
    status: 'Завершён',
  }, 110);
  const o7 = addOrder(s, {
    clientName: 'Расул Каримов', clientPhone: '+998 90 222-33-44',
    productType: 'Комод', amount: 500, startDate: addDays(todayISO(), -12),
    deadline: addDays(todayISO(), -5), needsCarpentry: false, managerId: 'emp_ivan',
    status: 'Отменён', notes: 'Клиент отказался — передумал по бюджету.',
  }, 108);

  advanceTo(s, o1.id, 'carpentry');
  advanceTo(s, o2.id, 'handover');
  advanceTo(s, o3.id, 'assembly');
  advanceTo(s, o4.id, 'design');

  addTask(s, {
    orderId: o1.id, stageKey: 'carpentry', name: 'Фасады МДФ 12 шт', qty: 12,
    assigneeId: 'emp_akhmad', deadline: addDays(todayISO(), 2), priority: 'Высокий',
    status: 'в работе', comment: 'Чертёж уточнить у конструктора перед распилом.',
  });
  addTask(s, {
    orderId: o1.id, stageKey: 'drilling', name: 'Присадка корпусов', qty: 8,
    assigneeId: 'emp_ivan', deadline: addDays(todayISO(), 1), priority: 'Средний',
    status: 'готово',
  });
  addTask(s, {
    orderId: o3.id, stageKey: 'carpentry', name: 'Каркас нижних шкафов', qty: 6,
    assigneeId: 'emp_akhmad', deadline: addDays(todayISO(), -1), priority: 'Высокий',
    status: 'ожидает',
  });

  addPaymentOn(state, o1.id, { date: addDays(todayISO(), -18), comment: 'Предоплата', amount: 2000 });
  addPaymentOn(state, o1.id, { date: addDays(todayISO(), -6), comment: 'Вторая оплата', amount: 400 });
  addMaterialOn(state, o1.id, { name: 'ЛДСП Egger Белый', qty: 3, unit: 'лист', unitPrice: 80 });
  addMaterialOn(state, o1.id, { name: 'Петли Blum', qty: 12, unit: 'шт.', unitPrice: 4 });
  addOutsourceOn(state, o1.id, { name: 'Распил', amount: 120 });
  addSalaryOn(state, o1.id, { name: 'Столяр', amount: 300 });
  addSalaryOn(state, o1.id, { name: 'Сборщик', amount: 150 });
  addOtherExpenseOn(state, o1.id, { name: 'Доставка материалов', amount: 40 });

  addPaymentOn(state, o2.id, { date: addDays(todayISO(), -9), comment: 'Предоплата', amount: 900 });
  addMaterialOn(state, o2.id, { name: 'ЛДСП Egger Дуб Сонома', qty: 2, unit: 'лист', unitPrice: 85 });
  addOutsourceOn(state, o2.id, { name: 'Покраска', amount: 200 });
  addSalaryOn(state, o2.id, { name: 'Установщик', amount: 100 });

  addPaymentOn(state, o3.id, { date: addDays(todayISO(), -14), comment: 'Предоплата', amount: 2100 });
  addMaterialOn(state, o3.id, { name: 'ЛДСП 18мм, лист', qty: 4, unit: 'лист', unitPrice: 90 });
  addMaterialOn(state, o3.id, { name: 'Фурнитура (комплект)', qty: 1, unit: 'комплект', unitPrice: 125 });
  addOutsourceOn(state, o3.id, { name: 'Распил и кромка', amount: 250 });
  addOutsourceOn(state, o3.id, { name: 'Стекло', amount: 180 });
  addSalaryOn(state, o3.id, { name: 'Столяр', amount: 320 });
  addOtherExpenseOn(state, o3.id, { name: 'Подъём на этаж', amount: 30 });

  addMaterialOn(state, o4.id, { name: 'ЛДСП белое', qty: 5, unit: 'лист', unitPrice: 78 });
  addSalaryOn(state, o4.id, { name: 'Дизайнер', amount: 50 });

  addPaymentOn(state, o5.id, { date: addDays(todayISO(), -5), comment: 'Предоплата', amount: 400 });
  addPaymentOn(state, o5.id, { date: addDays(todayISO(), -1), comment: 'Окончательный расчёт', amount: 250 });
  addMaterialOn(state, o5.id, { name: 'ЛДСП остаток', qty: 1, unit: 'лист', unitPrice: 80 });
  addSalaryOn(state, o5.id, { name: 'Сборщик', amount: 60 });

  addPaymentOn(state, o6.id, { date: addDays(todayISO(), -38), comment: 'Полная оплата', amount: 900 });
  addMaterialOn(state, o6.id, { name: 'Массив дуба', qty: 1, unit: 'м²', unitPrice: 220 });
  addSalaryOn(state, o6.id, { name: 'Столяр', amount: 150 });

  addPaymentOn(state, o7.id, { date: addDays(todayISO(), -11), comment: 'Предоплата', amount: 200 });

  const orderLabel = (o) => `${o.productType} #${o.number}`;
  pushActivity(o1, `Статус изменён: Замер → ${o1.status}`);
  pushActivity(o1, 'Добавлена оплата: ' + fmtMoneyOn(state, 400));
  pushActivity(o2, 'Заказ просрочен');
  pushActivity(o3, `Статус изменён: Производство → ${o3.status}`);
  void orderLabel;

  addRework(s, {
    orderId: o1.id, reason: 'замер', description: 'Фасад неправильный размер',
    responsibleId: 'emp_anna', urgency: 'срочно', costImpact: 220,
    photoUrl: 'https://images.unsplash.com/photo-1600585152220-90363fe7e115?w=400',
  });
  addRework(s, {
    orderId: o2.id, reason: 'сборка', description: 'Скол на боковине при сборке',
    responsibleId: 'emp_alexey', urgency: 'обычный', costImpact: 200,
  });

  state.orderSeq = Math.max(state.orderSeq, ...state.orders.map((o) => o.number));

  return state;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
      parsed.clients = parsed.clients || [];
      return parsed;
    }
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

export function getSettings() {
  return _state.settings;
}

export function updateSettings(patch) {
  _state.settings = { ..._state.settings, ...patch };
  save();
}

// ---- Clients ----

export function getClients() {
  return _state.clients;
}

export function createClient(data) {
  const client = { id: uid('cli'), name: data.name, phone: data.phone || '', address: data.address || '', createdAt: Date.now() };
  _state.clients.push(client);
  save();
  return client;
}

export function updateClient(clientId, patch) {
  const client = _state.clients.find((c) => c.id === clientId);
  if (!client) return;
  if (patch.name !== undefined) client.name = patch.name;
  if (patch.phone !== undefined) client.phone = patch.phone;
  if (patch.address !== undefined) client.address = patch.address;
  save();
}

export function deleteClient(clientId) {
  if (_state.orders.some((o) => o.clientId === clientId)) return false;
  _state.clients = _state.clients.filter((c) => c.id !== clientId);
  save();
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

function addOrder(s, data, forcedNumber) {
  const state = s.state;
  const client = data.clientId
    ? state.clients.find((c) => c.id === data.clientId)
    : findOrCreateClientOn(state, { name: data.clientName, phone: data.clientPhone, address: data.address });

  const number = forcedNumber ?? ++state.orderSeq;
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
  state.orders.push(order);
  pushActivity(order, 'Заказ создан');

  const bufferDays = (state.settings || DEFAULT_SETTINGS).stageBufferDays;
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
    state.stages.push(stage);
  });

  return order;
}

export function createOrder(data) {
  const order = addOrder({ state: _state }, data);
  save();
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
  save();
}

export function updateOrderStatus(orderId, status) {
  const order = _state.orders.find((o) => o.id === orderId);
  if (!order) return;
  const from = order.status;
  if (from === status) return;
  order.status = status;
  pushActivity(order, `Статус изменён: ${from} → ${status}`);
  save();
}

export function deleteOrder(orderId) {
  _state.orders = _state.orders.filter((o) => o.id !== orderId);
  _state.stages = _state.stages.filter((st) => st.orderId !== orderId);
  _state.tasks = _state.tasks.filter((t) => t.orderId !== orderId);
  _state.rework = _state.rework.filter((r) => r.orderId !== orderId);
  delete _state.finance[orderId];
  save();
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
}

export function completeStage(stageId) {
  const stage = _state.stages.find((st) => st.id === stageId);
  if (!stage) return;
  stage.status = 'готово';
  const stages = stagesOf(_state, stage.orderId);
  const next = stages.find((st) => !st.skipped && st.status === 'ожидает');
  if (next) next.status = 'в работе';
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
    priority: data.priority || 'Средний',
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
    priority: 'Срочно',
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

function ensureFinanceOn(state, orderId) {
  if (!state.finance[orderId]) {
    state.finance[orderId] = { payments: [], materials: [], outsourcing: [], salaries: [], otherExpenses: [] };
  }
  return state.finance[orderId];
}

export function getFinance(orderId) {
  const f = ensureFinanceOn(_state, orderId);
  return f;
}

function addPaymentOn(state, orderId, data) {
  const f = ensureFinanceOn(state, orderId);
  f.payments.push({ id: uid('pay'), date: data.date || todayISO(), comment: data.comment || '', amount: Number(data.amount) || 0 });
  const order = state.orders.find((o) => o.id === orderId);
  if (order) pushActivity(order, `Добавлена оплата: ${fmtMoneyOn(state, data.amount)}`);
}
export function addPayment(orderId, data) { addPaymentOn(_state, orderId, data); save(); }
export function removePayment(orderId, id) {
  const f = ensureFinanceOn(_state, orderId);
  f.payments = f.payments.filter((p) => p.id !== id);
  save();
}

function addMaterialOn(state, orderId, data) {
  const f = ensureFinanceOn(state, orderId);
  f.materials.push({ id: uid('mat'), name: data.name, qty: Number(data.qty) || 0, unit: data.unit || 'шт.', unitPrice: Number(data.unitPrice) || 0 });
  const order = state.orders.find((o) => o.id === orderId);
  if (order) pushActivity(order, `Добавлен материал: ${data.name}`);
}
export function addMaterial(orderId, data) { addMaterialOn(_state, orderId, data); save(); }
export function removeMaterial(orderId, id) {
  const f = ensureFinanceOn(_state, orderId);
  f.materials = f.materials.filter((m) => m.id !== id);
  save();
}

function addOutsourceOn(state, orderId, data) {
  const f = ensureFinanceOn(state, orderId);
  f.outsourcing.push({ id: uid('out'), name: data.name, amount: Number(data.amount) || 0 });
  const order = state.orders.find((o) => o.id === orderId);
  if (order) pushActivity(order, `Добавлен аутсорс: ${data.name}`);
}
export function addOutsourceExpense(orderId, data) { addOutsourceOn(_state, orderId, data); save(); }
export function removeOutsourceExpense(orderId, id) {
  const f = ensureFinanceOn(_state, orderId);
  f.outsourcing = f.outsourcing.filter((o) => o.id !== id);
  save();
}

function addSalaryOn(state, orderId, data) {
  const f = ensureFinanceOn(state, orderId);
  f.salaries.push({ id: uid('sal'), name: data.name, amount: Number(data.amount) || 0 });
}
export function addSalaryExpense(orderId, data) { addSalaryOn(_state, orderId, data); save(); }
export function removeSalaryExpense(orderId, id) {
  const f = ensureFinanceOn(_state, orderId);
  f.salaries = f.salaries.filter((sa) => sa.id !== id);
  save();
}

function addOtherExpenseOn(state, orderId, data) {
  const f = ensureFinanceOn(state, orderId);
  f.otherExpenses.push({ id: uid('exp'), name: data.name, amount: Number(data.amount) || 0 });
}
export function addOtherExpense(orderId, data) { addOtherExpenseOn(_state, orderId, data); save(); }
export function removeOtherExpense(orderId, id) {
  const f = ensureFinanceOn(_state, orderId);
  f.otherExpenses = f.otherExpenses.filter((e) => e.id !== id);
  save();
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
