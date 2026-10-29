import { getState, computeOrderFinance, getOrderDeadlineInfo } from './store.js';
import { sees } from './permissions.js';
import { startOfDay, endOfDay, inPeriodRange } from './period-filter.js';

function daysRange(n) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - (n - 1));
  return { from: startOfDay(start), to: endOfDay(now) };
}
function monthsRange(n) {
  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - n);
  return { from: startOfDay(start), to: endOfDay(now) };
}
function yearsRange(n) {
  const now = new Date();
  const start = new Date(now);
  start.setFullYear(start.getFullYear() - n);
  return { from: startOfDay(start), to: endOfDay(now) };
}

const EXPORT_PERIODS = [
  { label: '1 день', range: () => daysRange(1) },
  { label: '3 дня', range: () => daysRange(3) },
  { label: '7 дней', range: () => daysRange(7) },
  { label: '1 месяц', range: () => monthsRange(1) },
  { label: '6 месяцев', range: () => monthsRange(6) },
  { label: '1 год', range: () => yearsRange(1) },
];

// Column set is fixed per export (depends only on the viewer's financial
// visibility flags, not on whether a given period has any orders), so the
// header row is always present even on an empty sheet.
const MONEY_COLUMNS = new Set(['Сумма', 'Получено', 'Остаток', 'Себестоимость', 'Прибыль']);
const COLUMN_WIDTHS = {
  '№ заказа': 22, 'Клиент': 22, 'Дата создания': 14, 'Сумма': 14, 'Получено': 14,
  'Остаток': 14, 'Себестоимость': 16, 'Прибыль': 14, 'Маржа, %': 10, 'Статус': 16, 'Срок': 20,
};

function columnKeys() {
  const keys = ['№ заказа', 'Клиент', 'Дата создания', 'Сумма', 'Получено', 'Остаток'];
  if (sees('seesCostPrice')) keys.push('Себестоимость');
  if (sees('seesProfit')) keys.push('Прибыль');
  if (sees('seesMargin')) keys.push('Маржа, %');
  keys.push('Статус', 'Срок');
  return keys;
}

function buildRow(order, keys) {
  const fin = computeOrderFinance(order.id);
  const deadlineInfo = getOrderDeadlineInfo(order);
  const values = {
    '№ заказа': `${order.productType} #${order.number}`,
    'Клиент': order.clientName,
    'Дата создания': new Date(order.createdAt).toLocaleDateString('ru-RU'),
    'Сумма': order.amount,
    'Получено': fin.receivedAmount,
    'Остаток': Math.max(0, fin.remainingAmount),
    'Себестоимость': fin.costPrice,
    'Прибыль': fin.profit,
    'Маржа, %': Number(fin.margin.toFixed(1)),
    'Статус': order.status,
    'Срок': deadlineInfo.text,
  };
  return keys.map((k) => values[k]);
}

function buildSheet(name, orders, keys) {
  const formats = {};
  keys.forEach((key, i) => {
    if (MONEY_COLUMNS.has(key)) formats[i] = '#,##0';
    else if (key === 'Маржа, %') formats[i] = '0.0"%"';
  });
  return {
    name,
    rows: [keys, ...orders.map((o) => buildRow(o, keys))],
    widths: keys.map((k) => COLUMN_WIDTHS[k] || 14),
    formats,
    autofilter: true,
  };
}

// Builds one workbook with a sheet per period (1 день / 3 дня / 7 дней /
// 1 месяц / 6 месяцев / 1 год), each listing orders created in that window,
// and triggers a browser download. Columns respect the viewer's financial
// visibility flags, same as the on-screen Финансы table.
export async function exportFinanceWorkbook() {
  const { downloadWorkbook } = await import('./xlsx-writer.js');
  const state = getState();
  const keys = columnKeys();
  const sheets = EXPORT_PERIODS.map((period) => {
    const range = period.range();
    return buildSheet(period.label, state.orders.filter((o) => inPeriodRange(o.createdAt, range)), keys);
  });
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadWorkbook(`Финансы_${dateStr}.xlsx`, sheets);
}

// One-sheet export of the currently filtered "Заработная плата" rows.
// `rows` is the same {entry, order, createdByName} shape salary.js builds.
export async function exportSalaryWorkbook(rows) {
  const { downloadWorkbook } = await import('./xlsx-writer.js');
  const canSeeAmount = sees('seesSalaries');
  const keys = ['Сотрудник', 'Заказ', 'Сумма', 'Дата начисления', 'Кто начислил'];
  const aoa = [keys, ...rows.map((r) => [
    r.entry.name,
    `#${r.order.number} — ${r.order.clientName}`,
    canSeeAmount ? r.entry.amount : '••••',
    r.entry.date || '',
    r.createdByName || '',
  ])];
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadWorkbook(`Зарплаты_${dateStr}.xlsx`, [{
    name: 'Зарплаты', rows: aoa, widths: [22, 28, 14, 16, 22], formats: canSeeAmount ? { 2: '#,##0' } : {}, autofilter: true,
  }]);
}
