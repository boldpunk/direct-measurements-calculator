import { getState, getSettings, updateSettings, CURRENCIES } from '../store.js';
import { escapeHtml } from '../format.js';
import { can } from '../permissions.js';

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
}
