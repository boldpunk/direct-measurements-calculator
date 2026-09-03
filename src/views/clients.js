import {
  getState, getClients, createClient, updateClient, deleteClient,
  getClientOrders, getClientStats, computeOrderFinance, getOrderDeadlineInfo,
} from '../store.js';
import { money, escapeHtml, orderStatusBadgeClass, deadlineBadgeClass } from '../format.js';
import { openModal, closeModal } from '../ui.js';
import { selectOrder } from './orders.js';

let selectedClientId = null;

export function selectClient(clientId) {
  selectedClientId = clientId;
}

export function renderClients() {
  const clients = getClients();
  if (!selectedClientId && clients.length) selectedClientId = clients[clients.length - 1].id;

  const rows = [...clients].reverse().map((c) => {
    const stats = getClientStats(c.id);
    return `
      <tr class="${c.id === selectedClientId ? 'is-selected' : ''}" data-client-row="${c.id}">
        <td>${escapeHtml(c.name)}</td>
        <td>${c.phone ? `<a class="tel-link" href="tel:${escapeHtml(c.phone.replace(/[^+\d]/g, ''))}">${escapeHtml(c.phone)}</a>` : '—'}</td>
        <td>${escapeHtml(c.address) || '—'}</td>
        <td>${stats.orderCount}</td>
        <td>${money(stats.totalAmount)}</td>
        <td class="${stats.debt > 0 ? 'text-neg' : 'text-pos'}">${stats.debt > 0 ? money(stats.debt) : '—'}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="page-header">
      <h1>Клиенты</h1>
      <button class="btn btn--primary" data-action="new-client"><i class="fa-solid fa-plus"></i> Новый клиент</button>
    </div>
    <div class="orders-layout">
      <div class="panel">
        <div class="panel__body" style="padding:0; overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr><th>Клиент</th><th>Телефон</th><th>Адрес</th><th>Заказов</th><th>Сумма заказов</th><th>Долг</th></tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="6" class="empty-state">Клиентов нет</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="panel" id="client-detail">
        ${selectedClientId ? renderClientDetail(selectedClientId) : '<div class="empty-state">Выберите клиента</div>'}
      </div>
    </div>
  `;
}

function renderClientDetail(clientId) {
  const client = getState().clients.find((c) => c.id === clientId);
  if (!client) return '<div class="empty-state">Клиент не найден</div>';

  const stats = getClientStats(clientId);
  const orders = [...getClientOrders(clientId)].reverse();

  const orderRows = orders.map((o) => {
    const fin = computeOrderFinance(o.id);
    const deadlineInfo = getOrderDeadlineInfo(o);
    return `
      <div class="row-item order-item" data-order-id="${o.id}">
        <div>
          <div class="row-item__title">${escapeHtml(o.productType)} #${o.number}</div>
          <div class="row-item__sub"><span class="${orderStatusBadgeClass(o.status)}">${o.status}</span> · <span class="${deadlineBadgeClass(deadlineInfo.tone)}">${deadlineInfo.text}</span></div>
        </div>
        <div style="text-align:right">
          <div>${money(o.amount)}</div>
          <div class="row-item__sub ${fin.remainingAmount > 0 ? 'text-neg' : 'text-pos'}">${fin.remainingAmount > 0 ? `Долг ${money(fin.remainingAmount)}` : 'Оплачено'}</div>
        </div>
      </div>
    `;
  }).join('') || '<div class="empty-state empty-state--sm">Заказов пока нет</div>';

  return `
    <div class="order-detail__header">
      <div>
        <h2>${escapeHtml(client.name)}</h2>
        <div class="row-item__sub">${client.phone ? `<a class="tel-link" href="tel:${escapeHtml(client.phone.replace(/[^+\d]/g, ''))}">${escapeHtml(client.phone)}</a>` : '—'}</div>
        ${client.address ? `<div class="row-item__sub"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(client.address)}</div>` : ''}
      </div>
      <div class="order-detail__actions">
        <button type="button" class="btn btn--sm" data-action="edit-client" data-id="${client.id}"><i class="fa-solid fa-pen"></i></button>
        <button type="button" class="btn btn--sm btn--danger-ghost" data-action="delete-client" data-id="${client.id}"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
    <div class="order-detail__stats">
      <div><span>Заказов</span><b>${stats.orderCount}</b></div>
      <div><span>Сумма заказов</span><b>${money(stats.totalAmount)}</b></div>
      <div><span>Долг</span><b class="${stats.debt > 0 ? 'text-neg' : 'text-pos'}">${stats.debt > 0 ? money(stats.debt) : 'Нет'}</b></div>
    </div>
    <div class="order-detail__section-title">История заказов</div>
    <div class="section-block"><div class="row-list">${orderRows}</div></div>
  `;
}

export function attachClientsHandlers(root, rerender) {
  root.querySelectorAll('[data-client-row]').forEach((row) => {
    row.addEventListener('click', () => {
      selectedClientId = row.getAttribute('data-client-row');
      rerender();
    });
  });

  root.querySelectorAll('[data-order-id]').forEach((el) => {
    el.addEventListener('click', () => {
      selectOrder(el.getAttribute('data-order-id'));
      window.location.hash = '#/orders';
    });
  });

  const newBtn = root.querySelector('[data-action="new-client"]');
  if (newBtn) newBtn.addEventListener('click', () => openClientModal(null, rerender));

  const editBtn = root.querySelector('[data-action="edit-client"]');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      const client = getState().clients.find((c) => c.id === editBtn.getAttribute('data-id'));
      openClientModal(client, rerender);
    });
  }

  const deleteBtn = root.querySelector('[data-action="delete-client"]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      const id = deleteBtn.getAttribute('data-id');
      if (getClientOrders(id).length) {
        window.alert('Нельзя удалить клиента с заказами. Сначала удалите или перепривяжите его заказы.');
        return;
      }
      if (window.confirm('Удалить клиента?')) {
        deleteClient(id);
        selectedClientId = null;
        rerender();
      }
    });
  }
}

function openClientModal(client, rerender) {
  openModal(client ? 'Изменить клиента' : 'Новый клиент', `
    <form id="client-form" class="form">
      <label>ФИО<input name="name" required placeholder="Имя клиента" value="${client ? escapeHtml(client.name) : ''}" /></label>
      <label>Телефон<input name="phone" placeholder="+998 90 000-00-00" value="${client ? escapeHtml(client.phone) : ''}" /></label>
      <label>Адрес<input name="address" placeholder="Город, улица, дом" value="${client ? escapeHtml(client.address || '') : ''}" /></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">${client ? 'Сохранить' : 'Создать'}</button>
      </div>
    </form>
  `);

  document.getElementById('client-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = { name: fd.get('name'), phone: fd.get('phone'), address: fd.get('address') };
    if (client) {
      updateClient(client.id, data);
    } else {
      const created = createClient(data);
      selectedClientId = created.id;
    }
    closeModal();
    rerender();
  });
}
