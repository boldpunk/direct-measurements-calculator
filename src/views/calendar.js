// Календарь: a week of order stages by employee — who measures, delivers,
// assembles or hands over what, and when. Rows are people (plus «Не
// назначено»), columns are days. Dragging a card to another cell reassigns
// the stage and/or moves its date (production.assign).
import { getState, setStageAssignment, todayISO, getSettings } from '../store.js';
import { escapeHtml } from '../format.js';
import { can, isOwnScopeOnly, currentEmployeeId } from '../permissions.js';
import { selectOrder } from './orders.js';
import { showToast } from '../toast.js';
import { emptyState } from '../ui.js';

// Stage kinds people usually plan by date; «Все» shows every stage.
const KINDS = [
  { key: 'site', label: 'Выезды', defs: ['measure', 'delivery', 'assembly', 'handover'] },
  { key: 'measure', label: 'Замеры', defs: ['measure'] },
  { key: 'install', label: 'Доставка и сборка', defs: ['delivery', 'assembly', 'handover'] },
  { key: 'all', label: 'Все этапы', defs: null },
];
const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

let weekStart = mondayOf(todayISO());
let kind = 'site';
let showDone = false;

function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return toISO(d);
}
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

function stagesForWeek(state, days) {
  const defs = KINDS.find((k) => k.key === kind)?.defs;
  const orders = new Map(state.orders.map((o) => [o.id, o]));
  const me = currentEmployeeId();
  const ownOnly = isOwnScopeOnly('orders');
  return state.stages.filter((st) => {
    if (st.skipped || !st.deadline || !days.includes(st.deadline)) return false;
    if (defs && !defs.includes(st.defKey)) return false;
    if (st.type === 'outsource') return false; // partners, not staff — see Аутсорс
    if (!showDone && st.status === 'готово') return false;
    const order = orders.get(st.orderId);
    if (!order) return false;
    if (ownOnly && order.managerId !== me && st.assigneeId !== me) return false;
    return true;
  }).map((st) => ({ st, order: orders.get(st.orderId) }));
}

function card({ st, order }, canMove) {
  const today = todayISO();
  const late = st.status !== 'готово' && st.deadline < today;
  return `
    <div class="cal-card cal-card--${st.status === 'готово' ? 'done' : st.status === 'в работе' ? 'active' : 'wait'} ${late ? 'is-late' : ''}"
      draggable="${canMove}" data-cal-stage="${st.id}" title="${escapeHtml(order.address || '')}">
      <div class="cal-card__top"><b>${escapeHtml(st.name)}</b><span>#${order.number}</span></div>
      <div class="cal-card__sub">${escapeHtml(order.clientName || '')}</div>
      ${order.address ? `<div class="cal-card__sub"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(order.address)}</div>` : ''}
    </div>`;
}

export function renderCalendar() {
  const state = getState();
  if (getSettings().enableStages === false) {
    return `<div class="page-header"><h1>Календарь</h1></div>${emptyState({ icon: 'fa-calendar-xmark', title: 'Этапы выключены', text: 'Календарь строится по этапам заказов — их можно включить в Настройках.' })}`;
  }
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const items = stagesForWeek(state, days);
  const canMove = can('production', 'assign');
  const today = todayISO();

  // Rows: «Не назначено» first so open work is visible, then every employee
  // (so a card can be dragged onto anyone); blocked accounts only if they
  // still hold a stage this week.
  const busy = new Set(items.map(({ st }) => st.assigneeId).filter(Boolean));
  const employees = state.employees.filter((e) => !e.isBlocked || busy.has(e.id));
  const rows = [{ id: '', name: 'Не назначено' }, ...employees.sort((a, b) => a.name.localeCompare(b.name, 'ru'))];

  const head = days.map((d) => {
    const date = new Date(`${d}T00:00:00`);
    return `<div class="cal-head ${d === today ? 'is-today' : ''}">${DAY_NAMES[date.getDay()]} <b>${date.getDate()}</b></div>`;
  }).join('');

  const body = rows.map((row) => `
    <div class="cal-person">${escapeHtml(row.name)}</div>
    ${days.map((d) => {
      const cell = items.filter(({ st }) => (st.assigneeId || '') === row.id && st.deadline === d);
      return `<div class="cal-cell ${d === today ? 'is-today' : ''}" data-cal-drop="${row.id}|${d}">${cell.map((x) => card(x, canMove)).join('')}</div>`;
    }).join('')}
  `).join('');

  const first = new Date(`${days[0]}T00:00:00`);
  const last = new Date(`${days[6]}T00:00:00`);
  const month = (d) => d.toLocaleDateString('ru-RU', { month: 'long', day: 'numeric' }).replace(/^\d+\s*/, '');
  const range = `${first.getDate()}${first.getMonth() === last.getMonth() ? '' : ` ${month(first)}`} — ${last.getDate()} ${month(last)} ${last.getFullYear()}`;

  return `
    <div class="page-header">
      <h1>Календарь</h1>
      <div class="page-header__actions">
        <button type="button" class="btn" data-cal-nav="-7" aria-label="Прошлая неделя"><i class="fa-solid fa-chevron-left"></i></button>
        <button type="button" class="btn" data-cal-nav="today">Сегодня</button>
        <button type="button" class="btn" data-cal-nav="7" aria-label="Следующая неделя"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
    </div>
    <div class="cal-toolbar">
      <b class="cal-range">${range}</b>
      <div class="orders-filters" style="margin:0">
        ${KINDS.map((k) => `<button type="button" class="chip ${k.key === kind ? 'is-active' : ''}" data-cal-kind="${k.key}">${k.label}</button>`).join('')}
        <label class="checkbox-label cal-done"><input type="checkbox" id="cal-show-done" ${showDone ? 'checked' : ''} /> готовые</label>
      </div>
    </div>
    ${items.length ? '' : '<p class="form-hint" style="margin:0 0 10px">На этой неделе таких этапов нет. Дата этапа — его срок в карточке заказа.</p>'}
    <div class="cal-scroll">
      <div class="cal-grid">
        <div class="cal-corner">${canMove ? '<span class="row-item__sub">перетащите карточку</span>' : ''}</div>
        ${head}
        ${body}
      </div>
    </div>
  `;
}

export function attachCalendarHandlers(root, rerender) {
  root.querySelectorAll('[data-cal-nav]').forEach((b) => b.addEventListener('click', () => {
    const v = b.getAttribute('data-cal-nav');
    weekStart = v === 'today' ? mondayOf(todayISO()) : addDaysISO(weekStart, Number(v));
    rerender();
  }));
  root.querySelectorAll('[data-cal-kind]').forEach((b) => b.addEventListener('click', () => { kind = b.getAttribute('data-cal-kind'); rerender(); }));
  root.querySelector('#cal-show-done')?.addEventListener('change', (e) => { showDone = e.target.checked; rerender(); });

  root.querySelectorAll('[data-cal-stage]').forEach((el) => el.addEventListener('click', () => {
    const st = getState().stages.find((s) => s.id === el.getAttribute('data-cal-stage'));
    if (st && can('orders', 'view')) { selectOrder(st.orderId); window.location.hash = '#/orders'; }
  }));

  if (!can('production', 'assign')) return;
  let dragged = null;
  root.querySelectorAll('[data-cal-stage]').forEach((el) => {
    el.addEventListener('dragstart', (e) => { dragged = el.getAttribute('data-cal-stage'); el.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => el.classList.remove('is-dragging'));
  });
  root.querySelectorAll('[data-cal-drop]').forEach((cell) => {
    cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('is-drop-target'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('is-drop-target'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('is-drop-target');
      const st = getState().stages.find((s) => s.id === dragged);
      dragged = null;
      if (!st) return;
      const [assigneeId, deadline] = cell.getAttribute('data-cal-drop').split('|');
      const patch = {};
      if ((st.assigneeId || '') !== assigneeId) patch.assigneeId = assigneeId;
      if (st.deadline !== deadline) patch.deadline = deadline;
      if (!Object.keys(patch).length) return;
      setStageAssignment(st.id, patch);
      rerender();
      const who = assigneeId ? getState().employees.find((x) => x.id === assigneeId)?.name : 'не назначено';
      showToast(`«${st.name}»: ${who}, ${new Date(`${deadline}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`);
    });
  });
}
