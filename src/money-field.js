import { getSettings } from './store.js';
import { escapeHtml } from './format.js';

function groupDigits(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function renderMoneyField({ name, label = 'Сумма', value = '', required = false }) {
  const currency = getSettings().currency;
  const digits = value !== '' && value != null ? String(Math.round(Number(value) || 0)) : '';
  const display = digits ? groupDigits(digits) : '';

  return `
    <label>${label}
      <div class="money-field" data-money-field>
        <input type="text" inputmode="numeric" class="money-field__input"
          placeholder="0" value="${display}" ${required ? 'required' : ''} />
        <span class="money-field__suffix">${escapeHtml(currency)}</span>
        <input type="hidden" name="${name}" value="${digits}" />
      </div>
    </label>
  `;
}

export function attachMoneyFields(root) {
  root.querySelectorAll('[data-money-field]').forEach((field) => {
    const input = field.querySelector('.money-field__input');
    const hidden = field.querySelector('input[type="hidden"]');
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '');
      input.value = groupDigits(digits);
      hidden.value = digits;
    });
  });
}
