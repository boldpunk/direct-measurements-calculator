import { getState, computeOrderFinance, getOrderDeadlineInfo, isOrderActive, todayISO, addDays } from './store.js';
import { money, escapeHtml } from './format.js';
import { selectOrder } from './views/orders.js';

export function computeNotifications() {
  const state = getState();
  const tomorrow = addDays(todayISO(), 1);
  const list = [];

  state.orders.forEach((o) => {
    if (!isOrderActive(o)) return;
    const info = getOrderDeadlineInfo(o);
    if (info.tone === 'danger') {
      list.push({
        icon: 'fa-fire', tone: 'danger',
        text: `Заказ #${o.number} ${info.text.toLowerCase()}`,
        go: () => { selectOrder(o.id); window.location.hash = '#/orders'; },
      });
    } else if (o.deadline === tomorrow) {
      list.push({
        icon: 'fa-clock', tone: 'warning',
        text: `Заказ #${o.number} должен быть завершён завтра`,
        go: () => { selectOrder(o.id); window.location.hash = '#/orders'; },
      });
    }
    const fin = computeOrderFinance(o.id);
    if (fin.remainingAmount > 0) {
      list.push({
        icon: 'fa-hand-holding-dollar', tone: 'warning',
        text: `По заказу #${o.number} осталось получить ${money(fin.remainingAmount)}`,
        go: () => { selectOrder(o.id); window.location.hash = '#/orders'; },
      });
    }
  });

  state.tasks.forEach((t) => {
    if (t.status !== 'готово' && t.deadline < todayISO()) {
      list.push({
        icon: 'fa-list-check', tone: 'danger',
        text: `Задача «${t.name}» просрочена`,
        go: () => { window.location.hash = '#/tasks'; },
      });
    }
  });

  return list.slice(0, 20);
}

export function initNotifications(rerender) {
  const toggle = document.getElementById('notif-toggle');
  const panel = document.getElementById('notif-panel');
  const badge = document.getElementById('notif-badge');
  if (!toggle || !panel) return;

  function refreshBadge() {
    const count = computeNotifications().length;
    if (badge) {
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.hidden = count === 0;
    }
  }

  function renderPanel() {
    const items = computeNotifications();
    panel.innerHTML = items.length
      ? items.map((n, i) => `
        <div class="notif-item notif-item--${n.tone}" data-notif-index="${i}">
          <i class="fa-solid ${n.icon}"></i>
          <span>${escapeHtml(n.text)}</span>
        </div>
      `).join('')
      : '<div class="empty-state empty-state--sm">Нет уведомлений</div>';

    panel.querySelectorAll('[data-notif-index]').forEach((el) => {
      el.addEventListener('click', () => {
        items[Number(el.getAttribute('data-notif-index'))].go();
        panel.hidden = true;
        rerender();
      });
    });
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!panel.hidden) { panel.hidden = true; return; }
    renderPanel();
    panel.hidden = false;
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !e.target.closest('.notif-wrap')) panel.hidden = true;
  });

  refreshBadge();
}
