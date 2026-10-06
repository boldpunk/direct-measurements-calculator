// Small non-blocking status message in the corner of the screen.
//
// Standalone on purpose (no imports): store.js reports failed background
// saves through it, and ui.js/format.js both import store.js, so pulling
// either in here would make an import cycle.

let hideTimer = null;

function escapeText(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function showToast(message, { tone = 'success', duration } = {}) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    el.addEventListener('click', () => el.classList.remove('is-visible'));
  }
  const icon = tone === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';
  el.className = `toast toast--${tone}`;
  el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeText(message)}</span>`;
  // Next frame, so a toast replacing a visible one still animates in.
  requestAnimationFrame(() => el.classList.add('is-visible'));
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el.classList.remove('is-visible'), duration ?? (tone === 'error' ? 6000 : 2600));
}
