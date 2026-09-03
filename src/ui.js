import { escapeHtml } from './format.js';

export const NAV_ITEMS = [
  { route: 'dashboard', icon: 'fa-house', label: 'Dashboard' },
  { route: 'orders', icon: 'fa-box-open', label: 'Заказы' },
  { route: 'carpentry', icon: 'fa-hammer', label: 'Столярка' },
  { route: 'rework', icon: 'fa-rotate', label: 'Переделки' },
  { route: 'outsource', icon: 'fa-layer-group', label: 'Аутсорс' },
  { route: 'finance', icon: 'fa-sack-dollar', label: 'Финансы' },
  { route: 'employees', icon: 'fa-users', label: 'Сотрудники' },
];

export function renderShell(currentRoute) {
  return `
    <header class="topbar">
      <a href="#/dashboard" class="logo">
        <span class="logo__icon"><i class="fa-solid fa-cubes-stacked"></i></span>
        <span class="logo__text">MebelFlow</span>
      </a>
      <div class="topbar__search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" id="global-search" placeholder="Поиск заказа, задачи, партнёра..." />
      </div>
      <div class="topbar__avatar" title="Профиль"><i class="fa-solid fa-user"></i></div>
    </header>
    <div class="app-body">
      <aside class="sidebar">
        <nav>
          <ul class="sidebar__list">
            ${NAV_ITEMS.map((item) => `
              <li>
                <a href="#/${item.route}" class="sidebar__link ${currentRoute === item.route ? 'is-active' : ''}">
                  <i class="fa-solid ${item.icon}"></i>
                  <span>${item.label}</span>
                </a>
              </li>
            `).join('')}
          </ul>
        </nav>
      </aside>
      <main class="content" id="view-root"></main>
    </div>
    <div class="modal-overlay" id="modal-overlay" hidden>
      <div class="modal" id="modal-body"></div>
    </div>
  `;
}

export function openModal(titleHtml, bodyHtml) {
  const overlay = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');
  body.innerHTML = `
    <div class="modal__header">
      <h3>${titleHtml}</h3>
      <button type="button" class="modal__close" data-action="close-modal"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="modal__content">${bodyHtml}</div>
  `;
  overlay.hidden = false;
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.hidden = true;
}

export function initModalHandlers() {
  const overlay = document.getElementById('modal-overlay');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-action="close-modal"]')) {
      closeModal();
    }
  });
}

export function selectOptions(items, valueKey, labelKey, selected) {
  return `<option value="">—</option>` + items.map((it) => `
    <option value="${escapeHtml(it[valueKey])}" ${it[valueKey] === selected ? 'selected' : ''}>${escapeHtml(it[labelKey])}</option>
  `).join('');
}

export function kpiCard(icon, tone, title, valueHtml) {
  return `
    <div class="kpi kpi--${tone}">
      <div class="kpi__icon"><i class="fa-solid ${icon}"></i></div>
      <div class="kpi__body">
        <div class="kpi__title">${title}</div>
        <div class="kpi__value">${valueHtml}</div>
      </div>
    </div>
  `;
}

export function card(numberBadge, title, innerHtml, extraClass = '') {
  return `
    <section class="panel ${extraClass}">
      <header class="panel__header">
        ${numberBadge ? `<span class="panel__badge">${numberBadge}</span>` : ''}
        <h2>${title}</h2>
      </header>
      <div class="panel__body">${innerHtml}</div>
    </section>
  `;
}
