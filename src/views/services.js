import { api } from '../api.js';
import { money, escapeHtml } from '../format.js';
import { openModal, closeModal } from '../ui.js';
import { can } from '../permissions.js';
import { UNITS } from '../store.js';

let services = [];
let loading = true;
let initStarted = false;
let filters = { search: '', category: '', status: 'active' };

function categoryOptions() {
  return [...new Set(services.map((s) => s.category).filter(Boolean))].sort();
}

function matchesFilters(s) {
  if (filters.status && s.status !== filters.status) return false;
  if (filters.category && s.category !== filters.category) return false;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    if (!s.name.toLowerCase().includes(q) && !s.category.toLowerCase().includes(q)) return false;
  }
  return true;
}

function serviceRow(s) {
  const canEdit = can('services', 'edit');
  const canDelete = can('services', 'delete');
  return `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.category || '—')}</td>
      <td>${escapeHtml(s.unit)}</td>
      <td>${money(s.price)}</td>
      <td>${s.status === 'archived' ? '<span class="badge badge--muted">Архив</span>' : '<span class="badge badge--tone-success">Активна</span>'}</td>
      <td>
        ${canEdit ? `<button type="button" class="btn btn--sm" data-action="edit-service" data-id="${s.id}"><i class="fa-solid fa-pen"></i></button>` : ''}
        ${canDelete ? `<button type="button" class="btn btn--sm btn--danger-ghost" data-action="delete-service" data-id="${s.id}" title="${s.status === 'archived' ? 'Активировать' : 'Удалить/архивировать'}"><i class="fa-solid ${s.status === 'archived' ? 'fa-rotate-left' : 'fa-trash'}"></i></button>` : ''}
      </td>
    </tr>
  `;
}

export function renderServices() {
  const canCreate = can('services', 'create');
  const rows = services.filter(matchesFilters).map(serviceRow).join('')
    || `<tr><td colspan="6" class="empty-state">${loading ? 'Загрузка...' : 'Услуги не найдены'}</td></tr>`;

  return `
    <div class="page-header">
      <h1>Услуги</h1>
      ${canCreate ? '<button type="button" class="btn btn--primary" data-action="new-service"><i class="fa-solid fa-plus"></i> Добавить услугу</button>' : ''}
    </div>
    <div class="orders-toolbar">
      <div class="orders-toolbar__search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" id="service-search" placeholder="Название, категория..." value="${escapeHtml(filters.search)}" autocomplete="off" />
      </div>
      <select id="service-category-filter">
        <option value="">Все категории</option>
        ${categoryOptions().map((c) => `<option value="${escapeHtml(c)}" ${filters.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
      </select>
      <select id="service-status-filter">
        <option value="active" ${filters.status === 'active' ? 'selected' : ''}>Активные</option>
        <option value="archived" ${filters.status === 'archived' ? 'selected' : ''}>Архив</option>
        <option value="" ${filters.status === '' ? 'selected' : ''}>Все</option>
      </select>
    </div>
    <div class="panel">
      <div class="panel__body" style="padding:0; overflow-x:auto">
        <table class="data-table">
          <thead><tr><th>Услуга</th><th>Категория</th><th>Ед.</th><th>Цена</th><th>Статус</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function loadServices(rerender) {
  loading = true;
  rerender();
  try {
    services = await api.getServices({ status: '' });
  } catch (e) {
    window.alert(e.message || 'Не удалось загрузить услуги');
  }
  loading = false;
  rerender();
}

function openServiceModal(service, rerender) {
  openModal(service ? 'Изменить услугу' : 'Новая услуга', `
    <form id="service-form" class="form">
      <label>Название<input name="name" required value="${service ? escapeHtml(service.name) : ''}" /></label>
      <label>Категория<input name="category" list="service-categories-list" placeholder="напр. Распил" value="${service ? escapeHtml(service.category) : ''}" /></label>
      <datalist id="service-categories-list">${categoryOptions().map((c) => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
      <label>Единица измерения
        <select name="unit">${UNITS.map((u) => `<option ${service?.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
      </label>
      <label>Цена<input name="price" type="number" min="0" step="0.01" required value="${service ? service.price : ''}" /></label>
      <label>Комментарий<input name="comment" value="${service ? escapeHtml(service.comment) : ''}" /></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">${service ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </form>
  `);

  const form = document.getElementById('service-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = {
      name: fd.get('name'),
      category: fd.get('category') || '',
      unit: fd.get('unit'),
      price: fd.get('price'),
      comment: fd.get('comment') || '',
    };
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      if (service) await api.updateService(service.id, data);
      else await api.createService(data);
      closeModal();
      loadServices(rerender);
    } catch (err) {
      window.alert(err.message || 'Не удалось сохранить услугу');
      submitBtn.disabled = false;
    }
  });
}

export function attachServicesHandlers(root, rerender) {
  const searchInput = root.querySelector('#service-search');
  if (searchInput) searchInput.addEventListener('input', () => { filters.search = searchInput.value; rerender(); });
  const catSel = root.querySelector('#service-category-filter');
  if (catSel) catSel.addEventListener('change', () => { filters.category = catSel.value; rerender(); });
  const statusSel = root.querySelector('#service-status-filter');
  if (statusSel) statusSel.addEventListener('change', () => { filters.status = statusSel.value; rerender(); });

  const newBtn = root.querySelector('[data-action="new-service"]');
  if (newBtn) newBtn.addEventListener('click', () => openServiceModal(null, rerender));

  root.querySelectorAll('[data-action="edit-service"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const service = services.find((s) => s.id === btn.getAttribute('data-id'));
      if (service) openServiceModal(service, rerender);
    });
  });

  root.querySelectorAll('[data-action="delete-service"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const service = services.find((s) => s.id === btn.getAttribute('data-id'));
      if (!service) return;
      const isArchived = service.status === 'archived';
      if (!window.confirm(isArchived ? 'Вернуть услугу в активные?' : 'Удалить услугу? Если она уже использована в заказах, она будет перемещена в архив.')) return;
      try {
        if (isArchived) await api.updateService(service.id, { status: 'active' });
        else await api.deleteService(service.id);
        loadServices(rerender);
      } catch (e) {
        window.alert(e.message || 'Не удалось изменить услугу');
      }
    });
  });

  if (!initStarted) {
    initStarted = true;
    loadServices(rerender);
  }
}
