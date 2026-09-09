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

function buildRow(order) {
  const fin = computeOrderFinance(order.id);
  const deadlineInfo = getOrderDeadlineInfo(order);
  const entries = [
    ['№ заказа', `${order.productType} #${order.number}`],
    ['Клиент', order.clientName],
    ['Дата создания', new Date(order.createdAt).toLocaleDateString('ru-RU')],
    ['Сумма', order.amount],
    ['Получено', fin.receivedAmount],
    ['Остаток', Math.max(0, fin.remainingAmount)],
  ];
  if (sees('seesCostPrice')) entries.push(['Себестоимость', fin.costPrice]);
  if (sees('seesProfit')) entries.push(['Прибыль', fin.profit]);
  if (sees('seesMargin')) entries.push(['Маржа, %', Number(fin.margin.toFixed(1))]);
  entries.push(['Статус', order.status], ['Срок', deadlineInfo.text]);
  return Object.fromEntries(entries);
}

// Builds one workbook with a sheet per period (1 день / 3 дня / 7 дней /
// 1 месяц / 6 месяцев / 1 год), each listing orders created in that window,
// and triggers a browser download. Columns respect the viewer's financial
// visibility flags, same as the on-screen Финансы table.
export async function exportFinanceWorkbook() {
  const XLSX = await import('xlsx');
  const state = getState();
  const wb = XLSX.utils.book_new();
  EXPORT_PERIODS.forEach((period) => {
    const range = period.range();
    const orders = state.orders.filter((o) => inPeriodRange(o.createdAt, range));
    const rows = orders.length
      ? orders.map(buildRow)
      : [{ 'Информация': 'Заказов за этот период нет' }];
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, period.label);
  });
  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Финансы_${dateStr}.xlsx`);
}
