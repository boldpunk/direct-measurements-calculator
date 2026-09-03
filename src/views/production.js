import { getState, getActiveStage, completeStage, isOverdue, STAGE_DEFS } from '../store.js';
import { shortDate, escapeHtml } from '../format.js';
import { selectOrder } from './orders.js';

export function renderProduction() {
  const state = getState();
  const activeOrders = state.orders.filter((o) => o.status !== 'завершён');
  const doneOrders = state.orders.filter((o) => o.status === 'завершён');

  const phaseCols = STAGE_DEFS.map((def) => {
    const orders = activeOrders.filter((o) => getActiveStage(o.id)?.defKey === def.key);
    return renderColumn(def.name, def.key, orders, state, def.key === 'carpentry');
  }).join('');

  const doneCol = `
    <div class="prod-col" data-phase="done">
      <div class="prod-col__title">Готово <span class="kanban-col__count">${doneOrders.length}</span></div>
      <div class="prod-col__body">
        ${doneOrders.map((o) => renderCard(o, state, null)).join('') || '<div class="empty-state empty-state--sm">пусто</div>'}
      </div>
    </div>
  `;

  return `
    <div class="page-header">
      <h1>Производство</h1>
      <span class="row-item__sub">Заказы по этапам пайплайна — от продажи до сдачи</span>
    </div>
    <div class="prod-board">${phaseCols}${doneCol}</div>
  `;
}

function renderColumn(title, phaseKey, orders, state, isCarpentry) {
  return `
    <div class="prod-col" data-phase="${phaseKey}">
      <div class="prod-col__title">
        ${escapeHtml(title)} <span class="kanban-col__count">${orders.length}</span>
        ${isCarpentry ? '<a href="#/carpentry" class="prod-col__link" title="Открыть доску Столярка"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>' : ''}
      </div>
      <div class="prod-col__body">
        ${orders.map((o) => renderCard(o, state, getActiveStage(o.id))).join('') || '<div class="empty-state empty-state--sm">пусто</div>'}
      </div>
    </div>
  `;
}

function renderCard(o, state, stage) {
  const overdue = stage && isOverdue(stage.deadline, stage.status);
  const assignee = stage ? state.employees.find((e) => e.id === stage.assigneeId) : null;
  const partner = stage ? state.partners.find((p) => p.id === stage.partnerId) : null;
  const who = stage?.type === 'outsource' ? partner?.name : assignee?.name;

  return `
    <div class="prod-card ${overdue ? 'is-overdue' : ''}" data-order-id="${o.id}">
      <div class="prod-card__title">${escapeHtml(o.productType)} #${o.number}</div>
      <div class="prod-card__sub">${escapeHtml(o.clientName)}</div>
      <div class="prod-card__footer">
        <span>${who ? escapeHtml(who) : 'не назначен'}</span>
        ${stage ? `<span class="${overdue ? 'is-overdue' : ''}">${shortDate(stage.deadline)}</span>` : '<span><i class="fa-solid fa-check"></i></span>'}
      </div>
      ${stage && stage.status === 'в работе' ? `<button type="button" class="btn btn--sm prod-card__advance" data-action="advance" data-stage="${stage.id}">Завершить этап</button>` : ''}
    </div>
  `;
}

export function attachProductionHandlers(root, rerender) {
  root.querySelectorAll('[data-action="advance"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      completeStage(btn.getAttribute('data-stage'));
      rerender();
    });
  });

  root.querySelectorAll('[data-order-id]').forEach((card) => {
    card.addEventListener('click', () => {
      selectOrder(card.getAttribute('data-order-id'));
      window.location.hash = '#/orders';
    });
  });
}
