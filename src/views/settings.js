import { getState, getSettings, updateSettings, updateOrderStatusColor, CURRENCIES, ORDER_STATUSES, BADGE_TONES, getOrderStatusTone } from '../store.js';
import { escapeHtml } from '../format.js';
import { can } from '../permissions.js';
import { refreshLogo } from '../ui.js';

const TONE_LABELS = {
  neutral: 'Серый', info: 'Синий', warning: 'Жёлтый', success: 'Зелёный', danger: 'Красный',
};

export function renderSettings() {
  const settings = getSettings();
  const state = getState();
  const canEdit = can('settings', 'edit');

  return `
    <div class="page-header">
      <h1>Настройки</h1>
    </div>
    <div class="settings-grid">
      <div class="panel">
        <header class="panel__header"><h2>Компания</h2></header>
        <div class="panel__body">
          <form id="settings-form" class="form">
            <label>Название компании<input name="companyName" value="${escapeHtml(settings.companyName)}" required ${canEdit ? '' : 'disabled'} /></label>
            <label>Валюта
              <select name="currency" ${canEdit ? '' : 'disabled'}>
                ${CURRENCIES.map((c) => `<option value="${escapeHtml(c)}" ${c === settings.currency ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
              </select>
            </label>
            <label>
              Буфер между этапами, дней
              <input name="stageBufferDays" type="number" min="1" max="30" value="${settings.stageBufferDays}" ${canEdit ? '' : 'disabled'} />
            </label>
            <p class="form-hint">Буфер используется при создании нового заказа для расчёта дедлайна каждого из 11 этапов пайплайна.</p>
            ${canEdit ? `
              <div class="form-actions">
                <button type="submit" class="btn btn--primary">Сохранить</button>
              </div>
            ` : ''}
          </form>

          <div class="logo-settings">
            <label>Логотип (в шапке сайта)</label>
            <div class="logo-settings__row">
              ${settings.logoUrl
                ? `<img src="${escapeHtml(settings.logoUrl)}" alt="Логотип" class="logo-settings__preview" />`
                : '<div class="logo-settings__preview logo-settings__preview--empty"><i class="fa-solid fa-image"></i></div>'}
              ${canEdit ? `
                <div class="logo-settings__actions">
                  <label class="btn btn--sm" for="logo-upload">Загрузить</label>
                  <input type="file" id="logo-upload" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden />
                  ${settings.logoUrl ? '<button type="button" class="btn btn--sm btn--danger-ghost" id="logo-remove">Удалить</button>' : ''}
                </div>
              ` : ''}
            </div>
            <p class="form-hint">PNG, JPG, SVG или WebP, до 1 МБ.</p>
          </div>
        </div>
      </div>

      <div class="panel">
        <header class="panel__header"><h2>Цвета статусов заказа</h2></header>
        <div class="panel__body">
          <p class="form-hint">Выберите цвет бейджа для каждого статуса заказа.</p>
          <div class="status-color-list">
            ${ORDER_STATUSES.map((status) => `
              <div class="status-color-row">
                <span class="badge badge--tone-${getOrderStatusTone(status)}">${escapeHtml(status)}</span>
                <select data-action="status-color" data-status="${escapeHtml(status)}" ${canEdit ? '' : 'disabled'}>
                  ${BADGE_TONES.map((tone) => `<option value="${tone}" ${tone === getOrderStatusTone(status) ? 'selected' : ''}>${TONE_LABELS[tone]}</option>`).join('')}
                </select>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="panel">
        <header class="panel__header"><h2>Данные</h2></header>
        <div class="panel__body">
          <div class="settings-stats">
            <div><span>Заказы</span><b>${state.orders.length}</b></div>
            <div><span>Задачи</span><b>${state.tasks.length}</b></div>
            <div><span>Переделки</span><b>${state.rework.length}</b></div>
            <div><span>Партнёры</span><b>${state.partners.length}</b></div>
            <div><span>Сотрудники</span><b>${state.employees.length}</b></div>
          </div>
          <p class="form-hint">Данные хранятся на сервере (PostgreSQL) и доступны всем сотрудникам, вошедшим в систему.</p>
        </div>
      </div>
    </div>
  `;
}

export function attachSettingsHandlers(root, rerender) {
  const form = root.querySelector('#settings-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      updateSettings({
        companyName: fd.get('companyName'),
        currency: fd.get('currency'),
        stageBufferDays: Number(fd.get('stageBufferDays')) || 3,
      });
      rerender();
    });
  }

  root.querySelectorAll('[data-action="status-color"]').forEach((select) => {
    select.addEventListener('change', () => {
      updateOrderStatusColor(select.getAttribute('data-status'), select.value);
      rerender();
    });
  });

  const logoInput = root.querySelector('#logo-upload');
  if (logoInput) {
    logoInput.addEventListener('change', () => {
      const file = logoInput.files?.[0];
      if (!file) return;
      if (file.size > 1024 * 1024) {
        window.alert('Файл слишком большой — максимум 1 МБ.');
        logoInput.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        updateSettings({ logoUrl: reader.result });
        refreshLogo();
        rerender();
      };
      reader.readAsDataURL(file);
    });
  }

  const logoRemove = root.querySelector('#logo-remove');
  if (logoRemove) {
    logoRemove.addEventListener('click', () => {
      updateSettings({ logoUrl: null });
      refreshLogo();
      rerender();
    });
  }
}
