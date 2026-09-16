// "Аутсорс" report embedded in the Финансы page: total outsourcing spend for
// the period, broken down by partner (directory partners and one-off
// "сторонние партнёры" together) and by order, plus the same completed-order
// count + total-paid stats shown on the Партнёры page — mirrors
// services-report.js's Услуги report.

import { getState, getFinance, getPartnerStats } from '../store.js';
import { money, escapeHtml } from '../format.js';
import { can, maskUnless } from '../permissions.js';

function computeOutsourceReport(periodOrders) {
  const byPartner = new Map();
  const byOrder = [];
  let total = 0;

  for (const order of periodOrders) {
    const entries = getFinance(order.id).outsourcing;
    if (!entries.length) continue;
    const orderTotal = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    total += orderTotal;
    byOrder.push({ order, total: orderTotal, count: entries.length });

    for (const e of entries) {
      const key = e.name || 'Без названия';
      const row = byPartner.get(key) || { name: key, total: 0, count: 0, adhoc: !e.partnerId };
      row.total += Number(e.amount) || 0;
      row.count += 1;
      byPartner.set(key, row);
    }
  }

  return {
    total,
    byPartner: [...byPartner.values()].sort((a, b) => b.total - a.total),
    byOrder: byOrder.sort((a, b) => b.total - a.total),
  };
}

export function renderOutsourceReportSection(periodOrders) {
  if (!can('outsourcePayments', 'view')) return '';

  const report = computeOutsourceReport(periodOrders);
  const partners = getState().partners;

  const partnerRows = report.byPartner.map((r) => `
    <div class="mat-row">
      <span class="mat-row__name">${escapeHtml(r.name)}${r.adhoc ? ' <span class="badge badge--muted">разовый</span>' : ''}</span>
      <span class="mat-row__calc">${r.count} платеж.</span>
      <span class="mat-row__sum">${maskUnless('seesFinanceAnalytics', money(r.total))}</span>
    </div>
  `).join('') || '<div class="empty-state empty-state--sm">Нет данных за период</div>';

  const orderRows = report.byOrder.map((r) => `
    <div class="mat-row" data-order-row="${r.order.id}" style="cursor:pointer;">
      <span class="mat-row__name">#${r.order.number} — ${escapeHtml(r.order.clientName)}</span>
      <span class="mat-row__calc">${r.count} платеж.</span>
      <span class="mat-row__sum">${maskUnless('seesFinanceAnalytics', money(r.total))}</span>
    </div>
  `).join('') || '<div class="empty-state empty-state--sm">Нет данных за период</div>';

  // "Выполненных заказов" per directory partner, across ALL orders (not just
  // the current period filter) — count/total are all-time, matching the
  // Партнёры page's own stat badge.
  const statsRows = partners.map((p) => {
    const stats = getPartnerStats(p.id);
    if (!stats.completedOrders && !stats.totalPaid) return '';
    return `
      <div class="mat-row">
        <span class="mat-row__name">${escapeHtml(p.name)}</span>
        <span class="mat-row__calc">${stats.completedOrders} выполн. заказ.</span>
        <span class="mat-row__sum">${maskUnless('seesFinanceAnalytics', money(stats.totalPaid))}</span>
      </div>
    `;
  }).join('') || '<div class="empty-state empty-state--sm">Нет данных</div>';

  return `
    <div class="panel">
      <div class="order-detail__section-title" style="margin-top:18px;">Аутсорс</div>
      <div class="section-block">
        <div class="section-totals"><span>Выплачено за период: <b>${maskUnless('seesFinanceAnalytics', money(report.total))}</b></span></div>
      </div>
      <div class="order-detail__section-title">По партнёрам</div>
      <div class="section-block"><div class="mat-rows">${partnerRows}</div></div>
      <div class="order-detail__section-title">По заказам</div>
      <div class="section-block"><div class="mat-rows">${orderRows}</div></div>
      <div class="order-detail__section-title">Статистика по партнёрам (за всё время)</div>
      <div class="section-block section-block--last"><div class="mat-rows">${statsRows}</div></div>
    </div>
  `;
}
