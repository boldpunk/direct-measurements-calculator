// "Зарплаты" report embedded in the Финансы page: total salary accruals for
// the period, broken down by employee and by order — mirrors
// services-report.js's Услуги report, but for SalaryExpense entries.

import { getFinance, getState, getAccrualTotals } from '../store.js';
import { money, escapeHtml } from '../format.js';
import { can, maskUnless } from '../permissions.js';
import { inPeriodRange } from '../period-filter.js';

function computeSalaryReport(periodOrders) {
  const byEmployee = new Map();
  const byOrder = [];
  let total = 0;

  for (const order of periodOrders) {
    const entries = getFinance(order.id).salaries;
    if (!entries.length) continue;
    const orderTotal = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    total += orderTotal;
    byOrder.push({ order, total: orderTotal, count: entries.length });

    for (const e of entries) {
      const key = e.name || 'Без сотрудника';
      const row = byEmployee.get(key) || { name: key, total: 0, count: 0 };
      row.total += Number(e.amount) || 0;
      row.count += 1;
      byEmployee.set(key, row);
    }
  }

  return {
    total,
    byEmployee: [...byEmployee.values()].sort((a, b) => b.total - a.total),
    byOrder: byOrder.sort((a, b) => b.total - a.total),
  };
}

export function renderSalaryReportSection(periodOrders) {
  if (!can('salaryPayments', 'view')) return '';

  const report = computeSalaryReport(periodOrders);

  const employeeRows = report.byEmployee.map((r) => `
    <div class="mat-row">
      <span class="mat-row__name">${escapeHtml(r.name)}</span>
      <span class="mat-row__calc">${r.count} начисл.</span>
      <span class="mat-row__sum">${maskUnless('seesSalaries', money(r.total))}</span>
    </div>
  `).join('') || '<div class="empty-state empty-state--sm">Нет данных за период</div>';

  const orderRows = report.byOrder.map((r) => `
    <div class="mat-row" data-order-row="${r.order.id}" style="cursor:pointer;">
      <span class="mat-row__name">#${r.order.number} — ${escapeHtml(r.order.clientName)}</span>
      <span class="mat-row__calc">${r.count} начисл.</span>
      <span class="mat-row__sum">${maskUnless('seesSalaries', money(r.total))}</span>
    </div>
  `).join('') || '<div class="empty-state empty-state--sm">Нет данных за период</div>';

  return `
    <div class="panel">
      <div class="order-detail__section-title" style="margin-top:18px;">Зарплаты</div>
      <div class="section-block">
        <div class="section-totals"><span>Начислено за период: <b>${maskUnless('seesSalaries', money(report.total))}</b></span></div>
      </div>
      <div class="order-detail__section-title">По сотрудникам</div>
      <div class="section-block"><div class="mat-rows">${employeeRows}</div></div>
      <div class="order-detail__section-title">По заказам</div>
      <div class="section-block section-block--last"><div class="mat-rows">${orderRows}</div></div>
    </div>
  `;
}

// Standalone accrual/payout ledger (not order-tied) — see salary.js. Debt
// ("Задолженность") is always the current running total, not period-scoped:
// an unpaid accrual from a past period is still owed today. Начислено/
// Выплачено are period-scoped flow figures, matching the range Финансы is
// already filtered to.
export function renderPayrollLedgerSection(range) {
  if (!can('salaryPayments', 'view')) return '';

  const state = getState();
  const accruedInPeriod = state.salaryAccruals
    .filter((a) => inPeriodRange(a.createdAt, range))
    .reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const paidInPeriod = state.salaryPayouts
    .filter((p) => inPeriodRange(new Date(p.paymentDate).getTime(), range))
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const totalDebt = state.salaryAccruals.reduce((s, a) => s + getAccrualTotals(a.id).remaining, 0);

  if (!state.salaryAccruals.length) return '';

  return `
    <div class="panel">
      <div class="order-detail__section-title" style="margin-top:18px;">Заработная плата (начисления и выплаты)</div>
      <div class="section-block section-block--last">
        <div class="section-totals">
          <span>Начислено за период: <b>${maskUnless('seesSalaries', money(accruedInPeriod))}</b></span>
          <span>Выплачено за период: <b>${maskUnless('seesSalaries', money(paidInPeriod))}</b></span>
          <span>Задолженность (всего): <b>${maskUnless('seesSalaries', money(totalDebt))}</b></span>
        </div>
      </div>
    </div>
  `;
}
