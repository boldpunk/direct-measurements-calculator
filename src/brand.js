// The MebelFlow mark, drawn inline rather than as a PNG: it stays sharp at any
// size, needs no extra request, and the wordmark uses the app's own (bundled)
// Inter font. Same artwork as public/favicon/src/icon.svg.
//
// An instance that uploaded its own logo in Настройки gets that image instead.
import { escapeHtml } from './format.js';

const ICON = `
  <svg class="brand-icon" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="mf-brand-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#3B82F6"/>
        <stop offset="1" stop-color="#1D4ED8"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="116" fill="url(#mf-brand-grad)"/>
    <path d="M148 332V148l108 112 108-112v184" fill="none" stroke="#fff" stroke-width="54" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="206" y="366" width="100" height="26" rx="13" fill="#FBBF24"/>
  </svg>`;

const WORDMARK = '<span class="brand-word">mebel<span class="brand-word__accent">flow</span></span>';

// layout: 'row' (header) or 'stack' (login card).
export function brandLogo(customUrl, { layout = 'row', imgClass = 'logo__img' } = {}) {
  if (customUrl) return `<img src="${escapeHtml(customUrl)}" alt="Логотип" class="${imgClass}" />`;
  return `<span class="brand brand--${layout}" aria-label="MebelFlow">${ICON}${WORDMARK}</span>`;
}
