import { api } from '../api.js';
import { money, escapeHtml } from '../format.js';
import { openModal, closeModal, selectOptions } from '../ui.js';
import { can, sees, maskUnless } from '../permissions.js';
import { openSupplierPaymentModal } from './fittings.js';

const UNITS = ['шт.', 'компл.', 'м', 'м²', 'л', 'кг', 'упаковка'];
const EXPENSE_REASONS = ['производство', 'сборка', 'заказ', 'брак', 'потеря', 'другое'];
const MOVEMENT_LABELS = {
  income: 'Приход', expense: 'Расход', reserve: 'Резерв', unreserve: 'Снятие резерва',
  adjustment: 'Корректировка', return: 'Возврат',
};

let items = [];
let categories = [];
let brands = [];
let suppliers = [];
let dashboard = null;
let loading = true;
let refsLoaded = false;
let initStarted = false;
let selectedItemId = null;
let itemDetail = null;
let detailLoading = false;
let filters = { search: '', categoryId: '', brandId: '', status: 'active', lowStock: false, outOfStock: false };

function statusBadge(stockStatus) {
  if (stockStatus === 'out') return '<span class="badge badge--tone-danger">Нет в наличии</span>';
  if (stockStatus === 'low') return '<span class="badge badge--tone-warning">Низкий остаток</span>';
  return '<span class="badge badge--tone-success">В наличии</span>';
}

function kpiTile(icon, label, value, tone) {
  return `
    <div class="kpi kpi--${tone || 'neutral'}">
      <div class="kpi__icon"><i class="fa-solid ${icon}"></i></div>
      <div class="kpi__body"><div class="kpi__title">${label}</div><div class="kpi__value">${value}</div></div>
    </div>
  `;
}

function itemRow(it) {
  return `
    <tr class="${it.id === selectedItemId ? 'is-selected' : ''}" data-item-row="${it.id}">
      <td>${escapeHtml(it.categoryName)}</td>
      <td>${escapeHtml(it.brandName)}</td>
      <td>${escapeHtml(it.productName)}</td>
      <td>${escapeHtml(it.name || '—')}</td>
      <td>${it.qty}</td>
      <td>${escapeHtml(it.unit)}</td>
      <td>${maskUnless('seesPurchasePrices', money(it.purchasePrice))}</td>
      <td>${maskUnless('seesPurchasePrices', money(it.qty * it.purchasePrice))}</td>
      <td>${it.status === 'archived' ? '<span class="badge badge--muted">Архив</span>' : statusBadge(it.stockStatus)}</td>
    </tr>
  `;
}

export function renderStock() {
  const canCreate = can('stock', 'create');

  const kpis = dashboard ? [
    kpiTile('fa-sack-dollar', 'Стоимость склада', maskUnless('seesPurchasePrices', money(dashboard.totalValue))),
    kpiTile('fa-layer-group', 'Позиций', dashboard.itemCount),
    kpiTile('fa-cubes', 'Единиц товара', dashboard.totalUnits),
    kpiTile('fa-triangle-exclamation', 'Низкий остаток', dashboard.lowStock.length, dashboard.lowStock.length ? 'warning' : 'neutral'),
    kpiTile('fa-circle-minus', 'Нет в наличии', dashboard.outOfStock.length, dashboard.outOfStock.length ? 'danger' : 'neutral'),
    kpiTile('fa-lock', 'Зарезервировано', dashboard.reserved.length),
  ].join('') : '';

  const rows = items.map(itemRow).join('') || `<tr><td colspan="9" class="empty-state">${loading ? 'Загрузка...' : 'Товары не найдены'}</td></tr>`;

  return `
    <div class="page-header">
      <h1>Склад</h1>
      <div style="display:flex; gap:8px;">
        ${canCreate ? '<button type="button" class="btn" data-action="stock-manage-refs"><i class="fa-solid fa-tags"></i> Справочники</button>' : ''}
        ${canCreate ? '<button type="button" class="btn btn--primary" data-action="stock-new-item"><i class="fa-solid fa-plus"></i> Новый товар</button>' : ''}
      </div>
    </div>
    <div class="kpi-row">${kpis}</div>
    <div class="orders-toolbar">
      <div class="orders-toolbar__search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" id="stock-search" placeholder="Категория, бренд, наименование, спецификация, артикул..." value="${escapeHtml(filters.search)}" autocomplete="off" />
      </div>
      <select id="stock-category-filter">
        <option value="">Все категории</option>
        ${categories.map((c) => `<option value="${c.id}" ${filters.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <select id="stock-brand-filter">
        <option value="">Все бренды</option>
        ${brands.map((b) => `<option value="${b.id}" ${filters.brandId === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
      </select>
      <select id="stock-status-filter">
        <option value="active" ${filters.status === 'active' ? 'selected' : ''}>Активные</option>
        <option value="archived" ${filters.status === 'archived' ? 'selected' : ''}>Архив</option>
      </select>
    </div>
    <div class="orders-filters">
      <button type="button" class="chip ${filters.lowStock ? 'is-active' : ''}" data-toggle="lowStock">Низкий остаток</button>
      <button type="button" class="chip ${filters.outOfStock ? 'is-active' : ''}" data-toggle="outOfStock">Нет в наличии</button>
    </div>
    <div class="orders-layout">
      <div class="panel stock-table-panel">
        <div class="panel__body" style="padding:0; overflow-x:auto">
          <table class="data-table">
            <thead><tr><th>Категория</th><th>Бренд</th><th>Наименование</th><th>Спецификация</th><th>Остаток</th><th>Ед.</th><th>Цена</th><th>Стоимость</th><th>Статус</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
      <div class="panel" id="stock-detail">
        ${selectedItemId ? renderItemDetail() : '<div class="empty-state">Выберите товар</div>'}
      </div>
    </div>
  `;
}

function renderItemDetail() {
  if (detailLoading || !itemDetail) return '<div class="empty-state">Загрузка...</div>';
  const it = itemDetail;
  const canEdit = can('stock', 'edit');
  const canIncome = can('stock', 'income');
  const canExpense = can('stock', 'expense');
  const canAdjust = can('stock', 'adjustment');
  const canDelete = can('stock', 'delete');

  const orderNumberById = new Map(it.orders.map((o) => [o.id, o]));
  const movementRows = it.movements.map((m) => {
    const order = m.orderId ? orderNumberById.get(m.orderId) : null;
    const sign = ['expense', 'unreserve'].includes(m.type) ? '-' : m.type === 'adjustment' ? (m.qty < 0 ? '' : '+') : '+';
    return `
      <tr>
        <td>${new Date(m.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
        <td>${MOVEMENT_LABELS[m.type] || m.type}</td>
        <td>${sign}${Math.abs(m.qty)}</td>
        <td>${m.price != null ? money(m.price) : '—'}</td>
        <td>${escapeHtml(m.employee?.name || '—')}</td>
        <td>${order ? `№${order.number}` : '—'}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6" class="empty-state empty-state--sm">Движений пока нет</td></tr>';

  const usedInOrders = it.orders.length
    ? it.orders.map((o) => `№${o.number} (${escapeHtml(o.clientName)})`).join(', ')
    : '—';

  return `
    <div class="order-detail__header">
      <div>
        <h2>${escapeHtml(it.productName)}${it.name ? ` — ${escapeHtml(it.name)}` : ''}</h2>
        <div class="row-item__sub">${escapeHtml(it.categoryName)} · ${escapeHtml(it.brandName)}${it.sku ? ` · ${escapeHtml(it.sku)}` : ''}</div>
      </div>
      <div class="order-detail__actions">
        ${it.status === 'archived' ? '<span class="badge badge--muted">Архив</span>' : statusBadge(it.stockStatus)}
        ${canEdit ? `<button type="button" class="btn btn--sm" data-action="stock-edit-item"><i class="fa-solid fa-pen"></i></button>` : ''}
        ${canDelete ? `<button type="button" class="btn btn--sm btn--danger-ghost" data-action="stock-delete-item"><i class="fa-solid fa-trash"></i></button>` : ''}
      </div>
    </div>
    <div class="order-detail__stats">
      <div><span>Остаток</span><b>${it.qty} ${escapeHtml(it.unit)}</b></div>
      <div><span>Зарезервировано</span><b>${it.reserved} ${escapeHtml(it.unit)}</b></div>
      <div><span>Доступно</span><b>${it.available} ${escapeHtml(it.unit)}</b></div>
      <div><span>Мин. остаток</span><b>${it.minStock ?? '—'}</b></div>
    </div>
    <div class="order-detail__stats">
      <div><span>Цена закупки</span><b>${maskUnless('seesPurchasePrices', money(it.purchasePrice))}</b></div>
      <div><span>Цена продажи</span><b>${money(it.salePrice)}</b></div>
      <div><span>Поставщик</span><b>${maskUnless('seesSupplierData', escapeHtml(it.supplierName || '—'))}</b></div>
      <div><span>Место хранения</span><b>${escapeHtml(it.location || '—')}</b></div>
    </div>
    ${it.comment ? `<div class="order-detail__notes"><i class="fa-solid fa-note-sticky"></i> ${escapeHtml(it.comment)}</div>` : ''}
    <div class="order-detail__notes"><i class="fa-solid fa-box"></i> Заказы: ${usedInOrders}</div>

    <div class="order-detail__section-title">Действия</div>
    <div class="section-block" style="display:flex; gap:8px; flex-wrap:wrap;">
      ${canIncome ? '<button type="button" class="btn btn--sm" data-action="stock-income"><i class="fa-solid fa-plus"></i> Приход</button>' : ''}
      ${canExpense ? '<button type="button" class="btn btn--sm" data-action="stock-expense"><i class="fa-solid fa-minus"></i> Расход</button>' : ''}
      ${canAdjust ? '<button type="button" class="btn btn--sm" data-action="stock-adjustment"><i class="fa-solid fa-sliders"></i> Корректировка</button>' : ''}
    </div>

    <div class="order-detail__section-title">История движений</div>
    <div class="section-block section-block--last" style="overflow-x:auto">
      <table class="data-table">
        <thead><tr><th>Дата</th><th>Тип</th><th>Кол-во</th><th>Цена</th><th>Пользователь</th><th>Заказ</th></tr></thead>
        <tbody>${movementRows}</tbody>
      </table>
    </div>
  `;
}

// ---- Data loading ----

async function loadRefs() {
  // getSuppliersSummary() returns the same fields as getStockSuppliers() plus
  // totalCost/totalPaid/balance, so this one call covers both plain <select>
  // population and the balance display in "Справочники склада".
  const [cats, brs, sups] = await Promise.all([api.getStockCategories(), api.getStockBrands(), api.getSuppliersSummary()]);
  categories = cats;
  brands = brs;
  suppliers = sups;
  refsLoaded = true;
}

async function loadItems(rerender) {
  loading = true;
  rerender();
  try {
    const params = {
      search: filters.search, categoryId: filters.categoryId, brandId: filters.brandId, status: filters.status,
      lowStock: filters.lowStock ? '1' : '', outOfStock: filters.outOfStock ? '1' : '',
    };
    const [list, dash] = await Promise.all([api.getStockItems(params), api.getStockDashboard()]);
    items = list;
    dashboard = dash;
  } catch (e) {
    console.error('Failed to load stock items', e);
    items = [];
  }
  loading = false;
  rerender();
}

async function loadDetail(id, rerender) {
  detailLoading = true;
  rerender();
  try {
    itemDetail = await api.getStockItem(id);
  } catch (e) {
    console.error('Failed to load stock item', e);
    itemDetail = null;
  }
  detailLoading = false;
  rerender();
}

export function attachStockHandlers(root, rerender) {
  const searchInput = root.querySelector('#stock-search');
  if (searchInput) searchInput.addEventListener('input', () => { filters.search = searchInput.value; loadItems(rerender); });
  const catSel = root.querySelector('#stock-category-filter');
  if (catSel) catSel.addEventListener('change', () => { filters.categoryId = catSel.value; loadItems(rerender); });
  const brandSel = root.querySelector('#stock-brand-filter');
  if (brandSel) brandSel.addEventListener('change', () => { filters.brandId = brandSel.value; loadItems(rerender); });
  const statusSel = root.querySelector('#stock-status-filter');
  if (statusSel) statusSel.addEventListener('change', () => { filters.status = statusSel.value; loadItems(rerender); });
  root.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-toggle');
      filters[key] = !filters[key];
      loadItems(rerender);
    });
  });

  root.querySelectorAll('[data-item-row]').forEach((row) => {
    row.addEventListener('click', () => {
      selectedItemId = row.getAttribute('data-item-row');
      loadDetail(selectedItemId, rerender);
    });
  });

  const newBtn = root.querySelector('[data-action="stock-new-item"]');
  if (newBtn) newBtn.addEventListener('click', () => openItemModal(null, rerender));

  const refsBtn = root.querySelector('[data-action="stock-manage-refs"]');
  if (refsBtn) refsBtn.addEventListener('click', () => openRefsModal(rerender));

  const editBtn = root.querySelector('[data-action="stock-edit-item"]');
  if (editBtn) editBtn.addEventListener('click', () => openItemModal(itemDetail, rerender));

  const deleteBtn = root.querySelector('[data-action="stock-delete-item"]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!window.confirm('Удалить товар со склада? Если по нему уже были движения, он будет перемещён в архив.')) return;
      try {
        await api.deleteStockItem(itemDetail.id);
        selectedItemId = null;
        itemDetail = null;
        loadItems(rerender);
      } catch (e) {
        window.alert(e.message || 'Не удалось удалить товар');
      }
    });
  }

  const incomeBtn = root.querySelector('[data-action="stock-income"]');
  if (incomeBtn) incomeBtn.addEventListener('click', () => openIncomeModal(rerender));
  const expenseBtn = root.querySelector('[data-action="stock-expense"]');
  if (expenseBtn) expenseBtn.addEventListener('click', () => openExpenseModal(rerender));
  const adjustBtn = root.querySelector('[data-action="stock-adjustment"]');
  if (adjustBtn) adjustBtn.addEventListener('click', () => openAdjustmentModal(rerender));

  if (!initStarted) {
    initStarted = true;
    loadRefs();
    loadItems(rerender);
  }
}

// ---- Create / edit item modal ----

function openItemModal(item, rerender) {
  openModal(item ? 'Изменить товар' : 'Новый товар', `
    <form id="stock-item-form" class="form">
      <label>Категория<input name="categoryName" list="stock-categories-list" required placeholder="напр. Петли" value="${item ? escapeHtml(item.categoryName) : ''}" /></label>
      <datalist id="stock-categories-list">${categories.map((c) => `<option value="${escapeHtml(c.name)}">`).join('')}</datalist>
      <label>Бренд<input name="brandName" list="stock-brands-list" required placeholder="напр. Blum" value="${item ? escapeHtml(item.brandName) : ''}" /></label>
      <datalist id="stock-brands-list">${brands.map((b) => `<option value="${escapeHtml(b.name)}">`).join('')}</datalist>
      <label>Наименование<input name="productName" required placeholder="напр. Clip Top" value="${item ? escapeHtml(item.productName) : ''}" /></label>
      <label>Спецификация <span class="form-hint">(например: горбатая, 500 мм)</span><input name="name" placeholder="напр. горбатая" value="${item ? escapeHtml(item.name) : ''}" /></label>
      <label>Единица измерения
        <select name="unit">${UNITS.map((u) => `<option ${item?.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
      </label>
      <label>Минимальный остаток<input name="minStock" type="number" min="0" step="1" value="${item?.minStock ?? ''}" /></label>
      <label>Цена закупки<input name="purchasePrice" type="number" min="0" step="0.01" value="${item ? item.purchasePrice : ''}" /></label>
      <label>Цена продажи<input name="salePrice" type="number" min="0" step="0.01" value="${item ? item.salePrice : ''}" /></label>
      <label>Артикул<input name="sku" value="${item ? escapeHtml(item.sku) : ''}" /></label>
      <label>Поставщик
        <select name="supplierId">${selectOptions(suppliers, 'id', 'name', item?.supplierId)}</select>
      </label>
      <label>Место хранения<input name="location" placeholder="напр. Стеллаж A / Полка 2" value="${item ? escapeHtml(item.location) : ''}" /></label>
      <label>Комментарий<textarea name="comment" rows="2">${item ? escapeHtml(item.comment) : ''}</textarea></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">${item ? 'Сохранить' : 'Создать'}</button>
      </div>
    </form>
  `);

  const form = document.getElementById('stock-item-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      categoryName: fd.get('categoryName'), brandName: fd.get('brandName'), productName: fd.get('productName'),
      name: fd.get('name'), unit: fd.get('unit'), minStock: fd.get('minStock'),
      purchasePrice: fd.get('purchasePrice'), salePrice: fd.get('salePrice'), sku: fd.get('sku'),
      supplierId: fd.get('supplierId') || null, location: fd.get('location'), comment: fd.get('comment'),
    };
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      if (item) {
        await api.updateStockItem(item.id, payload);
      } else {
        await api.createStockItem(payload);
        await loadRefs();
      }
      closeModal();
      loadItems(rerender);
      if (item) loadDetail(item.id, rerender);
    } catch (err) {
      window.alert(err.message || 'Не удалось сохранить товар');
      submitBtn.disabled = false;
    }
  });
}

// ---- Income / expense / adjustment modals ----

function openIncomeModal(rerender) {
  const it = itemDetail;
  openModal(`Приход: ${escapeHtml(it.productName)}${it.name ? ' — ' + escapeHtml(it.name) : ''}`, `
    <form id="stock-income-form" class="form">
      <label>Количество<input name="qty" type="number" min="0.01" step="0.01" required /></label>
      <label>Закупочная цена<input name="price" type="number" min="0" step="0.01" value="${it.purchasePrice}" /></label>
      <label>Поставщик
        <select name="supplierId">${selectOptions(suppliers, 'id', 'name', it.supplierId)}</select>
      </label>
      <label>Комментарий<textarea name="comment" rows="2"></textarea></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Провести приход</button>
      </div>
    </form>
  `);
  document.getElementById('stock-income-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.stockIncome(it.id, { qty: fd.get('qty'), price: fd.get('price'), supplierId: fd.get('supplierId') || null, comment: fd.get('comment') });
      closeModal();
      loadItems(rerender);
      loadDetail(it.id, rerender);
    } catch (err) {
      window.alert(err.message || 'Не удалось провести приход');
    }
  });
}

function openExpenseModal(rerender) {
  const it = itemDetail;
  openModal(`Расход: ${escapeHtml(it.productName)}${it.name ? ' — ' + escapeHtml(it.name) : ''}`, `
    <form id="stock-expense-form" class="form">
      <div class="order-detail__stats" style="padding:0 0 12px;">
        <div><span>Текущий остаток</span><b>${it.qty} ${escapeHtml(it.unit)}</b></div>
        <div><span>Доступно</span><b>${it.available} ${escapeHtml(it.unit)}</b></div>
      </div>
      <label>Количество расхода<input name="qty" type="number" min="0.01" step="0.01" required /></label>
      <label>Причина
        <select name="reason">${EXPENSE_REASONS.map((r) => `<option>${r}</option>`).join('')}</select>
      </label>
      <label>Комментарий<textarea name="comment" rows="2"></textarea></label>
      <p class="form-hint">Если запрошенное количество больше доступного, потребуется право «Корректировка склада» для подтверждения.</p>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Провести расход</button>
      </div>
    </form>
  `);
  document.getElementById('stock-expense-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.stockExpense(it.id, { qty: fd.get('qty'), reason: fd.get('reason'), comment: fd.get('comment') });
      closeModal();
      loadItems(rerender);
      loadDetail(it.id, rerender);
    } catch (err) {
      window.alert(err.message || 'Не удалось провести расход');
    }
  });
}

function openAdjustmentModal(rerender) {
  const it = itemDetail;
  openModal(`Корректировка: ${escapeHtml(it.productName)}${it.name ? ' — ' + escapeHtml(it.name) : ''}`, `
    <form id="stock-adjust-form" class="form">
      <p class="form-hint">Текущий остаток: ${it.qty} ${escapeHtml(it.unit)}</p>
      <label>Новое количество<input name="qty" type="number" min="0" step="0.01" value="${it.qty}" required /></label>
      <label>Комментарий<textarea name="comment" rows="2" placeholder="Причина корректировки (инвентаризация и т.п.)"></textarea></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Сохранить</button>
      </div>
    </form>
  `);
  document.getElementById('stock-adjust-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.stockAdjustment(it.id, { qty: fd.get('qty'), comment: fd.get('comment') });
      closeModal();
      loadItems(rerender);
      loadDetail(it.id, rerender);
    } catch (err) {
      window.alert(err.message || 'Не удалось сохранить корректировку');
    }
  });
}

// ---- Categories / brands / suppliers management ----

function refRow(item) {
  const isSupplier = item.balance !== undefined;
  return `
    <div class="mat-row">
      <span class="mat-row__name">
        ${escapeHtml(item.name)}${item.phone ? ` · ${escapeHtml(item.phone)}` : ''}
        ${isSupplier ? ` · Долг: ${maskUnless('seesSupplierData', money(item.balance))}` : ''}
      </span>
      ${isSupplier && can('stock', 'income') ? `<button type="button" class="btn btn--sm" data-ref-pay-supplier="${item.id}">Оплатить</button>` : ''}
      ${isSupplier
        ? `<button type="button" class="mat-row__remove" data-ref-edit-supplier="${item.id}" title="Изменить"><i class="fa-solid fa-pen"></i></button>`
        : `<button type="button" class="mat-row__remove" data-ref-rename="${item.id}" title="Переименовать"><i class="fa-solid fa-pen"></i></button>`}
      <button type="button" class="mat-row__remove" data-ref-delete="${item.id}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>
    </div>
  `;
}

function openRefsModal(rerender) {
  openModal('Справочники склада', `
    <div class="order-detail__section-title">Категории</div>
    <div class="section-block">
      <div class="mat-rows" id="refs-categories">${categories.map((c) => refRow(c)).join('') || '<div class="empty-state empty-state--sm">Пока нет</div>'}</div>
      <form class="add-row-form" id="add-category-form">
        <input type="text" name="name" placeholder="Новая категория" required />
        <button type="submit" class="btn btn--sm"><i class="fa-solid fa-plus"></i></button>
      </form>
    </div>
    <div class="order-detail__section-title">Бренды</div>
    <div class="section-block">
      <div class="mat-rows" id="refs-brands">${brands.map((b) => refRow(b)).join('') || '<div class="empty-state empty-state--sm">Пока нет</div>'}</div>
      <form class="add-row-form" id="add-brand-form">
        <input type="text" name="name" placeholder="Новый бренд" required />
        <button type="submit" class="btn btn--sm"><i class="fa-solid fa-plus"></i></button>
      </form>
    </div>
    <div class="order-detail__section-title">Поставщики</div>
    <div class="section-block">
      <div class="mat-rows" id="refs-suppliers">${suppliers.map((s) => refRow(s)).join('') || '<div class="empty-state empty-state--sm">Пока нет</div>'}</div>
      <form class="add-row-form" id="add-supplier-form">
        <input type="text" name="name" placeholder="Название" required />
        <input type="text" name="phone" placeholder="Телефон" />
        <input type="text" name="contactPerson" placeholder="Контактное лицо" />
        <button type="submit" class="btn btn--sm"><i class="fa-solid fa-plus"></i></button>
      </form>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn--primary" id="refs-done-btn">Готово</button>
    </div>
  `);

  const modalBody = document.getElementById('modal-body');
  document.getElementById('refs-done-btn').addEventListener('click', () => {
    closeModal();
    rerender();
  });

  const catForm = document.getElementById('add-category-form');
  if (catForm) catForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(catForm);
    try {
      await api.createStockCategory({ name: fd.get('name') });
      await loadRefs();
      openRefsModal(rerender);
    } catch (err) {
      window.alert(err.message || 'Не удалось создать категорию');
    }
  });

  const brandForm = document.getElementById('add-brand-form');
  if (brandForm) brandForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(brandForm);
    try {
      await api.createStockBrand({ name: fd.get('name') });
      await loadRefs();
      openRefsModal(rerender);
    } catch (err) {
      window.alert(err.message || 'Не удалось создать бренд');
    }
  });

  const supForm = document.getElementById('add-supplier-form');
  if (supForm) supForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(supForm);
    try {
      await api.createStockSupplier({ name: fd.get('name'), phone: fd.get('phone'), contactPerson: fd.get('contactPerson') });
      await loadRefs();
      openRefsModal(rerender);
    } catch (err) {
      window.alert(err.message || 'Не удалось создать поставщика');
    }
  });

  const refActions = [
    { rows: 'refs-categories', items: categories, update: api.updateStockCategory, del: api.deleteStockCategory, noun: 'категорию' },
    { rows: 'refs-brands', items: brands, update: api.updateStockBrand, del: api.deleteStockBrand, noun: 'бренд' },
    { rows: 'refs-suppliers', items: suppliers, update: api.updateStockSupplier, del: api.deleteStockSupplier, noun: 'поставщика' },
  ];
  for (const { rows, items, update, del, noun } of refActions) {
    const container = document.getElementById(rows);
    if (!container) continue;
    container.querySelectorAll('[data-ref-rename]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-ref-rename');
        const item = items.find((it) => it.id === id);
        const newName = window.prompt('Новое название:', item?.name || '');
        if (!newName || newName === item?.name) return;
        try {
          await update(id, { name: newName });
          await loadRefs();
          openRefsModal(rerender);
        } catch (err) {
          window.alert(err.message || `Не удалось переименовать ${noun}`);
        }
      });
    });
    container.querySelectorAll('[data-ref-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm(`Удалить ${noun}?`)) return;
        try {
          await del(btn.getAttribute('data-ref-delete'));
          await loadRefs();
          openRefsModal(rerender);
        } catch (err) {
          window.alert(err.message || `Не удалось удалить ${noun}`);
        }
      });
    });
  }

  const suppliersContainer = document.getElementById('refs-suppliers');
  if (suppliersContainer) {
    suppliersContainer.querySelectorAll('[data-ref-pay-supplier]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const supplier = suppliers.find((s) => s.id === btn.getAttribute('data-ref-pay-supplier'));
        openSupplierPaymentModal(supplier, async () => { await loadRefs(); openRefsModal(rerender); });
      });
    });
    suppliersContainer.querySelectorAll('[data-ref-edit-supplier]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const supplier = suppliers.find((s) => s.id === btn.getAttribute('data-ref-edit-supplier'));
        openEditSupplierModal(supplier, rerender);
      });
    });
  }
}

function openEditSupplierModal(supplier, rerender) {
  openModal('Изменить поставщика', `
    <form id="edit-supplier-form" class="form">
      <label>Название<input name="name" required value="${escapeHtml(supplier.name)}" /></label>
      <label>Телефон<input name="phone" value="${escapeHtml(supplier.phone || '')}" /></label>
      <label>Контактное лицо<input name="contactPerson" value="${escapeHtml(supplier.contactPerson || '')}" /></label>
      <label>Комментарий<textarea name="comment" rows="2">${escapeHtml(supplier.comment || '')}</textarea></label>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Отмена</button>
        <button type="submit" class="btn btn--primary">Сохранить</button>
      </div>
    </form>
  `);

  document.getElementById('edit-supplier-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await api.updateStockSupplier(supplier.id, {
        name: fd.get('name'), phone: fd.get('phone'), contactPerson: fd.get('contactPerson'), comment: fd.get('comment'),
      });
      await loadRefs();
      openRefsModal(rerender);
    } catch (err) {
      window.alert(err.message || 'Не удалось изменить поставщика');
      submitBtn.disabled = false;
    }
  });
}
