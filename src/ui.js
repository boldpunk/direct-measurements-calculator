import { escapeHtml } from './format.js';
import { can, canAny } from './permissions.js';

export const NAV_ITEMS = [
  { route: 'dashboard', icon: 'fa-house', label: 'Главная', guard: () => true },
  { route: 'orders', icon: 'fa-box-open', label: 'Заказы', guard: () => can('orders', 'view') },
  { route: 'clients', icon: 'fa-address-book', label: 'Клиенты', guard: () => can('clients', 'view') },
  { route: 'production', icon: 'fa-diagram-project', label: 'Производство', guard: () => can('production', 'view') },
  { route: 'carpentry', icon: 'fa-hammer', label: 'Столярка', guard: () => can('carpentry', 'view') },
  { route: 'rework', icon: 'fa-rotate', label: 'Переделки', guard: () => can('rework', 'view') },
  { route: 'tasks', icon: 'fa-list-check', label: 'Задачи', guard: () => can('tasks', 'view') },
  { route: 'outsource', icon: 'fa-layer-group', label: 'Аутсорс', guard: () => can('outsource', 'view') },
  { route: 'finance', icon: 'fa-sack-dollar', label: 'Финансы', guard: () => can('finance', 'view') },
  { route: 'employees', icon: 'fa-users', label: 'Сотрудники', guard: () => canAny('employees') },
  { route: 'audit-log', icon: 'fa-clock-rotate-left', label: 'Журнал действий', guard: () => can('settings', 'manageRoles') },
  { route: 'settings', icon: 'fa-gear', label: 'Настройки', guard: () => canAny('settings') },
];

export const BOTTOM_NAV_ITEMS = [
  { route: 'dashboard', icon: 'fa-house', label: 'Главная', guard: () => true },
  { route: 'orders', icon: 'fa-box-open', label: 'Заказы', guard: () => can('orders', 'view') },
  { route: 'production', icon: 'fa-diagram-project', label: 'Производство', guard: () => can('production', 'view') },
  { route: 'tasks', icon: 'fa-list-check', label: 'Задачи', guard: () => can('tasks', 'view') },
];

export function visibleNavItems(items) {
  return items.filter((item) => item.guard());
}

export function renderShell(currentRoute) {
  const navItems = visibleNavItems(NAV_ITEMS);
  const bottomItems = visibleNavItems(BOTTOM_NAV_ITEMS);
  return `
    <header class="topbar">
      <button type="button" class="menu-toggle" id="menu-toggle" aria-label="Открыть меню" aria-haspopup="true">
        <i class="fa-solid fa-bars"></i>
      </button>
      <a href="#/dashboard" class="logo">
        <span class="logo__icon"><i class="fa-solid fa-cubes-stacked"></i></span>
        <span class="logo__text">MebelFlow</span>
      </a>
      <div class="topbar__search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" id="global-search" placeholder="Поиск заказа, задачи, партнёра..." autocomplete="off" />
        <div class="search-results" id="search-results" hidden></div>
      </div>
      <div class="notif-wrap">
        <button type="button" class="topbar__avatar" id="notif-toggle" title="Уведомления" aria-haspopup="true">
          <i class="fa-solid fa-bell"></i>
          <span class="notif-badge" id="notif-badge" hidden>0</span>
        </button>
        <div class="notif-panel" id="notif-panel" hidden></div>
      </div>
      <div class="topbar__profile">
        <button type="button" class="topbar__avatar" id="profile-toggle" title="Профиль" aria-haspopup="true">
          <i class="fa-solid fa-user"></i>
        </button>
        <div class="profile-menu" id="profile-menu" hidden>
          ${canAny('settings') ? '<a href="#/settings" class="profile-menu__item"><i class="fa-solid fa-gear"></i> Настройки</a>' : ''}
          ${canAny('employees') ? '<a href="#/employees" class="profile-menu__item"><i class="fa-solid fa-users"></i> Сотрудники</a>' : ''}
          <button type="button" class="profile-menu__item" id="logout-btn"><i class="fa-solid fa-right-from-bracket"></i> Выйти</button>
        </div>
      </div>
    </header>
    <div class="app-body">
      <div class="sidebar-backdrop" id="sidebar-backdrop" hidden></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar__mobile-header">
          <span class="logo__text">MebelFlow</span>
          <button type="button" class="sidebar__close" id="sidebar-close" aria-label="Закрыть меню"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <nav>
          <ul class="sidebar__list">
            ${navItems.map((item) => `
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
    <nav class="bottom-nav">
      ${bottomItems.map((item) => `
        <a href="#/${item.route}" class="bottom-nav__link ${currentRoute === item.route ? 'is-active' : ''}">
          <i class="fa-solid ${item.icon}"></i>
          <span>${item.label}</span>
        </a>
      `).join('')}
      <button type="button" class="bottom-nav__link" id="bottom-nav-more">
        <i class="fa-solid fa-ellipsis"></i>
        <span>Ещё</span>
      </button>
    </nav>
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

export function initSidebarToggle() {
  const toggle = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const closeBtn = document.getElementById('sidebar-close');
  if (!toggle || !sidebar || !backdrop) return;

  function open() {
    sidebar.classList.add('is-open');
    backdrop.hidden = false;
  }
  function close() {
    sidebar.classList.remove('is-open');
    backdrop.hidden = true;
  }

  toggle.addEventListener('click', () => {
    if (sidebar.classList.contains('is-open')) close(); else open();
  });
  backdrop.addEventListener('click', close);
  if (closeBtn) closeBtn.addEventListener('click', close);
  sidebar.addEventListener('click', (e) => {
    if (e.target.closest('.sidebar__link')) close();
  });

  const moreBtn = document.getElementById('bottom-nav-more');
  if (moreBtn) moreBtn.addEventListener('click', open);
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
