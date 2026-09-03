import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { uid, todayISO, addDays } from '../src/util.js';
import { STAGE_DEFS, DEFAULT_SETTINGS } from '../src/constants.js';

const prisma = new PrismaClient();

const SEED_PASSWORD = 'mebelflow123';

async function pushActivity(orderId, text, timestamp = Date.now()) {
  await prisma.activity.create({ data: { id: uid('act'), orderId, timestamp, text } });
}

function fmtMoney(amount, currency) {
  return `${(Number(amount) || 0).toLocaleString('ru-RU')} ${currency}`;
}

async function addOrder(data, forcedNumber, bufferDays) {
  let client = null;
  if (data.clientPhone) {
    client = await prisma.client.findFirst({ where: { phone: data.clientPhone } });
  }
  if (!client) {
    client = await prisma.client.create({
      data: { id: uid('cli'), name: data.clientName || 'Без имени', phone: data.clientPhone || '', address: data.address || '', createdAt: Date.now() },
    });
  } else if (data.address && !client.address) {
    client = await prisma.client.update({ where: { id: client.id }, data: { address: data.address } });
  }

  const order = await prisma.order.create({
    data: {
      id: uid('ord'),
      number: forcedNumber,
      clientId: client.id,
      clientName: data.clientName || client.name || '',
      clientPhone: data.clientPhone || client.phone || '',
      address: data.address || client.address || '',
      productType: data.productType,
      managerId: data.managerId || null,
      amount: Number(data.amount) || 0,
      startDate: data.startDate || todayISO(),
      deadline: data.deadline || addDays(todayISO(), 14),
      status: data.status || 'Новый',
      needsCarpentry: data.needsCarpentry !== false,
      notes: data.notes || '',
      createdAt: Date.now(),
    },
  });

  await prisma.stage.createMany({
    data: STAGE_DEFS.map((def, i) => {
      const skip = def.key === 'carpentry' && !order.needsCarpentry;
      return {
        id: uid('stg'),
        orderId: order.id,
        defKey: def.key,
        name: def.name,
        type: def.type,
        service: def.service || null,
        position: i,
        deadline: addDays(order.startDate, (i + 1) * bufferDays),
        status: skip ? 'готово' : (i === 0 ? 'в работе' : 'ожидает'),
        skipped: skip,
      };
    }),
  });

  await pushActivity(order.id, 'Заказ создан');
  return order;
}

async function advanceTo(orderId, targetKey) {
  const stages = await prisma.stage.findMany({ where: { orderId }, orderBy: { position: 'asc' } });
  for (const st of stages) {
    if (st.skipped) continue;
    if (st.defKey === targetKey) {
      await prisma.stage.update({ where: { id: st.id }, data: { status: 'в работе' } });
      break;
    }
    await prisma.stage.update({ where: { id: st.id }, data: { status: 'готово' } });
  }
}

async function addTask(data) {
  let stageId = null;
  if (data.orderId && data.stageKey) {
    const stage = await prisma.stage.findFirst({ where: { orderId: data.orderId, defKey: data.stageKey } });
    stageId = stage ? stage.id : null;
  }
  return prisma.task.create({
    data: {
      id: uid('tsk'),
      orderId: data.orderId || null,
      stageId,
      stageKey: data.stageKey || null,
      name: data.name,
      qty: Number(data.qty) || 1,
      assigneeId: data.assigneeId || null,
      deadline: data.deadline || addDays(todayISO(), 3),
      status: data.status || 'ожидает',
      priority: data.priority || 'Средний',
      comment: data.comment || '',
      createdAt: Date.now(),
    },
  });
}

async function addRework(data) {
  const task = await addTask({
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
  return prisma.rework.create({
    data: {
      id: uid('rwk'),
      orderId: data.orderId,
      reason: data.reason,
      description: data.description,
      photoUrl: data.photoUrl || '',
      responsibleId: data.responsibleId || null,
      urgency: data.urgency || 'срочно',
      status: 'открыто',
      costImpact: Number(data.costImpact) || 0,
      taskId: task.id,
      createdAt: Date.now(),
    },
  });
}

async function addPayment(orderId, data, currency) {
  await prisma.payment.create({ data: { id: uid('pay'), orderId, date: data.date || todayISO(), comment: data.comment || '', amount: Number(data.amount) || 0 } });
  await pushActivity(orderId, `Добавлена оплата: ${fmtMoney(data.amount, currency)}`);
}
async function addMaterial(orderId, data) {
  await prisma.material.create({ data: { id: uid('mat'), orderId, name: data.name, qty: Number(data.qty) || 0, unit: data.unit || 'шт.', unitPrice: Number(data.unitPrice) || 0 } });
  await pushActivity(orderId, `Добавлен материал: ${data.name}`);
}
async function addOutsource(orderId, data) {
  await prisma.outsourceExpense.create({ data: { id: uid('out'), orderId, name: data.name, amount: Number(data.amount) || 0 } });
  await pushActivity(orderId, `Добавлен аутсорс: ${data.name}`);
}
async function addSalary(orderId, data) {
  await prisma.salaryExpense.create({ data: { id: uid('sal'), orderId, name: data.name, amount: Number(data.amount) || 0 } });
}
async function addOtherExpense(orderId, data) {
  await prisma.otherExpense.create({ data: { id: uid('exp'), orderId, name: data.name, amount: Number(data.amount) || 0 } });
}

async function main() {
  console.log('Clearing existing data...');
  await prisma.$transaction([
    prisma.rework.deleteMany(),
    prisma.activity.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.material.deleteMany(),
    prisma.outsourceExpense.deleteMany(),
    prisma.salaryExpense.deleteMany(),
    prisma.otherExpense.deleteMany(),
    prisma.task.deleteMany(),
    prisma.stage.deleteMany(),
    prisma.order.deleteMany(),
    prisma.client.deleteMany(),
    prisma.partner.deleteMany(),
    prisma.employee.deleteMany(),
    prisma.settings.deleteMany(),
  ]);

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const employees = [
    { id: 'emp_ivan', name: 'Иван', role: 'Старший ПМ', phone: '+998 90 123-45-67', email: 'ivan@mebelflow.uz' },
    { id: 'emp_akhmad', name: 'Ахмад', role: 'Столяр', phone: '+998 90 222-33-44', email: 'akhmad@mebelflow.uz' },
    { id: 'emp_alexey', name: 'Алексей', role: 'Сборщик', phone: '+998 90 333-44-55', email: 'alexey@mebelflow.uz' },
    { id: 'emp_anna', name: 'Анна', role: 'Бригадир', phone: '+998 90 444-55-66', email: 'anna@mebelflow.uz' },
    { id: 'emp_aimad', name: 'Аимад', role: 'Доставщик', phone: '+998 90 555-66-77', email: 'aimad@mebelflow.uz' },
    { id: 'emp_salim', name: 'Салим', role: 'Конструктор', phone: '+998 90 666-77-88', email: 'salim@mebelflow.uz' },
  ];
  for (const e of employees) {
    await prisma.employee.create({ data: { ...e, passwordHash, createdAt: Date.now() } });
  }

  await prisma.partner.createMany({
    data: [
      { id: uid('ptn'), name: 'ДСП-Раскрой Ташкент', services: ['распил', 'кромка'], contacts: '+998 71 200-10-10', avgLeadDays: 2, rating: 4, comment: 'Стабильно, иногда срывает сроки на кромке.' },
      { id: uid('ptn'), name: 'КрасПро', services: ['покраска'], contacts: '+998 71 300-20-20', avgLeadDays: 3, rating: 5, comment: 'Лучшее качество эмали в городе.' },
    ],
  });

  const settings = await prisma.settings.create({ data: { id: 'default', ...DEFAULT_SETTINGS, orderSeq: 106 } });
  const currency = settings.currency;
  const bufferDays = settings.stageBufferDays;

  const o1 = await addOrder({
    clientName: 'Иван Петров', clientPhone: '+998 90 111-22-33', address: 'г. Ташкент, ул. Мирзо-Улугбека, 12',
    productType: 'Кухня', amount: 5000, startDate: addDays(todayISO(), -20),
    deadline: addDays(todayISO(), 5), needsCarpentry: true, managerId: 'emp_ivan',
    status: 'Производство', notes: 'Фасады МДФ, ручки чёрные матовые.',
  }, 120, bufferDays);
  const o2 = await addOrder({
    clientName: 'Расул Каримов', clientPhone: '+998 90 222-33-44', address: 'г. Ташкент, массив Чиланзар, 45',
    productType: 'Шкаф', amount: 1800, startDate: addDays(todayISO(), -10),
    deadline: addDays(todayISO(), -1), needsCarpentry: false, managerId: 'emp_ivan',
    status: 'Установка',
  }, 118, bufferDays);
  const o3 = await addOrder({
    clientName: 'Флот Юсупов', clientPhone: '+998 90 333-44-55', address: 'г. Ташкент, массив Себзар, 8',
    productType: 'Кухня', amount: 4200, startDate: addDays(todayISO(), -15),
    deadline: addDays(todayISO(), -3), needsCarpentry: true, managerId: 'emp_ivan',
    status: 'Сборка', notes: 'Клиент просил ускорить — вторая просрочка подряд.',
  }, 115, bufferDays);
  const o4 = await addOrder({
    clientName: 'Дилноза Ахмедова', clientPhone: '+998 90 777-88-99', address: 'г. Ташкент, ул. Амира Темура, 100',
    productType: 'Гардеробная', amount: 3200, startDate: addDays(todayISO(), -4),
    deadline: addDays(todayISO(), 2), needsCarpentry: true, managerId: 'emp_ivan',
    status: 'Дизайн',
  }, 121, bufferDays);
  const o5 = await addOrder({
    clientName: 'Шерзод Рахимов', clientPhone: '+998 90 888-99-00', address: 'г. Ташкент, ул. Бунёдкор, 22',
    productType: 'Тумба', amount: 650, startDate: addDays(todayISO(), -6),
    deadline: addDays(todayISO(), 1), needsCarpentry: false, managerId: 'emp_ivan',
    status: 'Готов',
  }, 122, bufferDays);
  const o6 = await addOrder({
    clientName: 'Иван Петров', clientPhone: '+998 90 111-22-33',
    productType: 'Стол', amount: 900, startDate: addDays(todayISO(), -40),
    deadline: addDays(todayISO(), -25), needsCarpentry: false, managerId: 'emp_ivan',
    status: 'Завершён',
  }, 110, bufferDays);
  const o7 = await addOrder({
    clientName: 'Расул Каримов', clientPhone: '+998 90 222-33-44',
    productType: 'Комод', amount: 500, startDate: addDays(todayISO(), -12),
    deadline: addDays(todayISO(), -5), needsCarpentry: false, managerId: 'emp_ivan',
    status: 'Отменён', notes: 'Клиент отказался — передумал по бюджету.',
  }, 108, bufferDays);

  await advanceTo(o1.id, 'carpentry');
  await advanceTo(o2.id, 'handover');
  await advanceTo(o3.id, 'assembly');
  await advanceTo(o4.id, 'design');

  await addTask({ orderId: o1.id, stageKey: 'carpentry', name: 'Фасады МДФ 12 шт', qty: 12, assigneeId: 'emp_akhmad', deadline: addDays(todayISO(), 2), priority: 'Высокий', status: 'в работе', comment: 'Чертёж уточнить у конструктора перед распилом.' });
  await addTask({ orderId: o1.id, stageKey: 'drilling', name: 'Присадка корпусов', qty: 8, assigneeId: 'emp_ivan', deadline: addDays(todayISO(), 1), priority: 'Средний', status: 'готово' });
  await addTask({ orderId: o3.id, stageKey: 'carpentry', name: 'Каркас нижних шкафов', qty: 6, assigneeId: 'emp_akhmad', deadline: addDays(todayISO(), -1), priority: 'Высокий', status: 'ожидает' });

  await addPayment(o1.id, { date: addDays(todayISO(), -18), comment: 'Предоплата', amount: 2000 }, currency);
  await addPayment(o1.id, { date: addDays(todayISO(), -6), comment: 'Вторая оплата', amount: 400 }, currency);
  await addMaterial(o1.id, { name: 'ЛДСП Egger Белый', qty: 3, unit: 'лист', unitPrice: 80 });
  await addMaterial(o1.id, { name: 'Петли Blum', qty: 12, unit: 'шт.', unitPrice: 4 });
  await addOutsource(o1.id, { name: 'Распил', amount: 120 });
  await addSalary(o1.id, { name: 'Столяр', amount: 300 });
  await addSalary(o1.id, { name: 'Сборщик', amount: 150 });
  await addOtherExpense(o1.id, { name: 'Доставка материалов', amount: 40 });

  await addPayment(o2.id, { date: addDays(todayISO(), -9), comment: 'Предоплата', amount: 900 }, currency);
  await addMaterial(o2.id, { name: 'ЛДСП Egger Дуб Сонома', qty: 2, unit: 'лист', unitPrice: 85 });
  await addOutsource(o2.id, { name: 'Покраска', amount: 200 });
  await addSalary(o2.id, { name: 'Установщик', amount: 100 });

  await addPayment(o3.id, { date: addDays(todayISO(), -14), comment: 'Предоплата', amount: 2100 }, currency);
  await addMaterial(o3.id, { name: 'ЛДСП 18мм, лист', qty: 4, unit: 'лист', unitPrice: 90 });
  await addMaterial(o3.id, { name: 'Фурнитура (комплект)', qty: 1, unit: 'комплект', unitPrice: 125 });
  await addOutsource(o3.id, { name: 'Распил и кромка', amount: 250 });
  await addOutsource(o3.id, { name: 'Стекло', amount: 180 });
  await addSalary(o3.id, { name: 'Столяр', amount: 320 });
  await addOtherExpense(o3.id, { name: 'Подъём на этаж', amount: 30 });

  await addMaterial(o4.id, { name: 'ЛДСП белое', qty: 5, unit: 'лист', unitPrice: 78 });
  await addSalary(o4.id, { name: 'Дизайнер', amount: 50 });

  await addPayment(o5.id, { date: addDays(todayISO(), -5), comment: 'Предоплата', amount: 400 }, currency);
  await addPayment(o5.id, { date: addDays(todayISO(), -1), comment: 'Окончательный расчёт', amount: 250 }, currency);
  await addMaterial(o5.id, { name: 'ЛДСП остаток', qty: 1, unit: 'лист', unitPrice: 80 });
  await addSalary(o5.id, { name: 'Сборщик', amount: 60 });

  await addPayment(o6.id, { date: addDays(todayISO(), -38), comment: 'Полная оплата', amount: 900 }, currency);
  await addMaterial(o6.id, { name: 'Массив дуба', qty: 1, unit: 'м²', unitPrice: 220 });
  await addSalary(o6.id, { name: 'Столяр', amount: 150 });

  await addPayment(o7.id, { date: addDays(todayISO(), -11), comment: 'Предоплата', amount: 200 }, currency);

  await pushActivity(o1.id, `Статус изменён: Замер → ${o1.status}`);
  await pushActivity(o1.id, 'Добавлена оплата: ' + fmtMoney(400, currency));
  await pushActivity(o2.id, 'Заказ просрочен');
  await pushActivity(o3.id, `Статус изменён: Производство → ${o3.status}`);

  await addRework({
    orderId: o1.id, reason: 'замер', description: 'Фасад неправильный размер',
    responsibleId: 'emp_anna', urgency: 'срочно', costImpact: 220,
    photoUrl: 'https://images.unsplash.com/photo-1600585152220-90363fe7e115?w=400',
  });
  await addRework({
    orderId: o2.id, reason: 'сборка', description: 'Скол на боковине при сборке',
    responsibleId: 'emp_alexey', urgency: 'обычный', costImpact: 200,
  });

  const maxNumber = Math.max(106, o1.number, o2.number, o3.number, o4.number, o5.number, o6.number, o7.number);
  await prisma.settings.update({ where: { id: 'default' }, data: { orderSeq: maxNumber } });

  console.log('Seed complete.');
  console.log(`Login with any employee email + password "${SEED_PASSWORD}", e.g. ivan@mebelflow.uz`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
