import { renderShell, initModalHandlers, initProfileMenu, initSidebarToggle } from './ui.js';
import { initSearch } from './search.js';
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
};

let shellMounted = false;

function currentRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return ROUTES[hash] ? hash : 'dashboard';
}

function render() {
  const route = currentRoute();
  const app = document.getElementById('app');

  if (!shellMounted) {
    app.innerHTML = renderShell(route);
    initModalHandlers();
    initSearch(render);
    initProfileMenu();
    initSidebarToggle();
    shellMounted = true;
  } else {
    document.querySelectorAll('.sidebar__link, .bottom-nav__link').forEach((link) => {
      link.classList.toggle('is-active', link.getAttribute('href') === `#/${route}`);
    });
  }

  const viewRoot = document.getElementById('view-root');
  const view = ROUTES[route];
  viewRoot.innerHTML = view.render();
  if (view.attach) view.attach(viewRoot, render);
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => {
  if (!window.location.hash) {
    // Setting the hash queues an async 'hashchange', which will call render();
    // calling it again here would just re-render the same route twice.
    window.location.hash = '#/dashboard';
  } else {
    render();
  }
});
