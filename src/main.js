import 'flag-icons/css/flag-icons.min.css';
import { renderShell, initModalHandlers, initProfileMenu, initSidebarToggle, NAV_ITEMS } from './ui.js';
import { initSearch } from './search.js';
import { initNotifications } from './notifications.js';
import { renderDashboard, attachDashboardHandlers } from './views/dashboard.js';
import { renderOrders, attachOrderHandlers } from './views/orders.js';
import { renderClients, attachClientsHandlers } from './views/clients.js';
import { renderProduction, attachProductionHandlers } from './views/production.js';
import { renderCarpentry, attachCarpentryHandlers } from './views/carpentry.js';
import { renderRework, attachReworkHandlers } from './views/rework.js';
import { renderOutsource, attachOutsourceHandlers } from './views/outsource.js';
import { renderFinance, attachFinanceHandlers } from './views/finance.js';
import { renderEmployees, attachEmployeesHandlers } from './views/employees.js';
import { renderSettings, attachSettingsHandlers } from './views/settings.js';
import { renderTasks, attachTasksHandlers } from './views/tasks.js';
import { renderAuditLog, attachAuditLogHandlers } from './views/auditLog.js';
import { renderLogin, attachLoginHandlers } from './views/login.js';
import { api, getToken } from './api.js';
import { initStore, isHydrated, resetStore } from './store.js';

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
  employees: { render: renderEmployees, attach: attachEmployeesHandlers },
  settings: { render: renderSettings, attach: attachSettingsHandlers },
  'audit-log': { render: renderAuditLog, attach: attachAuditLogHandlers },
};

let shellMounted = false;

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

function currentRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (ROUTES[hash] && routeAllowed(hash)) return hash;
  return 'dashboard';
}

function renderApp() {
  const route = currentRoute();
  const requestedHash = window.location.hash.replace(/^#\/?/, '');
  if (route !== requestedHash) {
    history.replaceState(null, '', `#/${route}`);
  }
  const app = document.getElementById('app');

  if (!shellMounted) {
    app.innerHTML = renderShell(route);
    initModalHandlers();
    initSearch(renderApp);
    initProfileMenu();
    initSidebarToggle();
    initNotifications(renderApp);
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    shellMounted = true;
  } else {
    document.querySelectorAll('.sidebar__link, .bottom-nav__link').forEach((link) => {
      link.classList.toggle('is-active', link.getAttribute('href') === `#/${route}`);
    });
  }

  const viewRoot = document.getElementById('view-root');
  const view = ROUTES[route];
  viewRoot.innerHTML = view.render();
  if (view.attach) view.attach(viewRoot, renderApp);
}

function renderLoginScreen({ idle = false } = {}) {
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
  app.innerHTML = '<div class="app-loading"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка...</div>';
}

function logout(opts) {
  stopIdleWatch();
  api.logout();
  resetStore();
  shellMounted = false;
  renderLoginScreen(opts);
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
      renderLoginScreen();
      return;
    }
  }
  startIdleWatch();
  if (!window.location.hash || window.location.hash === '#/login') {
    window.location.hash = '#/dashboard';
  } else {
    renderApp();
  }
}

window.addEventListener('hashchange', () => {
  if (!getToken()) {
    renderLoginScreen();
    return;
  }
  renderApp();
});
window.addEventListener('DOMContentLoaded', boot);
