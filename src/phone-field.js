import { escapeHtml } from './format.js';
import {
  DEFAULT_COUNTRY, getCountryGroups, guessCountryFromValue,
  nationalDigitsFromValue, formatAsYouType,
} from './phone.js';
import { getCountryCallingCode } from 'libphonenumber-js';

export function renderPhoneField({ name, label = 'Телефон', value = '', required = false }) {
  const iso2 = guessCountryFromValue(value, DEFAULT_COUNTRY);
  const digits = nationalDigitsFromValue(value, iso2);
  const { formatted, e164 } = formatAsYouType(iso2, digits);

  return `
    <label>${label}
      <div class="phone-field" data-phone-field data-country="${iso2}">
        <button type="button" class="phone-field__country" data-role="phone-toggle" aria-haspopup="listbox">
          <span class="fi fi-${iso2.toLowerCase()}"></span>
          <span class="phone-field__code">+${getCountryCallingCode(iso2)}</span>
          <i class="fa-solid fa-chevron-down phone-field__chevron"></i>
        </button>
        <input type="tel" class="phone-field__input" inputmode="tel" autocomplete="tel"
          placeholder="Номер телефона" value="${escapeHtml(formatted)}" ${required ? 'required' : ''} />
        <input type="hidden" name="${name}" value="${escapeHtml(e164)}" />
        ${renderDropdown()}
      </div>
    </label>
  `;
}

function renderDropdown() {
  const groups = getCountryGroups();
  return `
    <div class="phone-field__dropdown" hidden>
      <div class="phone-field__search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" placeholder="Поиск страны" />
      </div>
      <div class="phone-field__list" role="listbox">
        ${groups.map((g) => `
          <div class="phone-field__group-label">${g.label}</div>
          ${g.items.map((c) => `
            <button type="button" class="phone-field__option" data-iso2="${c.iso2}">
              <span class="fi fi-${c.iso2.toLowerCase()}"></span>
              <span class="phone-field__option-name">${escapeHtml(c.name)}</span>
              <span class="phone-field__option-code">+${c.callingCode}</span>
            </button>
          `).join('')}
        `).join('')}
      </div>
    </div>
  `;
}

function closeAllDropdowns(except) {
  document.querySelectorAll('.phone-field__dropdown').forEach((d) => {
    if (d !== except) d.hidden = true;
  });
}

function initPhoneField(field) {
  let iso2 = field.dataset.country || DEFAULT_COUNTRY;
  const input = field.querySelector('.phone-field__input');
  const hidden = field.querySelector('input[type="hidden"]');
  const toggle = field.querySelector('[data-role="phone-toggle"]');
  const flagEl = toggle.querySelector('.fi');
  const codeLabel = toggle.querySelector('.phone-field__code');
  const dropdown = field.querySelector('.phone-field__dropdown');
  const searchInput = field.querySelector('.phone-field__search input');
  const list = field.querySelector('.phone-field__list');

  function applyFormat(digits) {
    const { formatted, e164 } = formatAsYouType(iso2, digits);
    input.value = formatted;
    hidden.value = e164;
  }

  function setCountry(newIso2) {
    iso2 = newIso2;
    field.dataset.country = iso2;
    flagEl.className = `fi fi-${iso2.toLowerCase()}`;
    codeLabel.textContent = `+${getCountryCallingCode(iso2)}`;
    applyFormat(input.value.replace(/\D/g, ''));
  }

  function filterOptions(query) {
    const q = query.trim().toLowerCase();
    list.querySelectorAll('.phone-field__option').forEach((opt) => {
      opt.hidden = !!q && !opt.textContent.toLowerCase().includes(q);
    });
    list.querySelectorAll('.phone-field__group-label').forEach((groupLabel) => {
      let node = groupLabel.nextElementSibling;
      let anyVisible = false;
      while (node && !node.classList.contains('phone-field__group-label')) {
        if (!node.hidden) anyVisible = true;
        node = node.nextElementSibling;
      }
      groupLabel.hidden = !anyVisible;
    });
  }

  input.addEventListener('input', () => applyFormat(input.value.replace(/\D/g, '')));

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = dropdown.hidden;
    closeAllDropdowns();
    dropdown.hidden = !willOpen;
    if (willOpen) {
      searchInput.value = '';
      filterOptions('');
      searchInput.focus();
    }
  });

  searchInput.addEventListener('click', (e) => e.stopPropagation());
  searchInput.addEventListener('input', () => filterOptions(searchInput.value));

  list.querySelectorAll('.phone-field__option').forEach((opt) => {
    opt.addEventListener('click', () => {
      setCountry(opt.dataset.iso2);
      dropdown.hidden = true;
      input.focus();
    });
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.hidden && !field.contains(e.target)) dropdown.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dropdown.hidden) dropdown.hidden = true;
  });
}

export function attachPhoneFields(root) {
  root.querySelectorAll('[data-phone-field]').forEach(initPhoneField);
}
