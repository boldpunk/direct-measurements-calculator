// Shared "Вчера/Сегодня/3 дня/период/год" date-range filter, used on the
// Заказы and Финансы pages. Filters by order.createdAt (when the order was
// created), not by deadline.

export const PERIOD_PRESETS = [
  { key: '', label: 'Всё время' },
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'last3days', label: 'Последние 3 дня' },
  { key: 'lastyear', label: 'Последний год' },
  { key: 'custom', label: 'Выбрать период' },
];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}

export function getPeriodRange(key, customFrom, customTo) {
  const now = new Date();
  switch (key) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case 'last3days': {
      const start = new Date(now);
      start.setDate(start.getDate() - 2);
      return { from: startOfDay(start), to: endOfDay(now) };
    }
    case 'lastyear': {
      const start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
      return { from: startOfDay(start), to: endOfDay(now) };
    }
    case 'custom':
      return {
        from: customFrom ? startOfDay(new Date(customFrom)) : null,
        to: customTo ? endOfDay(new Date(customTo)) : null,
      };
    default:
      return { from: null, to: null };
  }
}

export function inPeriodRange(timestamp, range) {
  if (range.from != null && timestamp < range.from) return false;
  if (range.to != null && timestamp > range.to) return false;
  return true;
}

export function renderPeriodFilter(idPrefix, { periodKey, customFrom, customTo }) {
  return `
    <select id="${idPrefix}-period-select">
      ${PERIOD_PRESETS.map((p) => `<option value="${p.key}" ${p.key === periodKey ? 'selected' : ''}>${p.label}</option>`).join('')}
    </select>
    <span id="${idPrefix}-period-custom" class="period-filter-custom" ${periodKey === 'custom' ? '' : 'hidden'}>
      <input type="date" id="${idPrefix}-period-from" value="${customFrom || ''}" />
      <input type="date" id="${idPrefix}-period-to" value="${customTo || ''}" />
    </span>
  `;
}

// onChange(periodKey, customFrom, customTo)
export function attachPeriodFilter(root, idPrefix, onChange) {
  const select = root.querySelector(`#${idPrefix}-period-select`);
  const customWrap = root.querySelector(`#${idPrefix}-period-custom`);
  const fromInput = root.querySelector(`#${idPrefix}-period-from`);
  const toInput = root.querySelector(`#${idPrefix}-period-to`);
  if (!select) return;

  select.addEventListener('change', () => {
    if (customWrap) customWrap.hidden = select.value !== 'custom';
    onChange(select.value, fromInput?.value, toInput?.value);
  });
  if (fromInput) fromInput.addEventListener('change', () => onChange(select.value, fromInput.value, toInput?.value));
  if (toInput) toInput.addEventListener('change', () => onChange(select.value, fromInput?.value, toInput.value));
}
