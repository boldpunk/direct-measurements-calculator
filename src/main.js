// Fonts and icons are bundled rather than pulled from CDNs: the installed
// PWA has to render without network access to third-party hosts, and it
// saves two cross-origin round trips on every cold load. Only the "solid"
// Font Awesome style is used anywhere, so regular/brands aren't shipped.
import '@fontsource/inter/400';
import '@fontsource/inter/500';
import '@fontsource/inter/600';
import '@fontsource/inter/700';
import '@fortawesome/fontawesome-free/css/fontawesome.min.css';
import '@fortawesome/fontawesome-free/css/solid.min.css';
import 'flag-icons/css/flag-icons.min.css';
// Last, so the app's own rules keep precedence over the library CSS above
// (the order these were in when the libraries came from <link> tags).
import '../style.css';
import { openModal, renderShell, initModalHandlers, initProfileMenu, initSidebarToggle, initThemeToggle, applyFavicon, enhanceFields, NAV_ITEMS } from './ui.js';
import { initSearch } from './search.js';
import { startLive, stopLive } from './live.js';
import { initErrorReporter } from './error-reporter.js';

initErrorReporter();
import { can } from './permissions.js';
import { brandLogo } from './brand.js';
import { initNotifications } from './notifications.js';
import { renderDashboard, attachDashboardHandlers } from './views/dashboard.js';
import { renderOrders, attachOrderHandlers } from './views/orders.js';
import { renderClients, attachClientsHandlers } from './views/clients.js';
import { renderProduction, attachProductionHandlers } from './views/production.js';
import { renderCarpentry, attachCarpentryHandlers } from './views/carpentry.js';
import { renderRework, attachReworkHandlers } from './views/rework.js';
import { renderOutsource, attachOutsourceHandlers } from './views/outsource.js';
import { renderFinance, attachFinanceHandlers } from './views/finance.js';
import { renderSalary, attachSalaryHandlers } from './views/salary.js';
import { renderProposals, attachProposalsHandlers } from './views/proposals.js';
import { renderEmployees, attachEmployeesHandlers } from './views/employees.js';
import { renderStock, attachStockHandlers } from './views/stock.js';
import { renderServices, attachServicesHandlers } from './views/services.js';
import { renderSettings, attachSettingsHandlers } from './views/settings.js';
import { renderTasks, attachTasksHandlers } from './views/tasks.js';
import { renderAuditLog, attachAuditLogHandlers } from './views/auditLog.js';
import { renderLogin, attachLoginHandlers } from './views/login.js';
import { api, getToken } from './api.js';
import { initStore, isHydrated, resetStore, setPublicBranding, onStateReplaced } from './store.js';

const ROUTES = {
  dashboard: { render: renderDashboard, attach: attachDashboardHandlers },
  orders: { render: renderOrders, attach: attachOrderHandlers },
  clients: { render: renderClients, attach: attachClientsHandlers },
  production: { render: renderProduction, attach: attachProductionHandlers },
  carpentry: { render: renderCarpentry, attach: attachCarpentryHandlers },
  rework: { render: renderRework, attach: attachReworkHandlers },
  tasks: { render: renderTasks, attach: attachTasksHandlers },
  outsource: { render: renderOutsource, attach: attachOutsourceHandlers },
  finance: { render: renderFinance, attach: attachFinanceHandlers },
  salary: { render: renderSalary, attach: attachSalaryHandlers },
  proposals: { render: renderProposals, attach: attachProposalsHandlers },
  stock: { render: renderStock, attach: attachStockHandlers },
  services: { render: renderServices, attach: attachServicesHandlers },
  employees: { render: renderEmployees, attach: attachEmployeesHandlers },
  settings: { render: renderSettings, attach: attachSettingsHandlers },
  'audit-log': { render: renderAuditLog, attach: attachAuditLogHandlers },
};

let shellMounted = false;

// Fetched once, unauthenticated, so the login screen and browser-tab
// favicon can reflect a custom uploaded logo/favicon before anyone signs
// in. Fired immediately on load rather than awaited, so it never delays
// the login screen appearing — it just patches things in place if it
// resolves after the login screen already rendered.
(async () => {
  try {
    const branding = await api.getBranding();
    setPublicBranding(branding);
    applyFavicon(branding.faviconUrl);
    const loginLogo = document.getElementById('login-logo');
    if (loginLogo && branding.logoUrl) {
      loginLogo.innerHTML = brandLogo(branding.logoUrl, { layout: 'stack', imgClass: 'login-card__logo-img' });
    }
  } catch (e) {
    console.error('Failed to load public branding', e);
  }
})();

// Whole state re-read (a colleague's change, an edit conflict): redraw.
onStateReplaced(() => { if (shellMounted && getToken()) renderApp(); });

// ---- Android app ----
// The app's start screen (public/app.html on mebelflow.uz) opens a company's
// site with ?app=android. Remember that on this origin, so the profile menu
// can offer «Сменить компанию», and drop the parameter from the address.
(function markAndroidApp() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('app') !== 'android') return;
  try { localStorage.setItem('mf_in_app', 'android'); } catch { /* private mode */ }
  history.replaceState(null, '', `${window.location.pathname}${window.location.hash || '#/dashboard'}`);
})();

// ---- Idle auto-logout (30 min) ----
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
let lastActivityAt = Date.now();
let idleCheckHandle = null;
let refreshHandle = null;

function markActivity() {
  lastActivityAt = Date.now();
}

function startIdleWatch() {
  if (idleCheckHandle) return;
  ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach((evt) => {
    window.addEventListener(evt, markActivity, { passive: true });
  });
  lastActivityAt = Date.now();
  idleCheckHandle = setInterval(() => {
    if (Date.now() - lastActivityAt > IDLE_LIMIT_MS) {
      logout({ idle: true });
    }
  }, 30000);
  refreshHandle = setInterval(() => {
    if (Date.now() - lastActivityAt < IDLE_LIMIT_MS) {
      api.refresh().catch(() => {});
    }
  }, REFRESH_INTERVAL_MS);
}

function stopIdleWatch() {
  clearInterval(idleCheckHandle);
  clearInterval(refreshHandle);
  idleCheckHandle = null;
  refreshHandle = null;
}

function routeAllowed(route) {
  const item = NAV_ITEMS.find((i) => i.route === route);
  return item ? item.guard() : false;
}

// "#/orders?status=…" — the part after "?" is page state (filters), not route.
function hashPath() {
  return window.location.hash.replace(/^#\/?/, '').split('?')[0];
}

function currentRoute() {
  const hash = hashPath();
  if (ROUTES[hash] && routeAllowed(hash)) return hash;
  return 'dashboard';
}

function renderApp() {
  const route = currentRoute();
  const requestedHash = hashPath();
  if (route !== requestedHash) {
    history.replaceState(null, '', `#/${route}`);
  }
  const app = document.getElementById('app');

  if (!shellMounted) {
    app.innerHTML = renderShell(route);
    initModalHandlers();
    initSearch(renderApp);
    initProfileMenu(renderApp);
    initThemeToggle();
    initSidebarToggle();
    initNotifications(renderApp);
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    shellMounted = true;
  } else {
    document.querySelectorAll('.sidebar__link, .bottom-nav__link').forEach((link) => {
      const active = link.getAttribute('href') === `#/${route}`;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  const viewRoot = document.getElementById('view-root');
  const view = ROUTES[route];
  // Tab title / history entries show the page, not just the product name.
  const navItem = NAV_ITEMS.find((i) => i.route === route);
  document.title = navItem ? `${navItem.title || navItem.label} · MebelFlow` : 'MebelFlow';

  // Re-rendering replaces the whole subtree, which would otherwise steal
  // focus (and reset the cursor) out of whatever input the user is typing
  // into — most noticeably on every keystroke in a live-filtered search box.
  const active = document.activeElement;
  const focusInfo = active && viewRoot.contains(active) && active.id
    ? { id: active.id, selectionStart: active.selectionStart, selectionEnd: active.selectionEnd }
    : null;

  viewRoot.innerHTML = view.render();
  if (view.attach) view.attach(viewRoot, renderApp);
  enhanceFields(viewRoot);

  if (focusInfo) {
    const el = document.getElementById(focusInfo.id);
    if (el) {
      el.focus();
      if (focusInfo.selectionStart != null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(focusInfo.selectionStart, focusInfo.selectionEnd); } catch { /* not a text-selectable input type */ }
      }
    }
  }
}

function renderLoginScreen({ idle = false } = {}) {
  // A modal open at logout (e.g. the idle timer) is torn down with the shell,
  // so its scroll lock has to be released here.
  document.body.classList.remove('has-modal');
  const app = document.getElementById('app');
  app.innerHTML = renderLogin();
  attachLoginHandlers(app, boot);
  if (idle) {
    const errorBox = app.querySelector('#login-error');
    if (errorBox) {
      errorBox.textContent = 'Сессия завершена из-за 30 минут бездействия. Войдите снова.';
      errorBox.hidden = false;
    }
  }
}

function renderLoading() {
  const app = document.getElementById('app');
  // Skeleton of the real layout, so the first paint isn't a blank spinner.
  const bar = (cls) => `<div class="skeleton ${cls}"></div>`;
  app.innerHTML = `
    <div class="app-skeleton" aria-busy="true" aria-label="Загрузка">
      <div class="app-skeleton__top">${bar('skeleton--logo')}${bar('skeleton--search')}</div>
      <div class="app-skeleton__body">
        <div class="app-skeleton__side">${bar('skeleton--line').repeat(8)}</div>
        <div class="app-skeleton__main">
          ${bar('skeleton--title')}
          <div class="app-skeleton__kpis">${bar('skeleton--kpi').repeat(4)}</div>
          <div class="app-skeleton__cards">${bar('skeleton--card').repeat(2)}</div>
        </div>
      </div>
    </div>`;
}

function logout(opts) {
  stopIdleWatch();
  stopLive();
  api.logout();
  resetStore();
  shellMounted = false;
  renderLoginScreen(opts);
}

// Offline start (no network, app shell from the service worker): say so and
// retry by itself, instead of dropping to the login screen.
function renderOffline() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="app-offline">
      <i class="fa-solid fa-wifi"></i>
      <h2>Нет подключения к интернету</h2>
      <p>Данные загрузятся, как только связь вернётся.</p>
      <button type="button" class="btn btn--primary" id="offline-retry"><i class="fa-solid fa-rotate-right"></i> Повторить</button>
    </div>`;
  document.getElementById('offline-retry').addEventListener('click', boot);
  window.addEventListener('online', boot, { once: true });
}

async function boot() {
  if (!getToken()) {
    renderLoginScreen();
    return;
  }
  if (!isHydrated()) {
    renderLoading();
    try {
      await initStore();
    } catch (e) {
      console.error('Failed to load app state', e);
      if (e?.status === 0) renderOffline();
      else renderLoginScreen();
      return;
    }
  }
  startIdleWatch();
  startLive();
  if (!window.location.hash || window.location.hash === '#/login') {
    window.location.hash = '#/dashboard';
  } else {
    renderApp();
  }
}

// ---- Keyboard shortcuts ----
//   /      focus the search          N   new order
//   B / L  orders: board / list      ?   this list
// Ignored while typing in a field, with a modal open, or with Ctrl/Alt/Cmd.
const SHORTCUTS_HELP = [
  ['/', 'Поиск'],
  ['N', 'Новый заказ'],
  ['B', 'Заказы — доска'],
  ['L', 'Заказы — список'],
  ['Esc', 'Закрыть окно'],
  ['?', 'Эта подсказка'],
];

function isTyping(el) {
  return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

document.addEventListener('keydown', (e) => {
  if (!getToken() || !shellMounted || e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTyping(e.target) || document.body.classList.contains('has-modal') || document.querySelector('.dialog-overlay')) return;
  // e.code, not e.key, so the shortcuts also work on a Russian layout.
  const code = e.code;
  if (e.key === '/' || code === 'Slash' && !e.shiftKey) {
    const search = document.getElementById('global-search');
    if (search) { e.preventDefault(); search.focus(); search.select(); }
  } else if (code === 'KeyN' && routeAllowed('orders') && can('orders', 'create')) {
    e.preventDefault();
    const open = () => document.querySelector('[data-action="new-order"]')?.click();
    if (currentRoute() === 'orders') open();
    else {
      window.addEventListener('hashchange', () => setTimeout(open, 0), { once: true });
      window.location.hash = '#/orders';
    }
  } else if ((code === 'KeyB' || code === 'KeyL') && currentRoute() === 'orders') {
    document.querySelector(`[data-view="${code === 'KeyB' ? 'board' : 'list'}"]`)?.click();
  } else if (e.key === '?' || (code === 'Slash' && e.shiftKey)) {
    e.preventDefault();
    openModal('Горячие клавиши', `
      <div class="shortcut-list">
        ${SHORTCUTS_HELP.map(([k, label]) => `<div class="shortcut-row"><kbd>${k}</kbd><span>${label}</span></div>`).join('')}
      </div>`);
  }
});

window.addEventListener('hashchange', () => {
  if (!getToken()) {
    renderLoginScreen();
    return;
  }
  renderApp();
});
window.addEventListener('DOMContentLoaded', boot);

// Service worker (public/sw.js): offline app shell + cached assets. Only on
// the real sites — on a dev server it would serve stale modules.
if ('serviceWorker' in navigator && import.meta.env.PROD && window.location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((e) => console.warn('SW registration failed', e));
  });
}
