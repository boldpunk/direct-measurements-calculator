import { getState, computeOrderFinance, getOrderDeadlineInfo, isOrderActive, todayISO, addDays } from './store.js';
import { money, escapeHtml } from './format.js';
import { selectOrder } from './views/orders.js';
import { can, currentEmployeeId, isOwnScopeOnly } from './permissions.js';

// Reminders: overdue / due-tomorrow orders, client debts, the employee's own
// overdue stages and tasks. Each has a stable key that changes when the
// situation does (another day overdue, a different balance), so «Прочитать
// все» clears the badge until something new happens — it used to sit at
// «9+» for good.
const SEEN_KEY = 'mebelflow_notif_seen';

function readSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}
function writeSeen(keys) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...keys].slice(-500))); } catch { /* private mode */ }
}

let badgeTimer = null;
const openOrder = (id) => () => { selectOrder(id); window.location.hash = '#/orders'; };

export function computeNotifications() {
  const state = getState();
  if (!state) return [];
  const today = todayISO();
  const tomorrow = addDays(today, 1);
  const me = currentEmployeeId();
  const seesOrders = can('orders', 'view');
  const seesMoney = seesOrders || can('finance', 'view');
  const ownOnly = isOwnScopeOnly('orders');
  const list = [];

  if (seesOrders) {
    state.orders.forEach((o) => {
      if (!isOrderActive(o) || (ownOnly && o.managerId !== me)) return;
      const info = getOrderDeadlineInfo(o);
      if (info.tone === 'danger') {
        list.push({
          key: `late:${o.id}:${today}`, rank: 0, icon: 'fa-fire', tone: 'danger',
          text: `Заказ #${o.number} ${info.text.toLowerCase()}`, go: openOrder(o.id),
        });
      } else if (o.deadline === tomorrow) {
        list.push({
          key: `due:${o.id}:${o.deadline}`, rank: 1, icon: 'fa-clock', tone: 'warning',
          text: `Заказ #${o.number} нужно сдать завтра`, go: openOrder(o.id),
        });
      }
      if (seesMoney) {
        const left = computeOrderFinance(o.id).remainingAmount;
        if (left > 0 && o.deadline <= tomorrow) {
          // Debts only once the order is due — not for every unpaid order.
          list.push({
            key: `debt:${o.id}:${left}`, rank: 2, icon: 'fa-hand-holding-dollar', tone: 'warning',
            text: `${o.clientName || `Заказ #${o.number}`}: не доплачено ${money(left)} (#${o.number})`, go: openOrder(o.id),
          });
        }
      }
    });
  }

  state.stages.forEach((st) => {
    if (st.assigneeId !== me || st.skipped || st.status === 'готово' || !st.deadline || st.deadline >= today) return;
    const order = state.orders.find((o) => o.id === st.orderId);
    if (!order) return;
    list.push({
      key: `stage:${st.id}:${today}`, rank: 0, icon: 'fa-gears', tone: 'danger',
      text: `Ваш этап «${st.name}» (#${order.number}) просрочен`,
      go: () => { window.location.hash = can('production', 'view') ? '#/production' : '#/dashboard'; },
    });
  });

  state.tasks.forEach((t) => {
    if (t.status === 'готово' || !t.deadline || t.deadline >= today) return;
    if (!seesOrders && t.assigneeId !== me) return;
    list.push({
      key: `task:${t.id}:${today}`, rank: 1, icon: 'fa-list-check', tone: 'danger',
      text: `Задача «${t.name}» просрочена`,
      go: () => { window.location.hash = '#/tasks'; },
    });
  });

  return list.sort((a, b) => a.rank - b.rank).slice(0, 30);
}

export function initNotifications(rerender) {
  const toggle = document.getElementById('notif-toggle');
  const panel = document.getElementById('notif-panel');
  const badge = document.getElementById('notif-badge');
  if (!toggle || !panel) return;

  function refreshBadge() {
    const seen = readSeen();
    const count = computeNotifications().filter((n) => !seen.has(n.key)).length;
    if (badge) {
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.hidden = count === 0;
    }
  }

  function renderPanel() {
    const items = computeNotifications();
    const seen = readSeen();
    const unseen = items.filter((n) => !seen.has(n.key)).length;
    panel.innerHTML = items.length
      ? `
        <div class="notif-head">
          <b>Уведомления</b>
          ${unseen ? '<button type="button" class="notif-head__btn" data-notif-read>Прочитать все</button>' : '<span class="row-item__sub">всё прочитано</span>'}
        </div>
        ${items.map((n, i) => `
          <div class="notif-item notif-item--${n.tone} ${seen.has(n.key) ? 'is-seen' : ''}" data-notif-index="${i}">
            <i class="fa-solid ${n.icon}"></i>
            <span>${escapeHtml(n.text)}</span>
          </div>
        `).join('')}`
      : '<div class="empty-state empty-state--sm">Нет уведомлений</div>';

    panel.querySelector('[data-notif-read]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      writeSeen(new Set([...readSeen(), ...items.map((n) => n.key)]));
      refreshBadge();
      renderPanel();
    });
    panel.querySelectorAll('[data-notif-index]').forEach((el) => {
      el.addEventListener('click', () => {
        const n = items[Number(el.getAttribute('data-notif-index'))];
        writeSeen(new Set([...readSeen(), n.key]));
        n.go();
        panel.hidden = true;
        refreshBadge();
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
  // Keep the badge current as orders change during the session.
  clearInterval(badgeTimer);
  badgeTimer = setInterval(() => { if (toggle.isConnected) refreshBadge(); }, 60000);
}
