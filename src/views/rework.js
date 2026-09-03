import { getState, createRework, updateReworkStatus, REWORK_REASONS, REWORK_STATUSES } from '../store.js';
import { money, shortDate, escapeHtml } from '../format.js';
import { openModal, closeModal, selectOptions } from '../ui.js';

export function renderRework() {
  const state = getState();
  const items = [...state.rework].reverse();

  const rows = items.map((r) => {
    const order = state.orders.find((o) => o.id === r.orderId);
    const responsible = state.employees.find((e) => e.id === r.responsibleId);
    return `
      <div class="rework-card ${r.urgency === 'срочно' ? 'rework-card--urgent' : ''}">
        <div class="rework-card__header">
          <div>
            ${r.urgency === 'срочно' ? '<i class="fa-solid fa-fire" style="color:#f97316"></i>' : ''}
            <b>${order ? `${escapeHtml(order.productType)} #${order.number}` : '—'}</b>
          </div>
          <select data-rework-status="${r.id}">
            ${REWORK_STATUSES.map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="rework-card__desc">${escapeHtml(r.description)}</div>
        <div class="rework-card__meta">
          <span>Причина: ${r.reason}</span>
          <span>Ответственный: ${responsible ? escapeHtml(responsible.name) : '—'}</span>
          <span>Влияние: ${money(r.costImpact)}</span>
          <span>${shortDate(new Date(r.createdAt).toISOString().slice(0, 10))}</span>
        </div>
      </div>
    `;
  }).join('') || '<div class="empty-state">Переделок нет</div>';

  return `
    <div class="page-header">
      <h1>Переделки</h1>
      <button class="btn btn--primary" data-action="new-rework"><i class="fa-solid fa-plus"></i> Новая переделка</button>
    </div>
    <div class="rework-list">${rows}</div>
  `;
}

export function attachReworkHandlers(root, rerender) {
  const newBtn = root.querySelector('[data-action="new-rework"]');
  if (newBtn) newBtn.addEventListener('click', () => openNewReworkModal(rerender));

  root.querySelectorAll('[data-rework-status]').forEach((sel) => {
    sel.addEventListener('change', () => {
      updateReworkStatus(sel.getAttribute('data-rework-status'), sel.value);
      rerender();
    });
  });
}

function openNewReworkModal(rerender) {
  const state = getState();
  openModal('Новая переделка', `
    <form id="rework-form" class="form">
      <label>Заказ
        <select name="orderId" required>${selectOptions(state.orders.map((o) => ({ id: o.id, label: `${o.productType} #${o.number}` })), 'id', 'label')}</select>
      </label>
      <label>Причина
        <select name="reason">${REWORK_REASONS.map((r) => `<option value="${r}">${r}</option>`).join('')}</select>
      </label>
      <label>Описание<textarea name="description" rows="2" required placeholder="Что произошло"></textarea></label>
      <label>Ответственный
        <select name="responsibleId">${selectOptions(state.employees, 'id', 'name')}</select>
      </label>
      <label>Срочность
        <select name="urgency">
          <option value="срочно">срочно</option>
          <option value="обычный">обычная</option>
        </select>
      </label>
      <label>Влияние на стоимость, $<input name="costImpact" type="number" min="0" value="0" /></label>
      <p class="form-hint">Переделка автоматически создаст задачу «Столярка» с приоритетом «переделка».</p>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Создать переделку</button>
      </div>
    </form>
  `);

  document.getElementById('rework-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    createRework({
      orderId: fd.get('orderId'),
      reason: fd.get('reason'),
      description: fd.get('description'),
      responsibleId: fd.get('responsibleId'),
      urgency: fd.get('urgency'),
      costImpact: fd.get('costImpact'),
    });
    closeModal();
    rerender();
  });
}
