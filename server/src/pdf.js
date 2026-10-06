// Order calculation and report PDFs. Layout primitives (header with logo,
// footer with company details and page numbers, tables, total card) live in
// pdf-theme.js and are shared with every document except the commercial
// proposal, which has its own presentation layout.
import {
  createDoc, drawHeader, drawFooters, sectionTitle, drawInfoCards, drawTable,
  drawTotalCard, drawStatTiles, drawSignatures, loadImage, accentFor,
  fmtMoney, fmtDate, fmtPhone, MUTED, INK,
} from './pdf-theme.js';

const SUCCESS = '#16A34A';
const DANGER = '#DC2626';

function fmtQty(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString('ru-RU');
}

// Shared start of every document: fetch the logo (PDFKit draws synchronously,
// so images must be loaded first), open the doc, draw the header.
async function startDoc(res, { settings, title, number, date }) {
  const accent = accentFor(settings);
  const logo = await loadImage(settings?.logoUrl);
  const doc = createDoc(res, { title, settings });
  drawHeader(doc, { settings, logo, title, number, date, accent });
  return { doc, accent };
}

// ---- Расчёт заказа ----
//
// Goes to the client, so it ends with what the client actually needs: what
// the order costs, what has been paid and what is still owed. (It used to end
// at the materials subtotal, with no order total or balance at all.)
export async function renderOrderPdf(res, { order, materials, services, payments = [], stages, manufacturing, manager, settings }) {
  const currency = settings?.currency || '$';
  const orderLabel = `${order.productType ? `${order.productType} ` : ''}#${order.number}`;
  const { doc, accent } = await startDoc(res, {
    settings,
    title: 'Расчёт заказа',
    number: orderLabel,
    date: fmtDate(order.createdAt),
  });

  drawInfoCards(doc, [
    {
      label: 'Заказчик',
      title: order.clientName || '—',
      lines: [
        order.clientPhone && `Тел. ${fmtPhone(order.clientPhone)}`,
        order.address,
        order.productType && `Изделие: ${order.productType}`,
      ],
    },
    {
      label: 'Ответственный',
      title: manager?.name || '—',
      lines: [
        settings?.companyName,
        manager?.phone && `Тел. ${fmtPhone(manager.phone)}`,
        order.deadline && `Срок сдачи: ${fmtDate(order.deadline)}`,
      ],
    },
  ], { accent });

  // ---- Materials & services
  const items = [
    ...materials.map((m) => ({ sku: m.sku, name: m.name, qty: m.qty, unit: m.unit, unitPrice: m.unitPrice, weight: m.weight })),
    ...services.map((s) => ({ sku: '', name: s.name, qty: s.qty, unit: s.unit, unitPrice: s.unitPrice, weight: s.weight })),
  ];
  const itemsTotal = items.reduce((sum, r) => sum + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0);
  // Columns that would be blank on every row are left out rather than printed empty.
  const showSku = items.some((r) => r.sku);
  const showWeight = settings?.enableWeight !== false && items.some((r) => Number(r.weight) > 0);

  sectionTitle(doc, 'Материалы и услуги', { accent: MUTED });
  const columns = [
    { label: '№', width: 26 },
    ...(showSku ? [{ label: 'Артикул', width: 70 }] : []),
    { label: 'Наименование' },
    { label: 'Кол-во', width: 64, align: 'right' },
    ...(showWeight ? [{ label: 'Вес, кг', width: 52, align: 'right' }] : []),
    { label: 'Цена', width: 78, align: 'right' },
    { label: 'Сумма', width: 86, align: 'right' },
  ];
  const rows = items.map((r, i) => [
    { text: String(i + 1), color: MUTED },
    ...(showSku ? [{ text: r.sku || '', color: MUTED }] : []),
    r.name,
    `${fmtQty(r.qty)} ${r.unit || ''}`.trim(),
    ...(showWeight ? [r.weight ? fmtQty(r.weight) : ''] : []),
    { text: fmtMoney(r.unitPrice, currency), color: MUTED },
    { text: fmtMoney((Number(r.qty) || 0) * (Number(r.unitPrice) || 0), currency), bold: true },
  ]);
  const totalRow = columns.map((_, i) => (i === columns.length - 1 ? fmtMoney(itemsTotal, currency) : ''));
  totalRow[showSku ? 2 : 1] = 'Итого по позициям';
  drawTable(doc, {
    columns, rows, accent,
    total: items.length ? totalRow : null,
    emptyLabel: 'Материалы и услуги не добавлены',
  });

  // ---- Payments
  if (payments.length) {
    sectionTitle(doc, 'Оплаты', { accent: MUTED });
    drawTable(doc, {
      accent,
      columns: [
        { label: 'Дата', width: 90 },
        { label: 'Комментарий' },
        { label: 'Сумма', width: 110, align: 'right' },
      ],
      rows: payments.map((p) => [fmtDate(p.date), p.comment || '—', { text: fmtMoney(p.amount, currency), bold: true }]),
    });
  }

  // ---- What is owed
  const paid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const remaining = (Number(order.amount) || 0) - paid;
  drawTotalCard(doc, {
    accent,
    lines: [
      ['Стоимость заказа', fmtMoney(order.amount, currency)],
      ['Оплачено', fmtMoney(paid, currency)],
    ],
    totalLabel: remaining > 0 ? 'К оплате' : 'Оплачено полностью',
    totalValue: fmtMoney(Math.max(0, remaining), currency),
  });

  // ---- Schedule
  if (stages && stages.length) {
    sectionTitle(doc, 'График производства', { accent: MUTED });
    drawTable(doc, {
      accent,
      columns: [{ label: '№', width: 26 }, { label: 'Этап' }, { label: 'Срок', width: 110, align: 'right' }],
      rows: stages.map((st, i) => [{ text: String(i + 1), color: MUTED }, st.name, st.deadline ? fmtDate(st.deadline) : '—']),
    });
  }

  if (manufacturing && manufacturing.length) {
    sectionTitle(doc, 'Дата изготовления', { accent: MUTED });
    drawTable(doc, {
      accent,
      columns: [{ label: '№', width: 26 }, { label: 'Услуга' }, { label: 'Дата', width: 110, align: 'right' }],
      rows: manufacturing.map((m, i) => [{ text: String(i + 1), color: MUTED }, m.name, m.date ? fmtDate(m.date) : '—']),
    });
  }

  drawSignatures(doc, [
    'Подпись клиента',
    settings?.enablePdfExtras && manager?.name ? `Ответственный: ${manager.name}` : 'Ответственный',
  ]);

  drawFooters(doc, { settings, accent });
  doc.end();
}

// ---- Заявки на закупку ----
// A daily shopping list of manually-entered materials across every active
// order, aggregated by supplier + name + unit; one section per supplier.
export async function renderPurchaseListPdf(res, { rows, settings }) {
  const today = fmtDate(Date.now());
  const { doc, accent } = await startDoc(res, { settings, title: 'Заявка на закупку', date: today });

  const suppliers = [...new Set(rows.map((r) => r.supplier))];
  drawStatTiles(doc, [
    { label: 'Позиций', value: String(rows.length) },
    { label: 'Поставщиков', value: String(suppliers.length) },
  ], { accent });

  if (!rows.length) {
    drawTable(doc, {
      accent,
      columns: [{ label: 'Наименование' }, { label: 'Кол-во', width: 100, align: 'right' }],
      rows: [],
      emptyLabel: 'Нет материалов, ожидающих закупки',
    });
  }
  suppliers.forEach((supplier) => {
    const list = rows.filter((r) => r.supplier === supplier);
    sectionTitle(doc, supplier, { accent });
    drawTable(doc, {
      accent,
      columns: [
        { label: '№', width: 26 },
        { label: 'Наименование' },
        { label: 'Кол-во', width: 80, align: 'right' },
        { label: 'Ед.', width: 70 },
        { label: 'Куплено', width: 60, align: 'center' },
      ],
      // The last column is a box to tick off by hand in the shop.
      rows: list.map((r, i) => [{ text: String(i + 1), color: MUTED }, r.name, { text: fmtQty(r.qty), bold: true }, r.unit, { text: '□', color: MUTED }]),
    });
  });

  drawFooters(doc, { settings, accent });
  doc.end();
}

// ---- Отчёт по заработной плате ----
export async function renderSalaryAccrualReportPdf(res, { rows, settings }) {
  const currency = settings?.currency || '$';
  const { doc, accent } = await startDoc(res, { settings, title: 'Отчёт по зарплате', date: fmtDate(Date.now()) });

  const totalAccrued = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalPaid = rows.reduce((s, r) => s + (Number(r.paid) || 0), 0);
  const totalRemaining = rows.reduce((s, r) => s + (Number(r.remaining) || 0), 0);
  // Shown even when there's nothing yet, so an empty report still reads as a
  // report (all zeros) instead of a blank page with one grey line.
  drawStatTiles(doc, [
    { label: 'Начислено', value: fmtMoney(totalAccrued, currency) },
    { label: 'Выплачено', value: fmtMoney(totalPaid, currency), color: totalPaid > 0 ? SUCCESS : INK },
    { label: 'К выплате', value: fmtMoney(totalRemaining, currency), color: totalRemaining > 0 ? DANGER : INK },
    { label: 'Начислений', value: String(rows.length) },
  ], { accent });

  const statusColor = (st) => (st === 'Выплачено' ? SUCCESS : st === 'Не выплачено' ? DANGER : '#B45309');
  drawTable(doc, {
    accent,
    columns: [
      { label: '№', width: 26 },
      { label: 'Сотрудник' },
      { label: 'Начислено', width: 82, align: 'right' },
      { label: 'Выплачено', width: 82, align: 'right' },
      { label: 'К выплате', width: 82, align: 'right' },
      { label: 'Статус', width: 98 },
    ],
    rows: rows.map((r, i) => [
      { text: String(i + 1), color: MUTED },
      r.employeeName,
      fmtMoney(r.amount, currency),
      fmtMoney(r.paid, currency),
      { text: fmtMoney(r.remaining, currency), bold: true },
      { text: r.status, color: statusColor(r.status) },
    ]),
    total: rows.length ? ['', 'Итого', fmtMoney(totalAccrued, currency), fmtMoney(totalPaid, currency), fmtMoney(totalRemaining, currency), ''] : null,
    emptyLabel: 'Начислений пока нет',
  });

  drawFooters(doc, { settings, accent });
  doc.end();
}

// ---- Взаиморасчёты с партнёрами ----
// One currency per report: balances in different currencies are separate
// ledgers and are never added together.
export async function renderPartnerBalanceReportPdf(res, { rows, currency, settings, period }) {
  const { doc, accent } = await startDoc(res, {
    settings,
    title: 'Взаиморасчёты с партнёрами',
    number: period ? `Период: ${period}` : `Валюта: ${currency}`,
    date: fmtDate(Date.now()),
  });

  const owedToUs = rows.filter((r) => r.balance > 0).reduce((s, r) => s + r.balance, 0);
  const owedByUs = rows.filter((r) => r.balance < 0).reduce((s, r) => s + Math.abs(r.balance), 0);
  const net = owedToUs - owedByUs;
  const signed = (v) => `${v > 0 ? '+' : ''}${fmtMoney(v, currency)}`;

  drawStatTiles(doc, [
    { label: 'Нам должны', value: fmtMoney(owedToUs, currency), color: owedToUs > 0 ? SUCCESS : INK },
    { label: 'Мы должны', value: fmtMoney(owedByUs, currency), color: owedByUs > 0 ? DANGER : INK },
    { label: 'Чистый баланс', value: signed(net), color: net > 0 ? SUCCESS : net < 0 ? DANGER : INK },
    { label: 'Активные / закрытые', value: `${rows.filter((r) => r.balance !== 0).length} / ${rows.filter((r) => r.balance === 0).length}` },
  ], { accent });

  const statusColor = (st) => (st === 'Нам должны' ? SUCCESS : st === 'Мы должны' ? DANGER : MUTED);
  const totalDebit = rows.reduce((s, r) => s + (Number(r.debit) || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
  drawTable(doc, {
    accent,
    columns: [
      { label: '№', width: 26 },
      { label: 'Партнёр' },
      { label: 'Дебит', width: 88, align: 'right' },
      { label: 'Кредит', width: 88, align: 'right' },
      { label: 'Баланс', width: 96, align: 'right' },
      { label: 'Статус', width: 80 },
    ],
    rows: rows.map((r, i) => [
      { text: String(i + 1), color: MUTED },
      r.name,
      fmtMoney(r.debit, currency),
      fmtMoney(r.credit, currency),
      { text: signed(r.balance), bold: true, color: r.balance > 0 ? SUCCESS : r.balance < 0 ? DANGER : INK },
      { text: r.status, color: statusColor(r.status) },
    ]),
    total: rows.length ? ['', 'Итого', fmtMoney(totalDebit, currency), fmtMoney(totalCredit, currency), signed(net), ''] : null,
    emptyLabel: 'Операций нет',
  });

  drawFooters(doc, { settings, accent });
  doc.end();
}
