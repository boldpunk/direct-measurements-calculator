import { getState, createPartner, deletePartner, OUTSOURCE_SERVICES } from '../store.js';
import { escapeHtml } from '../format.js';
import { openModal, closeModal } from '../ui.js';

export function renderOutsource() {
  const state = getState();

  const rows = state.partners.map((p) => `
    <div class="partner-card">
      <div class="partner-card__header">
        <b>${escapeHtml(p.name)}</b>
        <div class="stars">${'★'.repeat(p.rating)}${'☆'.repeat(Math.max(0, 5 - p.rating))}</div>
      </div>
      <div class="partner-card__services">
        ${p.services.map((s) => `<span class="badge badge--muted">${escapeHtml(s)}</span>`).join(' ')}
      </div>
      <div class="partner-card__meta">
        <span><i class="fa-solid fa-phone"></i> ${escapeHtml(p.contacts) || '—'}</span>
        <span><i class="fa-solid fa-clock"></i> ${p.avgLeadDays} дн.</span>
      </div>
      ${p.comment ? `<div class="partner-card__comment">${escapeHtml(p.comment)}</div>` : ''}
      <button class="btn btn--sm btn--danger-ghost" data-action="delete-partner" data-id="${p.id}">Удалить</button>
    </div>
  `).join('') || '<div class="empty-state">Партнёров нет</div>';

  return `
    <div class="page-header">
      <h1>Аутсорс партнёры</h1>
      <button class="btn btn--primary" data-action="new-partner"><i class="fa-solid fa-plus"></i> Новый партнёр</button>
    </div>
    <div class="partner-grid">${rows}</div>
  `;
}

export function attachOutsourceHandlers(root, rerender) {
  const newBtn = root.querySelector('[data-action="new-partner"]');
  if (newBtn) newBtn.addEventListener('click', () => openNewPartnerModal(rerender));

  root.querySelectorAll('[data-action="delete-partner"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      deletePartner(btn.getAttribute('data-id'));
      rerender();
    });
  });
}

function openNewPartnerModal(rerender) {
  openModal('Новый партнёр', `
    <form id="partner-form" class="form">
      <label>Название<input name="name" required placeholder="Название компании" /></label>
      <label>Услуги
        <div class="checkbox-row">
          ${OUTSOURCE_SERVICES.map((s) => `<label class="checkbox-label"><input type="checkbox" name="services" value="${s}" /> ${s}</label>`).join('')}
        </div>
      </label>
      <label>Контакты<input name="contacts" placeholder="+998 ..." /></label>
      <label>Средний срок, дн.<input name="avgLeadDays" type="number" min="0" value="2" /></label>
      <label>Рейтинг (1-5)<input name="rating" type="number" min="1" max="5" value="5" /></label>
      <label>Комментарии<textarea name="comment" rows="2"></textarea></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Создать</button>
      </div>
    </form>
  `);

  document.getElementById('partner-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    createPartner({
      name: fd.get('name'),
      services: fd.getAll('services'),
      contacts: fd.get('contacts'),
      avgLeadDays: fd.get('avgLeadDays'),
      rating: fd.get('rating'),
      comment: fd.get('comment'),
    });
    closeModal();
    rerender();
  });
}
