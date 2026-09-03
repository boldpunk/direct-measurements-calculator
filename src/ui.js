import { escapeHtml } from './format.js';

export const NAV_ITEMS = [
  { route: 'dashboard', icon: 'fa-house', label: 'Dashboard' },
  { route: 'orders', icon: 'fa-box-open', label: 'Заказы' },
  { route: 'carpentry', icon: 'fa-hammer', label: 'Столярка' },
  { route: 'rework', icon: 'fa-rotate', label: 'Переделки' },
  { route: 'outsource', icon: 'fa-layer-group', label: 'Аутсорс' },
  { route: 'finance', icon: 'fa-sack-dollar', label: 'Финансы' },
  { route: 'employees', icon: 'fa-users', label: 'Сотрудники' },
  { route: 'settings', icon: 'fa-gear', label: 'Настройки' },
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
        <input type="search" id="global-search" placeholder="Поиск заказа, задачи, партнёра..." autocomplete="off" />
        <div class="search-results" id="search-results" hidden></div>
      </div>
      <div class="topbar__profile">
        <button type="button" class="topbar__avatar" id="profile-toggle" title="Профиль" aria-haspopup="true">
          <i class="fa-solid fa-user"></i>
        </button>
        <div class="profile-menu" id="profile-menu" hidden>
          <a href="#/settings" class="profile-menu__item"><i class="fa-solid fa-gear"></i> Настройки</a>
          <a href="#/employees" class="profile-menu__item"><i class="fa-solid fa-users"></i> Сотрудники</a>
        </div>
      </div>
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

export function initProfileMenu() {
  const toggle = document.getElementById('profile-toggle');
  const menu = document.getElementById('profile-menu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  menu.addEventListener('click', () => { menu.hidden = true; });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('.topbar__profile')) menu.hidden = true;
  });
}

export function selectOptions(items, valueKey, labelKey, selected) {
  return `<option value="">—</option>` + items.map((it) => `
    <option value="${escapeHtml(it[valueKey])}" ${it[valueKey] === selected ? 'selected' : ''}>${escapeHtml(it[labelKey])}</option>
  `).join('');
}

export function kpiCard(icon, tone, title, valueHtml, href) {
  const tag = href ? 'a' : 'div';
  return `
    <${tag} class="kpi kpi--${tone}"${href ? ` href="${href}"` : ''}>
      <div class="kpi__icon"><i class="fa-solid ${icon}"></i></div>
      <div class="kpi__body">
        <div class="kpi__title">${title}</div>
        <div class="kpi__value">${valueHtml}</div>
      </div>
      ${href ? '<i class="fa-solid fa-chevron-right kpi__chevron"></i>' : ''}
    </${tag}>
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
