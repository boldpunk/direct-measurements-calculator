// "Фурнитура" report embedded in the Финансы page: total hardware/fittings
// revenue broken down by category and by product name (aggregated from the
// stock-sourced order materials already tracked per order), plus a running
// balance owed to each supplier with a "добавить оплату" action.

import { api } from '../api.js';
import { getFinance, todayISO } from '../store.js';
import { money, escapeHtml } from '../format.js';
import { openModal, closeModal } from '../ui.js';
import { can, sees, maskUnless } from '../permissions.js';

let specLookup = new Map();
let supplierSummaries = [];
let loading = true;
let loadStarted = false;

function buildSpecLookup(items) {
  const map = new Map();
  items.forEach((it) => map.set(it.id, it));
  return map;
}

function computeFittingsReport(periodOrders) {
  const byCategory = new Map();
  const byProduct = new Map();
  let totalRevenue = 0;
  let totalQty = 0;

  for (const order of periodOrders) {
    const finance = getFinance(order.id);
    for (const m of finance.materials) {
      if (m.source !== 'stock' || !m.specId) continue;
      const info = specLookup.get(m.specId);
      const revenue = m.qty * m.unitPrice;
      totalRevenue += revenue;
      totalQty += m.qty;

      const catName = info?.categoryName || 'Без категории';
      const cat = byCategory.get(catName) || { name: catName, qty: 0, revenue: 0 };
      cat.qty += m.qty; cat.revenue += revenue;
      byCategory.set(catName, cat);

      const prodName = info ? `${info.productName}${info.name ? ` — ${info.name}` : ''}` : m.name;
      const prodKey = `${catName} :: ${prodName}`;
      const prod = byProduct.get(prodKey) || { name: prodName, categoryName: catName, qty: 0, revenue: 0 };
      prod.qty += m.qty; prod.revenue += revenue;
      byProduct.set(prodKey, prod);
    }
  }

  return {
    totalRevenue, totalQty,
    byCategory: [...byCategory.values()].sort((a, b) => b.revenue - a.revenue),
    byProduct: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue),
  };
}

export function renderFittingsSection(periodOrders) {
  if (!can('stock', 'view')) return '';
  if (loading) {
    return `
      <div class="order-detail__section-title">Фурнитура</div>
      <div class="panel"><div class="section-block section-block--last"><div class="empty-state empty-state--sm">Загрузка...</div></div></div>
    `;
  }

  const report = computeFittingsReport(periodOrders);

  const catRows = report.byCategory.map((c) => `
    <div class="mat-row">
      <span class="mat-row__name">${escapeHtml(c.name)}</span>
      <span class="mat-row__calc">${c.qty} шт.</span>
      <span class="mat-row__sum">${maskUnless('seesFinanceAnalytics', money(c.revenue))}</span>
    </div>
  `).join('') || '<div class="empty-state empty-state--sm">Нет данных за период</div>';

  const prodRows = report.byProduct.map((p) => `
    <div class="mat-row">
      <span class="mat-row__name">${escapeHtml(p.categoryName)} · ${escapeHtml(p.name)}</span>
      <span class="mat-row__calc">${p.qty} шт.</span>
      <span class="mat-row__sum">${maskUnless('seesFinanceAnalytics', money(p.revenue))}</span>
    </div>
  `).join('') || '<div class="empty-state empty-state--sm">Нет данных за период</div>';

  const canPay = can('stock', 'income');
  const supplierRows = supplierSummaries.map((s) => `
    <div class="mat-row">
      <span class="mat-row__name">${escapeHtml(s.name)}</span>
      <span class="mat-row__calc">Долг: ${maskUnless('seesSupplierData', money(s.balance))}</span>
      ${canPay ? `<button type="button" class="btn btn--sm" data-action="add-supplier-payment" data-supplier="${s.id}">Оплатить</button>` : ''}
    </div>
  `).join('') || '<div class="empty-state empty-state--sm">Поставщиков нет</div>';

  return `
    <div class="order-detail__section-title">Фурнитура</div>
    <div class="panel">
      <div class="section-block">
        <div class="section-totals"><span>Продано фурнитуры: <b>${maskUnless('seesFinanceAnalytics', money(report.totalRevenue))}</b> (${report.totalQty} шт.)</span></div>
      </div>
      <div class="order-detail__section-title">По категориям</div>
      <div class="section-block"><div class="mat-rows">${catRows}</div></div>
      <div class="order-detail__section-title">По наименованиям</div>
      <div class="section-block"><div class="mat-rows">${prodRows}</div></div>
      <div class="order-detail__section-title">Задолженность поставщикам</div>
      <div class="section-block section-block--last"><div class="mat-rows">${supplierRows}</div></div>
    </div>
  `;
}

async function loadFittingsData(rerender) {
  try {
    const [items, suppliers] = await Promise.all([api.getStockItems({}), api.getSuppliersSummary()]);
    specLookup = buildSpecLookup(items);
    supplierSummaries = suppliers;
  } catch (e) {
    console.error('Failed to load Фурнитура data', e);
  }
  loading = false;
  rerender();
}

// Decoupled from this module's own supplier cache so other views (e.g. the
// Склад "Справочники" modal) can reuse it with their own supplier object and
// their own post-payment refresh logic.
export function openSupplierPaymentModal(supplier, onSuccess) {
  openModal(`Оплата поставщику: ${escapeHtml(supplier?.name || '')}`, `
    <form id="supplier-payment-form" class="form">
      <p class="form-hint">Текущий долг: ${money(supplier?.balance || 0)}</p>
      <label>Сумма<input type="number" name="amount" min="0.01" step="0.01" required /></label>
      <label>Дата<input type="date" name="date" value="${todayISO()}" /></label>
      <label>Комментарий<textarea name="comment" rows="2"></textarea></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Добавить оплату</button>
      </div>
    </form>
  `);

  document.getElementById('supplier-payment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await api.addSupplierPayment(supplier.id, { amount: fd.get('amount'), date: fd.get('date'), comment: fd.get('comment') });
      closeModal();
      await onSuccess();
    } catch (err) {
      window.alert(err.message || 'Не удалось добавить оплату');
      submitBtn.disabled = false;
    }
  });
}

export function attachFittingsHandlers(root, rerender) {
  if (!loadStarted) {
    loadStarted = true;
    loadFittingsData(rerender);
  }
  root.querySelectorAll('[data-action="add-supplier-payment"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const supplier = supplierSummaries.find((s) => s.id === btn.getAttribute('data-supplier'));
      openSupplierPaymentModal(supplier, async () => { loading = true; await loadFittingsData(rerender); });
    });
  });
}
