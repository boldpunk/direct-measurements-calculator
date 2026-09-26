// Коммерческие предложения.
//
// Proposals live outside the hydrated store (their items carry base64
// images, which would bloat /api/state), so this view keeps its own small
// cache and loads through the dedicated /api/proposals endpoints — same
// approach as the Склад views.
//
// "Предпросмотр" deliberately renders the real server PDF in an iframe
// rather than an HTML mock-up: that way what the manager checks is exactly
// what the client receives.

import { getState, UNITS } from '../store.js';
import { money, shortDate, escapeHtml, brandLogoSrc } from '../format.js';
import { can } from '../permissions.js';
import { openModal, closeModal, selectOptions } from '../ui.js';
import { api } from '../api.js';
import { renderImagePicker, attachImagePicker } from '../image-picker.js';

const STATUSES = ['Черновик', 'Готово', 'Отправлено', 'Принято', 'Отклонено', 'Архив'];
const STATUS_TONE = {
  'Черновик': 'neutral', 'Готово': 'info', 'Отправлено': 'warning',
  'Принято': 'success', 'Отклонено': 'danger', 'Архив': 'neutral',
};
const LANGUAGES = [{ code: 'ru', label: 'Русский' }, { code: 'uz', label: "O'zbekcha" }];
const CURRENCIES = ['$', "so'm", '€'];
const THEME_PRESETS = ['#E8913A', '#2F6FED', '#16A34A', '#9333EA', '#DC2626', '#0F172A'];

let listCache = null;
let detail = null;
let templates = null;
let brands = [];
// Distinguishes "склад ещё не заполнен" from "этому сотруднику склад не
// виден": an empty list is worth explaining, a failed request isn't.
let brandsUnavailable = false;
let selectedId = null;
let statusFilter = '';
let query = '';
let loadingError = '';

export function openProposal(id) {
  selectedId = id;
  detail = null;
}

async function ensureData(rerender) {
  if (listCache && (!selectedId || detail?.id === selectedId)) return;
  try {
    if (!listCache) {
      const [list, tpl, brandList] = await Promise.all([
        api.getProposals(),
        api.getProposalTemplates().catch(() => []),
        api.getStockBrands().catch(() => { brandsUnavailable = true; return []; }),
      ]);
      listCache = list;
      templates = tpl;
      brands = brandList;
    }
    if (selectedId && detail?.id !== selectedId) {
      detail = await api.getProposal(selectedId);
    }
    loadingError = '';
  } catch (e) {
    loadingError = e.message || 'Не удалось загрузить данные';
  }
  rerender();
}

function refreshAfterChange(rerender) {
  listCache = null;
  detail = null;
  rerender();
}

// ---- List ----

function renderList() {
  const rows = (listCache || [])
    .filter((p) => !statusFilter || p.status === statusFilter)
    .filter((p) => {
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return [p.number, p.clientName, p.projectName].some((v) => String(v || '').toLowerCase().includes(q));
    })
    .map((p) => `
      <tr data-open="${p.id}">
        <td><b>${escapeHtml(p.number)}</b></td>
        <td>${shortDate(p.date)}</td>
        <td>${escapeHtml(p.clientName || '—')}</td>
        <td>${escapeHtml(p.projectName || '—')}</td>
        <td>${money(p.total, p.currency)}</td>
        <td>${p.language === 'uz' ? "O'zbekcha" : 'Русский'}</td>
        <td><span class="badge badge--tone-${STATUS_TONE[p.status] || 'neutral'}">${escapeHtml(p.status)}</span></td>
        <td class="table-actions">
          ${can('proposals', 'pdf') ? `<button type="button" class="btn btn--sm" data-pdf="${p.id}" title="PDF"><i class="fa-solid fa-file-pdf"></i></button>` : ''}
          ${can('proposals', 'create') ? `<button type="button" class="btn btn--sm" data-duplicate="${p.id}" title="Дублировать"><i class="fa-solid fa-copy"></i></button>` : ''}
          ${can('proposals', 'delete') ? `<button type="button" class="btn btn--sm btn--danger-ghost" data-delete="${p.id}" title="Удалить"><i class="fa-solid fa-trash"></i></button>` : ''}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="8" class="empty-state">Коммерческих предложений нет</td></tr>';

  return `
    <div class="page-header">
      <h1>Коммерческие предложения</h1>
      ${can('proposals', 'create') ? '<button type="button" class="btn btn--primary" id="new-proposal"><i class="fa-solid fa-plus"></i> Создать КП</button>' : ''}
    </div>
    ${loadingError ? `<div class="empty-state">${escapeHtml(loadingError)}</div>` : ''}
    <div class="orders-toolbar">
      <select id="proposal-status-filter">
        <option value="">Все статусы</option>
        ${STATUSES.map((s) => `<option value="${s}" ${s === statusFilter ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <div class="orders-toolbar__search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" id="proposal-search" placeholder="Номер, клиент, проект" value="${escapeHtml(query)}" autocomplete="off" />
      </div>
      ${can('proposals', 'templates') ? '<button type="button" class="btn" id="manage-templates"><i class="fa-solid fa-align-left"></i> Шаблоны текстов</button>' : ''}
    </div>
    <div class="panel">
      <div class="panel__body" style="padding:0; overflow-x:auto">
        <table class="data-table">
          <thead>
            <tr><th>№ КП</th><th>Дата</th><th>Клиент</th><th>Проект</th><th>Сумма</th><th>Язык</th><th>Статус</th><th></th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ---- Editor ----

function renderItemCard(item, index, total, canEdit) {
  return `
    <div class="proposal-item" data-item="${item.id}">
      <div class="proposal-item__media">
        ${renderImagePicker(`img-${item.id}`, item.imageUrl || '')}
      </div>
      <div class="proposal-item__fields">
        <label>Название изделия
          <input type="text" data-field="name" value="${escapeHtml(item.name || '')}" ${canEdit ? '' : 'disabled'} />
        </label>
        <label>Описание
          <textarea data-field="description" rows="4" placeholder="Корпус: MDF&#10;Фасад: шпон&#10;Фурнитура: Blum" ${canEdit ? '' : 'disabled'}>${escapeHtml(item.description || '')}</textarea>
        </label>
        <label>Размеры
          <input type="text" data-field="dimensions" placeholder="2200 × 600 × 2400 мм" value="${escapeHtml(item.dimensions || '')}" ${canEdit ? '' : 'disabled'} />
        </label>
        <div class="proposal-item__numbers">
          <label>Кол-во
            <input type="number" data-field="quantity" min="0.01" step="0.01" value="${item.quantity}" ${canEdit ? '' : 'disabled'} />
          </label>
          <label>Ед.
            <select data-field="unit" ${canEdit ? '' : 'disabled'}>
              ${UNITS.map((u) => `<option ${u === item.unit ? 'selected' : ''}>${u}</option>`).join('')}
            </select>
          </label>
          <label>Цена за ед.
            <input type="number" data-field="unitPrice" min="0" step="0.01" value="${item.unitPrice}" ${canEdit ? '' : 'disabled'} />
          </label>
          <div class="proposal-item__sum"><span>Сумма</span><b>${money(item.total, detail?.currency)}</b></div>
        </div>
      </div>
      ${canEdit ? `
        <div class="proposal-item__actions">
          <button type="button" class="btn btn--sm" data-move="up" ${index === 0 ? 'disabled' : ''} title="Выше"><i class="fa-solid fa-arrow-up"></i></button>
          <button type="button" class="btn btn--sm" data-move="down" ${index === total - 1 ? 'disabled' : ''} title="Ниже"><i class="fa-solid fa-arrow-down"></i></button>
          <button type="button" class="btn btn--sm btn--danger-ghost" data-remove-item title="Удалить"><i class="fa-solid fa-trash"></i></button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderEditor() {
  const p = detail;
  const state = getState();
  const canEdit = can('proposals', 'edit');
  const activeTemplates = (templates || []).filter((t) => t.active && t.language === p.language);

  return `
    <div class="page-header">
      <div>
        <h1>${escapeHtml(p.number)} <span class="badge badge--tone-${STATUS_TONE[p.status] || 'neutral'}">${escapeHtml(p.status)}</span></h1>
        <span class="row-item__sub">${escapeHtml(p.clientName || 'Клиент не выбран')}${p.projectName ? ` · ${escapeHtml(p.projectName)}` : ''}</span>
      </div>
      <div class="table-actions">
        <button type="button" class="btn" id="back-to-list"><i class="fa-solid fa-arrow-left"></i> К списку</button>
        ${can('proposals', 'pdf') ? '<button type="button" class="btn" id="preview-pdf"><i class="fa-solid fa-eye"></i> Предпросмотр</button>' : ''}
        ${can('proposals', 'pdf') ? '<button type="button" class="btn btn--primary" id="download-pdf"><i class="fa-solid fa-file-pdf"></i> Скачать PDF</button>' : ''}
        ${can('proposals', 'pdf') ? '<button type="button" class="btn" id="print-pdf"><i class="fa-solid fa-print"></i> Печать</button>' : ''}
      </div>
    </div>

    <div class="panel">
      <header class="panel__header"><h2>Параметры</h2></header>
      <div class="panel__body">
        <div class="proposal-grid">
          <label>Клиент
            <select data-prop="clientId" ${canEdit ? '' : 'disabled'}>${selectOptions(state.clients, 'id', 'name', p.clientId || '')}</select>
          </label>
          <label>Название проекта
            <input type="text" data-prop="projectName" value="${escapeHtml(p.projectName || '')}" ${canEdit ? '' : 'disabled'} />
          </label>
          <label>КП подготовил
            <select data-prop="responsibleId" ${canEdit ? '' : 'disabled'}>${selectOptions(state.employees, 'id', 'name', p.responsibleId || '')}</select>
          </label>
          <label>Дата
            <input type="date" data-prop="date" value="${escapeHtml(p.date || '')}" ${canEdit ? '' : 'disabled'} />
          </label>
          <label>Язык
            <select data-prop="language" ${canEdit ? '' : 'disabled'}>
              ${LANGUAGES.map((l) => `<option value="${l.code}" ${l.code === p.language ? 'selected' : ''}>${l.label}</option>`).join('')}
            </select>
          </label>
          <label>Валюта
            <select data-prop="currency" ${canEdit ? '' : 'disabled'}>
              ${CURRENCIES.map((c) => `<option ${c === p.currency ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </label>
          <label>Срок изготовления
            <input type="text" data-prop="deadline" placeholder="30 рабочих дней" value="${escapeHtml(p.deadline || '')}" ${canEdit ? '' : 'disabled'} />
          </label>
          <label>Статус
            <select data-prop="status" ${canEdit ? '' : 'disabled'}>
              ${STATUSES.map((s) => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </label>
        </div>

        <div class="proposal-theme">
          <span class="proposal-theme__label">Цвет оформления</span>
          <div class="proposal-theme__swatches">
            ${THEME_PRESETS.map((c) => `
              <button type="button" class="proposal-theme__swatch ${c.toLowerCase() === String(p.themeColor).toLowerCase() ? 'is-active' : ''}"
                data-theme="${c}" style="background:${c}" title="${c}" ${canEdit ? '' : 'disabled'}></button>
            `).join('')}
            <input type="color" id="theme-custom" value="${escapeHtml(p.themeColor || '#E8913A')}" ${canEdit ? '' : 'disabled'} title="Свой цвет" />
          </div>
        </div>

        ${!brands.length ? (brandsUnavailable ? '' : `
          <div class="proposal-brands">
            <span class="proposal-theme__label">Бренды проекта</span>
            <p class="form-hint">
              Брендов пока нет.${can('stock', 'view') ? ' Добавьте их в «Склад → Справочники → Бренды» — логотипы известных брендов подставятся в КП сами.' : ''}
            </p>
          </div>
        `) : `
          <div class="proposal-brands">
            <span class="proposal-theme__label">Бренды проекта</span>
            <div class="checkbox-row">
              ${brands.map((b) => {
                const logo = brandLogoSrc(b);
                return `
                <label class="checkbox-label brand-check">
                  <input type="checkbox" data-brand="${b.id}" ${p.brandIds.includes(b.id) ? 'checked' : ''} ${canEdit ? '' : 'disabled'} />
                  ${logo ? `<img src="${escapeHtml(logo)}" alt="" class="brand-check__logo" onerror="this.remove()" />` : ''}
                  ${escapeHtml(b.name)}
                </label>
              `; }).join('')}
            </div>
          </div>
        `}
      </div>
    </div>

    <div class="panel">
      <header class="panel__header">
        <h2>Изделия</h2>
        ${canEdit ? '<button type="button" class="btn btn--sm btn--primary" id="add-item"><i class="fa-solid fa-plus"></i> Добавить изделие</button>' : ''}
      </header>
      <div class="panel__body">
        ${p.items.length
          ? p.items.map((item, i) => renderItemCard(item, i, p.items.length, canEdit)).join('')
          : '<div class="empty-state">Изделия не добавлены</div>'}
        <div class="section-totals proposal-total">
          <span>Итого: <b>${money(p.total, p.currency)}</b></span>
        </div>
      </div>
    </div>

    <div class="panel">
      <header class="panel__header">
        <h2>Финальный текст</h2>
        ${can('proposals', 'templates') ? '<button type="button" class="btn btn--sm" id="save-template">Сохранить как шаблон</button>' : ''}
      </header>
      <div class="panel__body">
        ${activeTemplates.length ? `
          <label>Выбрать из библиотеки
            <select id="template-pick">
              <option value="">— не выбрано —</option>
              ${activeTemplates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
            </select>
          </label>
        ` : ''}
        <label>Текст
          <textarea data-prop="finalText" rows="3" placeholder="Спасибо за доверие! Мы будем рады реализовать этот проект для вас." ${canEdit ? '' : 'disabled'}>${escapeHtml(p.finalText || '')}</textarea>
        </label>
      </div>
    </div>
  `;
}

export function renderProposals() {
  if (!listCache) return '<div class="app-loading"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка...</div>';
  if (selectedId && !detail) return '<div class="app-loading"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка...</div>';
  return selectedId && detail ? renderEditor() : renderList();
}

// ---- Handlers ----

async function openPdf(id, { print = false, preview = false } = {}) {
  const blob = await api.getProposalPdfBlob(id);
  const url = URL.createObjectURL(blob);
  if (preview) {
    openModal('Предпросмотр', `<iframe src="${url}" class="pdf-preview" title="Предпросмотр КП"></iframe>`);
    return;
  }
  const win = window.open(url, '_blank');
  if (print && win) win.addEventListener('load', () => win.print(), { once: true });
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

function attachListHandlers(root, rerender) {
  root.querySelector('#new-proposal')?.addEventListener('click', () => openCreateModal(rerender));

  root.querySelector('#proposal-status-filter')?.addEventListener('change', (e) => {
    statusFilter = e.target.value;
    rerender();
  });
  root.querySelector('#proposal-search')?.addEventListener('input', (e) => {
    query = e.target.value;
    rerender();
  });
  root.querySelector('#manage-templates')?.addEventListener('click', () => openTemplatesModal(rerender));

  root.querySelectorAll('[data-open]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openProposal(row.getAttribute('data-open'));
      rerender();
    });
  });

  root.querySelectorAll('[data-pdf]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await openPdf(btn.getAttribute('data-pdf'));
      } catch (e) {
        window.alert(e.message || 'Не удалось сформировать PDF');
      }
    });
  });

  root.querySelectorAll('[data-duplicate]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const copy = await api.duplicateProposal(btn.getAttribute('data-duplicate'));
        listCache = null;
        openProposal(copy.id);
        rerender();
      } catch (e) {
        window.alert(e.message || 'Не удалось дублировать КП');
      }
    });
  });

  root.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!window.confirm('Удалить коммерческое предложение?')) return;
      try {
        await api.deleteProposal(btn.getAttribute('data-delete'));
        refreshAfterChange(rerender);
      } catch (e) {
        window.alert(e.message || 'Не удалось удалить КП');
      }
    });
  });
}

function attachEditorHandlers(root, rerender) {
  const id = detail.id;

  const patch = async (body) => {
    try {
      detail = await api.updateProposal(id, body);
      listCache = null;
      rerender();
    } catch (e) {
      window.alert(e.message || 'Не удалось сохранить');
    }
  };

  root.querySelector('#back-to-list')?.addEventListener('click', () => {
    selectedId = null;
    detail = null;
    rerender();
  });

  root.querySelector('#preview-pdf')?.addEventListener('click', async () => {
    try { await openPdf(id, { preview: true }); } catch (e) { window.alert(e.message); }
  });
  root.querySelector('#download-pdf')?.addEventListener('click', async () => {
    try { await openPdf(id); } catch (e) { window.alert(e.message); }
  });
  root.querySelector('#print-pdf')?.addEventListener('click', async () => {
    try { await openPdf(id, { print: true }); } catch (e) { window.alert(e.message); }
  });

  // Header fields save on change (i.e. on blur / commit), not per keystroke.
  root.querySelectorAll('[data-prop]').forEach((input) => {
    input.addEventListener('change', () => patch({ [input.getAttribute('data-prop')]: input.value }));
  });

  root.querySelectorAll('[data-theme]').forEach((btn) => {
    btn.addEventListener('click', () => patch({ themeColor: btn.getAttribute('data-theme') }));
  });
  root.querySelector('#theme-custom')?.addEventListener('change', (e) => patch({ themeColor: e.target.value }));

  const brandBoxes = [...root.querySelectorAll('[data-brand]')];
  brandBoxes.forEach((box) => {
    box.addEventListener('change', () => {
      patch({ brandIds: brandBoxes.filter((b) => b.checked).map((b) => b.getAttribute('data-brand')) });
    });
  });

  root.querySelector('#template-pick')?.addEventListener('change', (e) => {
    const tpl = (templates || []).find((t) => t.id === e.target.value);
    // Copies the template's text into this proposal only — the stored
    // template itself is never touched by later edits here.
    if (tpl) patch({ finalText: tpl.text });
  });

  root.querySelector('#save-template')?.addEventListener('click', () => openSaveTemplateModal(detail, rerender));

  root.querySelector('#add-item')?.addEventListener('click', async () => {
    try {
      await api.addProposalItem(id, { name: 'Новое изделие', quantity: 1, unit: 'шт.', unitPrice: 0 });
      detail = await api.getProposal(id);
      listCache = null;
      rerender();
    } catch (e) {
      window.alert(e.message || 'Не удалось добавить изделие');
    }
  });

  root.querySelectorAll('[data-item]').forEach((card) => {
    const itemId = card.getAttribute('data-item');

    const patchItem = async (body) => {
      try {
        await api.updateProposalItem(id, itemId, body);
        detail = await api.getProposal(id);
        listCache = null;
        rerender();
      } catch (e) {
        window.alert(e.message || 'Не удалось сохранить изделие');
      }
    };

    card.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('change', () => patchItem({ [input.getAttribute('data-field')]: input.value }));
    });

    attachImagePicker(card, `img-${itemId}`, (imageUrl) => patchItem({ imageUrl }));

    card.querySelector('[data-remove-item]')?.addEventListener('click', async () => {
      if (!window.confirm('Удалить изделие?')) return;
      try {
        await api.deleteProposalItem(id, itemId);
        detail = await api.getProposal(id);
        listCache = null;
        rerender();
      } catch (e) {
        window.alert(e.message || 'Не удалось удалить изделие');
      }
    });

    card.querySelectorAll('[data-move]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ids = detail.items.map((i) => i.id);
        const from = ids.indexOf(itemId);
        const to = btn.getAttribute('data-move') === 'up' ? from - 1 : from + 1;
        if (to < 0 || to >= ids.length) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        try {
          await api.reorderProposalItems(id, ids);
          detail = await api.getProposal(id);
          rerender();
        } catch (e) {
          window.alert(e.message || 'Не удалось изменить порядок');
        }
      });
    });
  });
}

export function attachProposalsHandlers(root, rerender) {
  if (!listCache || (selectedId && !detail)) {
    ensureData(rerender);
    return;
  }
  if (selectedId && detail) attachEditorHandlers(root, rerender);
  else attachListHandlers(root, rerender);
}

// ---- Modals ----

function openCreateModal(rerender) {
  const state = getState();
  openModal('Новое коммерческое предложение', `
    <form id="proposal-form" class="form">
      <label>Клиент<select name="clientId" required>${selectOptions(state.clients, 'id', 'name', '')}</select></label>
      <label>Название проекта<input name="projectName" placeholder="напр. Дом на Юнусабаде" /></label>
      <label>КП подготовил<select name="responsibleId">${selectOptions(state.employees, 'id', 'name', '')}</select></label>
      <label>Язык
        <select name="language">${LANGUAGES.map((l) => `<option value="${l.code}">${l.label}</option>`).join('')}</select>
      </label>
      <label>Валюта<select name="currency">${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label>Срок изготовления<input name="deadline" placeholder="30 рабочих дней" /></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Создать</button>
      </div>
    </form>
  `);
  document.getElementById('proposal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const created = await api.createProposal({
        clientId: fd.get('clientId'), projectName: fd.get('projectName'),
        responsibleId: fd.get('responsibleId'), language: fd.get('language'),
        currency: fd.get('currency'), deadline: fd.get('deadline'),
      });
      closeModal();
      listCache = null;
      openProposal(created.id);
      rerender();
    } catch (err) {
      window.alert(err.message || 'Не удалось создать КП');
      submitBtn.disabled = false;
    }
  });
}

function openSaveTemplateModal(proposal, rerender) {
  openModal('Сохранить текст как шаблон', `
    <form id="template-form" class="form">
      <label>Название<input name="name" required placeholder="напр. Стандартное завершение" /></label>
      <label>Язык
        <select name="language">
          ${LANGUAGES.map((l) => `<option value="${l.code}" ${l.code === proposal.language ? 'selected' : ''}>${l.label}</option>`).join('')}
        </select>
      </label>
      <label>Текст<textarea name="text" rows="4" required>${escapeHtml(proposal.finalText || '')}</textarea></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Сохранить</button>
      </div>
    </form>
  `);
  document.getElementById('template-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.createProposalTemplate({ name: fd.get('name'), language: fd.get('language'), text: fd.get('text') });
      templates = await api.getProposalTemplates();
      closeModal();
      rerender();
    } catch (err) {
      window.alert(err.message || 'Не удалось сохранить шаблон');
    }
  });
}

function openTemplatesModal(rerender) {
  const rows = (templates || []).map((t) => `
    <div class="mat-row">
      <span class="mat-row__name">
        <b>${escapeHtml(t.name)}</b> <span class="badge badge--muted">${t.language === 'uz' ? "O'zbekcha" : 'Русский'}</span>
        <div class="row-item__sub">${escapeHtml(t.text.slice(0, 120))}${t.text.length > 120 ? '…' : ''}</div>
      </span>
      <button type="button" class="mat-row__remove" data-del-template="${t.id}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>
    </div>
  `).join('') || '<div class="empty-state empty-state--sm">Шаблонов нет</div>';

  openModal('Библиотека текстов', `<div class="mat-rows">${rows}</div>`);
  document.querySelectorAll('[data-del-template]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.deleteProposalTemplate(btn.getAttribute('data-del-template'));
        templates = await api.getProposalTemplates();
        closeModal();
        rerender();
      } catch (e) {
        window.alert(e.message || 'Не удалось удалить шаблон');
      }
    });
  });
}
