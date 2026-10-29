// Финансы → «Отчёты»: sales by manager and by product type, the КП funnel and
// lead times, for the period chosen above the tabs (server: /api/reports/summary).
import { api } from '../api.js';
import { money, escapeHtml } from '../format.js';
import { skeletonRows } from '../ui.js';

let data = null;
let loadedKey = null;
let error = '';

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const rangeKey = (range) => `${range?.from ? +range.from : ''}|${range?.to ? +range.to : ''}`;

function table(title, rows, { seesProfit }) {
  if (!rows.length) return '';
  const max = Math.max(...rows.map((r) => r.revenue), 1);
  return `
    <div class="panel report-block">
      <div class="trends__head"><div class="order-detail__section-title" style="margin:0">${title}</div></div>
      <div style="overflow-x:auto">
        <table class="data-table data-table--compact">
          <thead><tr><th></th><th>Заказов</th><th>Выручка</th><th>Средний чек</th><th>Оплачено</th>${seesProfit ? '<th>Прибыль</th>' : ''}</tr></thead>
          <tbody>${rows.map((r) => `
            <tr>
              <td><b>${escapeHtml(r.label)}</b><div class="report-bar"><i style="width:${Math.round((r.revenue / max) * 100)}%"></i></div></td>
              <td>${r.orders}</td>
              <td class="cell-nowrap">${money(r.revenue)}</td>
              <td class="cell-nowrap">${money(Math.round(r.avgCheck))}</td>
              <td class="cell-nowrap">${money(r.paid)}</td>
              ${seesProfit ? `<td class="cell-nowrap ${r.profit >= 0 ? 'text-pos' : 'text-neg'}">${money(r.profit)}</td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

export function renderReportsSection(range) {
  if (rangeKey(range) !== loadedKey) data = null;
  if (error) return `<div class="empty-state">${escapeHtml(error)}</div>`;
  if (!data) return `<div class="panel">${skeletonRows(5)}</div>`;
  const p = data.proposals;
  const lt = data.leadTime;
  const funnel = ['Черновик', 'Готово', 'Отправлено', 'Принято', 'Отклонено'].map((s) => `<div><span>${s}</span><b>${p.byStatus[s] || 0}</b></div>`).join('');
  return `
    <div class="report-kpis">
      <div class="panel report-kpi"><span>Заказов</span><b>${data.totals.orders}</b></div>
      <div class="panel report-kpi"><span>Средний чек</span><b>${money(data.totals.orders ? Math.round(data.totals.revenue / data.totals.orders) : 0)}</b></div>
      <div class="panel report-kpi"><span>Средний срок выполнения</span><b>${lt.avgDays == null ? '—' : `${Math.round(lt.avgDays)} дн.`}</b><small>по ${lt.closed} завершённым</small></div>
      <div class="panel report-kpi"><span>Сдано в срок</span><b>${pct(lt.onTimeRate)}</b></div>
    </div>
    ${table('По менеджерам', data.byManager, data)}
    ${table('По типам изделий', data.byType, data)}
    <div class="panel report-block">
      <div class="trends__head"><div class="order-detail__section-title" style="margin:0">Коммерческие предложения</div>
        <span class="row-item__sub">принято из рассмотренных: <b>${pct(p.acceptedRate)}</b></span></div>
      <div class="report-funnel">${funnel}</div>
      <p class="form-hint" style="margin:0 18px 16px">Всего КП за период: ${p.total}. «Принято из рассмотренных» = Принято / (Принято + Отклонено) — отмечайте статус КП, чтобы цифра была честной.</p>
    </div>`;
}

export function attachReportsHandlers(root, rerender, range) {
  const key = rangeKey(range);
  if (loadedKey === key && (data || error)) return;
  loadedKey = key;
  error = '';
  api.getReportSummary({ from: range?.from ? +range.from : '', to: range?.to ? +range.to : '' })
    .then((d) => { data = d; })
    .catch((e) => { error = e.message || 'Не удалось построить отчёт'; })
    .finally(() => { if (loadedKey === key) rerender(); });
}
