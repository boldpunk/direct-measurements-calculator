// Финансы → «Динамика»: revenue and profit by month (grouped bars, one money
// axis) and who owes the most, by client.
//
// Months bucket orders by startDate, like «Прибыль за месяц»; cancelled orders
// are left out. Series colours are the two first categorical slots, checked
// for colour-blind separation on both the light and the dark panel.
import { getState, computeOrderFinance } from '../store.js';
import { money, escapeHtml } from '../format.js';
import { sees } from '../permissions.js';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
let showTable = false;

function monthlySeries(count = 12) {
  const now = new Date();
  const months = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth(), revenue: 0, profit: 0, orders: 0 });
  }
  const index = new Map(months.map((x, i) => [`${x.y}-${x.m}`, i]));
  for (const o of getState().orders) {
    if (o.status === 'Отменён' || !o.startDate) continue;
    const d = new Date(o.startDate);
    const i = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (i === undefined) continue;
    months[i].revenue += Number(o.amount) || 0;
    months[i].profit += computeOrderFinance(o.id).profit;
    months[i].orders += 1;
  }
  return months;
}

function debtorsByClient() {
  const byClient = new Map();
  for (const o of getState().orders) {
    if (o.status === 'Отменён') continue;
    const left = computeOrderFinance(o.id).remainingAmount;
    if (!(left > 0)) continue;
    const key = o.clientId || o.clientName || o.id;
    const row = byClient.get(key) || { name: o.clientName || '—', phone: o.clientPhone || '', left: 0, orders: [] };
    row.left += left;
    row.orders.push(o.number);
    byClient.set(key, row);
  }
  return [...byClient.values()].sort((a, b) => b.left - a.left);
}

export function renderTrendsSection() {
  const seesRevenue = sees('seesFinanceAnalytics');
  const seesProfit = sees('seesProfit');
  if (!seesRevenue && !seesProfit) return '';
  const months = monthlySeries();
  const series = [
    ...(seesRevenue ? [{ key: 'revenue', label: 'Выручка', cls: 'viz-1' }] : []),
    ...(seesProfit ? [{ key: 'profit', label: 'Прибыль', cls: 'viz-2' }] : []),
  ];
  const last = months[months.length - 1];

  const table = `
    <div style="overflow-x:auto">
      <table class="data-table data-table--compact">
        <thead><tr><th>Месяц</th><th>Заказов</th>${series.map((s) => `<th>${s.label}</th>`).join('')}</tr></thead>
        <tbody>${[...months].reverse().map((x) => `
          <tr><td>${MONTHS_FULL[x.m]} ${x.y}</td><td>${x.orders}</td>${series.map((s) => `<td class="cell-nowrap ${s.key === 'profit' && x.profit < 0 ? 'text-neg' : ''}">${money(x[s.key])}</td>`).join('')}</tr>
        `).join('')}</tbody>
      </table>
    </div>`;

  const debtors = seesRevenue ? debtorsByClient() : [];
  const debtorRows = debtors.slice(0, 10).map((d) => `
    <div class="row-item" data-debtor="${escapeHtml(d.name)}">
      <div>
        <div class="row-item__title">${escapeHtml(d.name)}</div>
        <div class="row-item__sub">${d.orders.map((n) => `#${n}`).join(', ')}${d.phone ? ` · ${escapeHtml(d.phone)}` : ''}</div>
      </div>
      <b class="text-neg cell-nowrap">${money(d.left)}</b>
    </div>
  `).join('') || '<div class="empty-state">Должников нет</div>';
  const debtTotal = debtors.reduce((s, d) => s + d.left, 0);

  return `
    <div class="panel trends">
      <div class="trends__head">
        <div>
          <div class="order-detail__section-title" style="margin:0">По месяцам · последние 12</div>
          <div class="trends__legend">
            ${series.map((s) => `<span class="trends__key"><i class="trends__swatch ${s.cls}"></i>${s.label} <b>${money(last[s.key])}</b> в этом месяце</span>`).join('')}
          </div>
        </div>
        <button type="button" class="btn btn--sm" data-trends-table>${showTable ? '<i class="fa-solid fa-chart-column"></i> График' : '<i class="fa-solid fa-table"></i> Таблица'}</button>
      </div>
      ${showTable ? table : `<div class="trends__chart" data-trends-chart='${escapeHtml(JSON.stringify({ months, series }))}'></div>`}
    </div>
    ${seesRevenue ? `
      <div class="panel" style="margin-top:16px">
        <div class="trends__head">
          <div class="order-detail__section-title" style="margin:0">Должники</div>
          ${debtTotal ? `<span class="row-item__sub">Всего: <b class="text-neg">${money(debtTotal)}</b></span>` : ''}
        </div>
        <div class="row-list" style="padding:0 18px 14px">${debtorRows}</div>
      </div>
    ` : ''}
  `;
}

function compactMoney(v) {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млрд`;
  if (abs >= 1e6) return `${(v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`;
  if (abs >= 1e3) return `${(v / 1e3).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} тыс`;
  return v.toLocaleString('ru-RU');
}

// Rounded "nice" step for ~4 gridlines.
function niceStep(range) {
  const raw = range / 4 || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

// Bar with a 4px rounded data end; the baseline end stays square.
function barPath(x, w, y0, y1) {
  const r = Math.min(4, w / 2, Math.abs(y1 - y0));
  if (y1 < y0) {
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

function drawChart(el) {
  const { months, series } = JSON.parse(el.getAttribute('data-trends-chart'));
  const width = Math.max(300, el.clientWidth);
  const height = 240;
  const pad = { l: 56, r: 8, t: 10, b: 26 };
  const values = months.flatMap((m) => series.map((s) => m[s.key]));
  let max = Math.max(0, ...values);
  let min = Math.min(0, ...values);
  if (max === min) max = 1;
  const step = niceStep(max - min);
  max = Math.ceil(max / step) * step;
  min = Math.floor(min / step) * step;
  const y = (v) => pad.t + (max - v) * (height - pad.t - pad.b) / (max - min);
  const band = (width - pad.l - pad.r) / months.length;
  const gap = 2;
  const barW = Math.max(3, Math.min(22, (band * 0.7 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);

  let grid = '';
  for (let v = min; v <= max + step / 2; v += step) {
    grid += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'viz-zero' : 'viz-grid'}"/>`;
    grid += `<text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end" class="viz-tick">${compactMoney(v)}</text>`;
  }
  let bars = '';
  let labels = '';
  let hits = '';
  months.forEach((m, i) => {
    const x0 = pad.l + band * i + (band - groupW) / 2;
    series.forEach((s, j) => {
      const v = m[s.key];
      if (!v) return;
      bars += `<path class="${s.cls}" d="${barPath(x0 + j * (barW + gap), barW, y(0), y(v))}"/>`;
    });
    const showLabel = months.length <= 6 || i % 2 === (months.length - 1) % 2;
    if (showLabel) labels += `<text x="${pad.l + band * i + band / 2}" y="${height - 8}" text-anchor="middle" class="viz-tick">${MONTHS[m.m]}</text>`;
    hits += `<rect class="viz-hit" x="${pad.l + band * i}" y="${pad.t}" width="${band}" height="${height - pad.t - pad.b}" data-i="${i}" tabindex="0"/>`;
  });

  el.innerHTML = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Выручка и прибыль по месяцам">
      ${grid}${bars}${labels}${hits}
    </svg>
    <div class="viz-tooltip" hidden></div>`;

  const tip = el.querySelector('.viz-tooltip');
  const show = (rect) => {
    const m = months[Number(rect.getAttribute('data-i'))];
    el.querySelectorAll('.viz-hit').forEach((r) => r.classList.toggle('is-hover', r === rect));
    tip.replaceChildren();
    const title = document.createElement('div');
    title.className = 'viz-tooltip__title';
    title.textContent = `${MONTHS_FULL[m.m]} ${m.y} · заказов: ${m.orders}`;
    tip.appendChild(title);
    for (const s of series) {
      const row = document.createElement('div');
      row.className = 'viz-tooltip__row';
      const sw = document.createElement('i');
      sw.className = `trends__swatch ${s.cls}`;
      const val = document.createElement('b');
      val.textContent = money(m[s.key]);
      row.append(sw, val, document.createTextNode(` ${s.label}`));
      tip.appendChild(row);
    }
    tip.hidden = false;
    const bx = Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2;
    const left = Math.min(Math.max(bx - tip.offsetWidth / 2, 0), width - tip.offsetWidth);
    tip.style.left = `${left}px`;
  };
  const hide = () => {
    tip.hidden = true;
    el.querySelectorAll('.viz-hit').forEach((r) => r.classList.remove('is-hover'));
  };
  el.querySelectorAll('.viz-hit').forEach((rect) => {
    rect.addEventListener('pointerenter', () => show(rect));
    rect.addEventListener('focus', () => show(rect));
    rect.addEventListener('blur', hide);
  });
  el.querySelector('svg').addEventListener('pointerleave', hide);
}

let observer = null;
export function attachTrendsHandlers(root, rerender) {
  const toggle = root.querySelector('[data-trends-table]');
  if (toggle) toggle.addEventListener('click', () => { showTable = !showTable; rerender(); });
  root.querySelectorAll('[data-debtor]').forEach((row) => row.addEventListener('click', () => {
    window.location.hash = `#/orders?filter=unpaid&q=${encodeURIComponent(row.getAttribute('data-debtor'))}`;
  }));
  const chart = root.querySelector('[data-trends-chart]');
  observer?.disconnect();
  if (!chart) return;
  drawChart(chart);
  let lastWidth = chart.clientWidth;
  observer = new ResizeObserver(() => {
    if (!chart.isConnected) { observer.disconnect(); return; }
    if (Math.abs(chart.clientWidth - lastWidth) > 4) { lastWidth = chart.clientWidth; drawChart(chart); }
  });
  observer.observe(chart);
}
