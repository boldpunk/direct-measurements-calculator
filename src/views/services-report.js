// "Услуги" report embedded in the Финансы page: total services revenue
// broken down by category and by name, aggregated from the order-service
// line items already tracked per order — mirrors fittings.js's Фурнитура
// report, but for services instead of stock-sourced materials.

import { api } from '../api.js';
import { getFinance } from '../store.js';
import { money, escapeHtml } from '../format.js';
import { can, maskUnless } from '../permissions.js';

let categoryLookup = new Map();
let loading = true;
let loadStarted = false;

function computeServicesReport(periodOrders) {
  const byCategory = new Map();
  const byName = new Map();
  let totalRevenue = 0;
  let totalQty = 0;

  for (const order of periodOrders) {
    const finance = getFinance(order.id);
    for (const s of finance.services) {
      const revenue = s.qty * s.unitPrice;
      totalRevenue += revenue;
      totalQty += s.qty;

      const catName = categoryLookup.get(s.serviceId) || 'Без категории';
      const cat = byCategory.get(catName) || { name: catName, qty: 0, revenue: 0 };
      cat.qty += s.qty; cat.revenue += revenue;
      byCategory.set(catName, cat);

      const nm = byName.get(s.name) || { name: s.name, qty: 0, revenue: 0 };
      nm.qty += s.qty; nm.revenue += revenue;
      byName.set(s.name, nm);
    }
  }

  return {
    totalRevenue, totalQty,
    byCategory: [...byCategory.values()].sort((a, b) => b.revenue - a.revenue),
    byName: [...byName.values()].sort((a, b) => b.revenue - a.revenue),
  };
}

export function renderServicesReportSection(periodOrders) {
  if (!can('services', 'view')) return '';
  if (loading) {
    return `
      <div class="panel">
        <div class="order-detail__section-title" style="margin-top:18px;">Услуги</div>
        <div class="section-block section-block--last"><div class="empty-state empty-state--sm">Загрузка...</div></div>
      </div>
    `;
  }

  const report = computeServicesReport(periodOrders);

  const catRows = report.byCategory.map((c) => `
    <div class="mat-row">
      <span class="mat-row__name">${escapeHtml(c.name)}</span>
      <span class="mat-row__calc">${c.qty} шт.</span>
      <span class="mat-row__sum">${maskUnless('seesFinanceAnalytics', money(c.revenue))}</span>
    </div>
  `).join('') || '<div class="empty-state empty-state--sm">Нет данных за период</div>';

  const nameRows = report.byName.map((n) => `
    <div class="mat-row">
      <span class="mat-row__name">${escapeHtml(n.name)}</span>
      <span class="mat-row__calc">${n.qty} шт.</span>
      <span class="mat-row__sum">${maskUnless('seesFinanceAnalytics', money(n.revenue))}</span>
    </div>
  `).join('') || '<div class="empty-state empty-state--sm">Нет данных за период</div>';

  return `
    <div class="panel">
      <div class="order-detail__section-title" style="margin-top:18px;">Услуги</div>
      <div class="section-block">
        <div class="section-totals"><span>Продано услуг: <b>${maskUnless('seesFinanceAnalytics', money(report.totalRevenue))}</b> (${report.totalQty} шт.)</span></div>
      </div>
      <div class="order-detail__section-title">По категориям</div>
      <div class="section-block"><div class="mat-rows">${catRows}</div></div>
      <div class="order-detail__section-title">По наименованиям</div>
      <div class="section-block section-block--last"><div class="mat-rows">${nameRows}</div></div>
    </div>
  `;
}

async function loadServicesReportData(rerender) {
  try {
    const services = await api.getServices({});
    categoryLookup = new Map(services.map((s) => [s.id, s.category || 'Без категории']));
  } catch (e) {
    console.error('Failed to load Услуги report data', e);
  }
  loading = false;
  rerender();
}

export function attachServicesReportHandlers(root, rerender) {
  if (!loadStarted) {
    loadStarted = true;
    loadServicesReportData(rerender);
  }
}
