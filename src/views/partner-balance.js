// Взаиморасчёты с партнёрами — долг / кредит.
//
// Two entry points share this module:
//   • renderPartnerBalanceSection() — the «Партнёры: долг / кредит» block on
//     the Финансы page (totals, filters, table, отчёт);
//   • openPartnerBalanceModal() — one partner's card: balances per currency,
//     [+ Дебит] [+ Кредит] and the full operation history. Опened both from
//     that table and from the partner card on Аутсорс.
//
// Nothing here computes a balance. Every figure comes from the backend,
// which derives it from the operation journal — the frontend only ever says
// "add this operation" and re-reads the result.
import { api } from '../api.js';
import { getSettings, todayISO } from '../store.js';
import { money, escapeHtml } from '../format.js';
import { openModal, closeModal } from '../ui.js';
import { can, maskUnless } from '../permissions.js';

const STATUSES = ['Нам должны', 'Мы должны', 'Закрыт'];

// Filters that belong to this section alone; the date period comes from the
// Финансы page's own filter, which every section there already follows.
let filterQuery = '';
let filterStatus = '';
let filterCurrency = '';

let summary = null;      // { rows, totals, currencies, defaultCurrency }
let summaryKey = null;   // query the cached summary was loaded with
let loading = false;

// Separate, unfiltered cache for the partner cards on Аутсорс — that page
// shows each partner's current standing, not whatever Финансы is filtered to.
let cardRows = null;
let cardLoadStarted = false;

function isoFromTimestamp(ts) {
  if (ts == null) return '';
  return new Date(ts).toISOString().slice(0, 10);
}

function queryFor(range) {
  return {
    from: isoFromTimestamp(range?.from),
    to: isoFromTimestamp(range?.to),
    q: filterQuery,
    status: filterStatus,
    currency: filterCurrency,
  };
}

function keyOf(params) {
  return JSON.stringify(params);
}

// yyyy-mm-dd → dd.mm.yyyy without going through Date(), which would shift
// the day by one in timezones behind UTC.
function fmtDate(iso) {
  const [y, m, d] = String(iso || '').split('-');
  return y && m && d ? `${d}.${m}.${y}` : (iso || '—');
}

function balanceClass(balance) {
  if (balance > 0) return 'text-pos';
  if (balance < 0) return 'text-neg';
  return '';
}

// The sign is the meaning: + партнёр должен нам, − мы должны партнёру.
function signedMoney(balance, currency) {
  return `${balance > 0 ? '+' : ''}${money(balance, currency)}`;
}

function statusBadge(status) {
  const tone = status === 'Нам должны' ? 'success' : status === 'Мы должны' ? 'danger' : 'muted';
  return `<span class="badge badge--tone-${tone}">${escapeHtml(status)}</span>`;
}

// ---- Финансы section ----

export function renderPartnerBalanceSection(range) {
  if (!can('partnerBalance', 'view')) return '';

  const periodActive = range?.from != null || range?.to != null;

  if (!summary) {
    return `
      <div class="panel" id="partner-balance-section">
        <div class="order-detail__section-title" style="margin-top:18px;">Партнёры: долг / кредит</div>
        <div class="section-block section-block--last"><div class="empty-state empty-state--sm">Загрузка...</div></div>
      </div>
    `;
  }

  const currencies = summary.currencies || [];
  const totals = summary.totals || [];

  // Totals are per currency — a $ balance and a so'm balance are separate
  // ledgers, so each currency gets its own captioned row rather than one
  // meaningless sum.
  const totalsHtml = totals.length ? totals.map((t) => `
    ${totals.length > 1 ? `<div class="pb-totals__caption">Валюта: ${escapeHtml(t.currency)}</div>` : ''}
    <div class="pb-totals">
      <div class="pb-total pb-total--pos">
        <span class="pb-total__label">Нам должны</span>
        <span class="pb-total__value">${maskUnless('seesFinanceAnalytics', money(t.owedToUs, t.currency))}</span>
      </div>
      <div class="pb-total pb-total--neg">
        <span class="pb-total__label">Мы должны</span>
        <span class="pb-total__value">${maskUnless('seesFinanceAnalytics', money(t.owedByUs, t.currency))}</span>
      </div>
      <div class="pb-total">
        <span class="pb-total__label">Чистый баланс</span>
        <span class="pb-total__value ${balanceClass(t.net)}">${maskUnless('seesFinanceAnalytics', signedMoney(t.net, t.currency))}</span>
      </div>
      <div class="pb-total">
        <span class="pb-total__label">Активные</span>
        <span class="pb-total__value">${t.active}</span>
      </div>
      <div class="pb-total">
        <span class="pb-total__label">Закрытые</span>
        <span class="pb-total__value">${t.closed}</span>
      </div>
    </div>
  `).join('') : '<div class="empty-state empty-state--sm">Нет данных</div>';

  const rows = (summary.rows || []).map((r) => `
    <tr data-partner-balance-row="${r.partnerId}" data-currency="${escapeHtml(r.currency)}" style="cursor:pointer;">
      <td>${escapeHtml(r.partnerName)}</td>
      <td>${maskUnless('seesFinanceAnalytics', money(r.debit, r.currency))}</td>
      <td>${maskUnless('seesFinanceAnalytics', money(r.credit, r.currency))}</td>
      <td class="${balanceClass(r.balance)}"><b>${maskUnless('seesFinanceAnalytics', signedMoney(r.balance, r.currency))}</b></td>
      <td>${statusBadge(r.status)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-state">Партнёров нет</td></tr>';

  return `
    <div class="panel" id="partner-balance-section">
      <div class="order-detail__section-title" style="margin-top:18px;">Партнёры: долг / кредит</div>
      <div class="section-block">
        ${periodActive ? '<p class="form-hint">За выбранный период: дебит, кредит и баланс считаются только по операциям внутри периода.</p>' : ''}
        ${totalsHtml}
      </div>
      <div class="section-block">
        <div class="orders-toolbar">
          <input type="search" id="pb-search" placeholder="Поиск партнёра" value="${escapeHtml(filterQuery)}" />
          <select id="pb-status">
            <option value="">Все статусы</option>
            ${STATUSES.map((s) => `<option value="${s}" ${s === filterStatus ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <select id="pb-currency">
            <option value="">Все валюты</option>
            ${currencies.map((c) => `<option value="${escapeHtml(c)}" ${c === filterCurrency ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
          ${can('partnerBalance', 'report') ? '<button type="button" class="btn" id="pb-report-btn"><i class="fa-solid fa-file-pdf"></i> Скачать отчёт</button>' : ''}
        </div>
      </div>
      <div class="panel__body" style="padding:0; overflow-x:auto">
        <table class="data-table">
          <thead>
            <tr><th>Партнёр</th><th>Дебит</th><th>Кредит</th><th>Баланс</th><th>Статус</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function loadSummary(params, rerender) {
  loading = true;
  try {
    summary = await api.getPartnerBalanceSummary(params);
    summaryKey = keyOf(params);
  } catch (e) {
    console.error('Failed to load partner balances', e);
  }
  loading = false;
  rerender();
}

export function attachPartnerBalanceHandlers(root, rerender, range) {
  if (!can('partnerBalance', 'view')) return;

  const params = queryFor(range);
  if (!loading && keyOf(params) !== summaryKey) {
    loadSummary(params, rerender);
    return;
  }

  const search = root.querySelector('#pb-search');
  if (search) {
    let debounce = null;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { filterQuery = search.value.trim(); rerender(); }, 300);
    });
  }
  const statusSelect = root.querySelector('#pb-status');
  if (statusSelect) statusSelect.addEventListener('change', () => { filterStatus = statusSelect.value; rerender(); });
  const currencySelect = root.querySelector('#pb-currency');
  if (currencySelect) currencySelect.addEventListener('change', () => { filterCurrency = currencySelect.value; rerender(); });

  const reportBtn = root.querySelector('#pb-report-btn');
  if (reportBtn) {
    reportBtn.addEventListener('click', async () => {
      const original = reportBtn.innerHTML;
      reportBtn.disabled = true;
      reportBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      try {
        // Один отчёт — одна валюта: балансы в разных валютах не складываются.
        const currency = filterCurrency || summary?.defaultCurrency || getSettings().currency;
        const blob = await api.getPartnerBalanceReportPdfBlob({ ...params, currency });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) {
        window.alert(e.message || 'Не удалось сформировать отчёт');
      } finally {
        reportBtn.disabled = false;
        reportBtn.innerHTML = original;
      }
    });
  }

  root.querySelectorAll('[data-partner-balance-row]').forEach((row) => {
    row.addEventListener('click', () => {
      openPartnerBalanceModal(row.getAttribute('data-partner-balance-row'), () => {
        summaryKey = null;   // force a reload with the current filters
        cardRows = null;
        cardLoadStarted = false;
        rerender();
      });
    });
  });
}

// ---- Partner card (Аутсорс) ----

// Current standing for one partner, for the «Взаиморасчёты» block on the
// partner card. Returns [] until the shared summary has loaded.
export function getPartnerBalanceRows(partnerId) {
  if (!cardRows) return [];
  return cardRows.filter((r) => r.partnerId === partnerId && (r.debit || r.credit));
}

export function ensurePartnerBalanceCard(rerender) {
  if (!can('partnerBalance', 'view') || cardLoadStarted) return;
  cardLoadStarted = true;
  api.getPartnerBalanceSummary({})
    .then((data) => { cardRows = data.rows || []; rerender(); })
    .catch((e) => console.error('Failed to load partner balances', e));
}

export function renderPartnerBalanceBlock(partnerId) {
  if (!can('partnerBalance', 'view')) return '';
  const rows = getPartnerBalanceRows(partnerId);
  const body = rows.length ? rows.map((r) => `
    <div class="pb-card-line">
      <span>Дебит: <b>${maskUnless('seesFinanceAnalytics', money(r.debit, r.currency))}</b></span>
      <span>Кредит: <b>${maskUnless('seesFinanceAnalytics', money(r.credit, r.currency))}</b></span>
      <span class="${balanceClass(r.balance)}">Баланс: <b>${maskUnless('seesFinanceAnalytics', signedMoney(r.balance, r.currency))}</b></span>
      ${statusBadge(r.status)}
    </div>
  `).join('') : '<div class="pb-card-line pb-card-line--empty">Операций нет</div>';

  return `
    <div class="pb-card">
      <div class="pb-card__title">Взаиморасчёты</div>
      ${body}
      <div class="pb-card__actions">
        ${can('partnerBalance', 'create') ? `
          <button type="button" class="btn btn--sm" data-action="pb-add" data-type="DEBIT" data-id="${partnerId}">+ Дебит</button>
          <button type="button" class="btn btn--sm" data-action="pb-add" data-type="CREDIT" data-id="${partnerId}">+ Кредит</button>
        ` : ''}
        <button type="button" class="btn btn--sm" data-action="pb-history" data-id="${partnerId}">История</button>
      </div>
    </div>
  `;
}

// Wires the partner-card buttons. `rerender` re-renders the host page after a
// change so the block's numbers follow.
export function attachPartnerBalanceCardHandlers(root, rerender) {
  if (!can('partnerBalance', 'view')) return;
  ensurePartnerBalanceCard(rerender);

  const refresh = () => {
    cardRows = null;
    cardLoadStarted = false;
    summaryKey = null;
    ensurePartnerBalanceCard(rerender);
    rerender();
  };

  root.querySelectorAll('[data-action="pb-add"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTransactionModal(btn.getAttribute('data-id'), btn.getAttribute('data-type'), refresh);
    });
  });
  root.querySelectorAll('[data-action="pb-history"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPartnerBalanceModal(btn.getAttribute('data-id'), refresh);
    });
  });
}

// ---- Partner detail modal ----

function transactionRow(tx, canCancel) {
  const typeLabel = tx.type === 'DEBIT' ? 'Дебит' : 'Кредит';
  const typeTone = tx.type === 'DEBIT' ? 'success' : 'danger';
  const notes = [];
  if (tx.isInitial) notes.push('начальный баланс');
  if (tx.reversalOfId) notes.push('сторно');
  if (tx.isReversed) notes.push('сторнирована');
  if (tx.outsourceExpenseLabel) notes.push(escapeHtml(tx.outsourceExpenseLabel));

  return `
    <tr class="${tx.isReversed ? 'pb-row--reversed' : ''}">
      <td class="pb-nowrap">${escapeHtml(fmtDate(tx.date))}</td>
      <td><span class="badge badge--tone-${typeTone}">${typeLabel}</span></td>
      <td class="pb-nowrap">${tx.type === 'CREDIT' ? '−' : '+'}${money(tx.amount, tx.currency)}</td>
      <td>
        ${escapeHtml(tx.comment || '—')}
        ${notes.length ? `<div class="row-item__sub">${notes.join(' · ')}</div>` : ''}
        ${tx.createdByName ? `<div class="row-item__sub">${escapeHtml(tx.createdByName)}</div>` : ''}
      </td>
      <td class="pb-nowrap ${balanceClass(tx.balanceAfter)}">${signedMoney(tx.balanceAfter, tx.currency)}</td>
      <td>
        ${canCancel && !tx.isReversed && !tx.reversalOfId
          ? `<button type="button" class="btn btn--sm btn--danger-ghost" data-action="pb-reverse" data-id="${tx.id}">Сторно</button>`
          : ''}
      </td>
    </tr>
  `;
}

function renderModalBody(detail) {
  const canCancel = can('partnerBalance', 'cancel');
  const balances = detail.balances.length ? detail.balances.map((b) => `
    <div class="pb-balance">
      <div class="pb-balance__row"><span>Дебит</span><b>${money(b.debit, b.currency)}</b></div>
      <div class="pb-balance__row"><span>Кредит</span><b>${money(b.credit, b.currency)}</b></div>
      <div class="pb-balance__row pb-balance__row--total">
        <span>Баланс</span>
        <b class="${balanceClass(b.balance)}">${signedMoney(b.balance, b.currency)}</b>
      </div>
      <div class="pb-balance__status">${statusBadge(b.status)}</div>
    </div>
  `).join('') : '<div class="empty-state empty-state--sm">Операций нет</div>';

  // Newest first in the history — the running balance is already stored per
  // row, so reversing the display order doesn't change any figure.
  const history = [...detail.transactions].reverse();

  return `
    <div class="pb-modal">
      <div class="pb-balances">${balances}</div>
      ${can('partnerBalance', 'create') ? `
        <div class="form-actions form-actions--left">
          <button type="button" class="btn btn--primary" data-action="pb-modal-add" data-type="DEBIT">+ Дебит</button>
          <button type="button" class="btn" data-action="pb-modal-add" data-type="CREDIT">+ Кредит</button>
        </div>
      ` : ''}
      <div class="order-detail__section-title">История взаиморасчётов</div>
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead><tr><th>Дата</th><th>Тип</th><th>Сумма</th><th>Комментарий</th><th>Баланс после</th><th></th></tr></thead>
          <tbody>
            ${history.map((tx) => transactionRow(tx, canCancel)).join('')
              || '<tr><td colspan="6" class="empty-state">Операций нет</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export async function openPartnerBalanceModal(partnerId, onChanged) {
  openModal('Взаиморасчёты', '<div class="empty-state empty-state--sm">Загрузка...</div>', { wide: true });
  let detail;
  try {
    detail = await api.getPartnerBalance(partnerId);
  } catch (e) {
    openModal('Взаиморасчёты', `<div class="empty-state empty-state--sm">${escapeHtml(e.message || 'Не удалось загрузить')}</div>`);
    return;
  }

  const paint = (data) => {
    openModal(`Взаиморасчёты: ${escapeHtml(data.partner.name)}`, renderModalBody(data), { wide: true });
    const body = document.getElementById('modal-body');

    body.querySelectorAll('[data-action="pb-modal-add"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openTransactionModal(partnerId, btn.getAttribute('data-type'), async () => {
          if (onChanged) onChanged();
          paint(await api.getPartnerBalance(partnerId));
        }, data.balances[0]?.currency || data.defaultCurrency, () => paint(data));
      });
    });

    body.querySelectorAll('[data-action="pb-reverse"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Сторнировать операцию? Будет создана обратная операция, исходная останется в истории.')) return;
        btn.disabled = true;
        try {
          await api.reversePartnerBalanceTransaction(btn.getAttribute('data-id'));
          if (onChanged) onChanged();
          paint(await api.getPartnerBalance(partnerId));
        } catch (e) {
          window.alert(e.message || 'Не удалось сторнировать операцию');
          btn.disabled = false;
        }
      });
    });
  };

  paint(detail);
}

// ---- Add-operation modal ----

// `onCancel` is set when this form is opened on top of the partner modal:
// «Отмена» then paints that modal back instead of dropping the user out of
// the card they were looking at.
export async function openTransactionModal(partnerId, type, onSuccess, currencyHint, onCancel) {
  const isDebit = type === 'DEBIT';
  const settings = getSettings();
  const currencies = [...new Set([currencyHint || settings.currency, settings.currency, '$', "so'm", '€'].filter(Boolean))];

  // Аутсорс-платежи этого партнёра — необязательная привязка к фактической
  // оплате. Сама привязка баланс не меняет и расход не создаёт.
  let expenses = [];
  try {
    expenses = await api.getPartnerOutsourceExpenses(partnerId);
  } catch { /* привязка необязательна — форма работает и без неё */ }

  openModal(isDebit ? 'Новая операция: Дебит' : 'Новая операция: Кредит', `
    <form id="pb-form" class="form">
      <p class="form-hint">
        ${isDebit
          ? 'Дебит — партнёр должен нам. Баланс увеличится на эту сумму.'
          : 'Кредит — мы должны партнёру. Баланс уменьшится на эту сумму.'}
      </p>
      <label>Сумма<input type="number" name="amount" min="0.01" step="0.01" required autofocus /></label>
      <label>Валюта
        <select name="currency">
          ${currencies.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
        </select>
      </label>
      <label>Дата<input type="date" name="date" value="${todayISO()}" /></label>
      <label>Комментарий<textarea name="comment" rows="2" placeholder="За что / по какому объекту"></textarea></label>
      ${expenses.length ? `
        <label>Связать с аутсорс-платежом (необязательно)
          <select name="outsourceExpenseId">
            <option value="">— не привязан —</option>
            ${expenses.map((e) => `<option value="${e.id}">${escapeHtml(e.name)} · заказ #${e.orderNumber ?? '—'} · ${money(e.amount)}</option>`).join('')}
          </select>
        </label>
        <p class="form-hint">Привязка — только справочная: сумма платежа не пересчитывается и второй расход не создаётся.</p>
      ` : ''}
      <label class="checkbox-label"><input type="checkbox" name="isInitial" /> Это начальный баланс (долг до начала учёта)</label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="${onCancel ? 'pb-cancel' : 'close-modal'}">Отмена</button>
        <button type="submit" class="btn btn--primary">${isDebit ? 'Добавить дебит' : 'Добавить кредит'}</button>
      </div>
    </form>
  `);

  const cancelBtn = document.querySelector('[data-action="pb-cancel"]');
  if (cancelBtn && onCancel) cancelBtn.addEventListener('click', () => onCancel());

  document.getElementById('pb-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await api.addPartnerBalanceTransaction(partnerId, {
        type,
        amount: fd.get('amount'),
        currency: fd.get('currency'),
        date: fd.get('date'),
        comment: fd.get('comment'),
        outsourceExpenseId: fd.get('outsourceExpenseId') || null,
        isInitial: fd.get('isInitial') === 'on',
      });
      closeModal();
      if (onSuccess) await onSuccess();
    } catch (err) {
      window.alert(err.message || 'Не удалось добавить операцию');
      submitBtn.disabled = false;
    }
  });
}
