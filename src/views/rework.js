import { getState, createRework, updateReworkStatus, REWORK_REASONS, REWORK_STATUSES } from '../store.js';
import { money, shortDate, escapeHtml } from '../format.js';
import { openModal, closeModal, selectOptions } from '../ui.js';
import { can } from '../permissions.js';
import { fileToDataUrl, storeImage } from '../image-picker.js';
import { mediaUrl } from '../api.js';

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
          <select data-rework-status="${r.id}" ${can('rework', 'edit') ? '' : 'disabled'}>
            ${REWORK_STATUSES.map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="rework-card__body">
          ${r.photoUrl ? `
            <a href="${escapeHtml(mediaUrl(r.photoUrl))}" target="_blank" rel="noopener noreferrer" class="rework-card__photo">
              <img src="${escapeHtml(mediaUrl(r.photoUrl))}${r.photoUrl.includes('/api/files/') ? '?thumb=1' : ''}" alt="Фото переделки" loading="lazy" />
            </a>
          ` : ''}
          <div>
            <div class="rework-card__desc">${escapeHtml(r.description)}</div>
            <div class="rework-card__meta">
              <span>Причина: ${r.reason}</span>
              <span>Ответственный: ${responsible ? escapeHtml(responsible.name) : '—'}</span>
              <span>Влияние: ${money(r.costImpact)}</span>
              <span>${shortDate(new Date(r.createdAt).toISOString().slice(0, 10))}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('') || '<div class="empty-state">Переделок нет</div>';

  return `
    <div class="page-header">
      <h1>Переделки</h1>
      ${can('rework', 'create') ? '<button class="btn btn--primary" data-action="new-rework"><i class="fa-solid fa-plus"></i> Новая переделка</button>' : ''}
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
        <select name="orderId" required>${selectOptions(state.orders.map((o) => ({ id: o.id, label: `${o.clientName} — ${o.productType} #${o.number}` })), 'id', 'label')}</select>
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
      <label>Влияние на стоимость<input name="costImpact" type="number" min="0" value="0" /></label>
      <label>Фото
        <input type="file" id="rework-photo" accept="image/*" capture="environment" />
        <span class="form-hint" id="rework-photo-status">Сфотографируйте дефект или выберите файл</span>
      </label>
      <input type="hidden" name="photoUrl" />
      <p class="form-hint">Переделка автоматически создаст задачу «Столярка» с приоритетом «Срочно».</p>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Создать переделку</button>
      </div>
    </form>
  `);

  const photoInput = document.getElementById('rework-photo');
  const photoStatus = document.getElementById('rework-photo-status');
  const submitBtn = document.querySelector('#rework-form [type="submit"]');
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    photoStatus.textContent = 'Загрузка фото…';
    submitBtn.disabled = true;
    try {
      document.querySelector('#rework-form [name="photoUrl"]').value = await storeImage(await fileToDataUrl(file));
      photoStatus.textContent = 'Фото загружено ✓';
    } catch (err) {
      photoStatus.textContent = err.message || 'Не удалось загрузить фото';
    } finally {
      submitBtn.disabled = false;
    }
  });

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
      photoUrl: fd.get('photoUrl'),
    });
    closeModal();
    rerender();
  });
}
