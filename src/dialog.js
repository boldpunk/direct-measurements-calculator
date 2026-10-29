// In-app confirm / prompt dialogs, replacing window.confirm / window.prompt
// (grey browser boxes that ignore the theme and, in the Android app, show
// the site address as their title).
//
// Standalone on purpose (no app imports), like toast.js: anything can use it,
// including code that runs while an openModal() dialog is already showing —
// this one stacks above it.
//
//   if (!(await confirmDialog({ title: 'Удалить клиента?', confirmLabel: 'Удалить', danger: true }))) return;
//   const qty = await promptDialog({ title: 'Количество', value: 3, type: 'number' }); // null = cancelled

function escapeText(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function open({ title, message, confirmLabel, cancelLabel, danger, input }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <form class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
        <h3 id="dialog-title">${escapeText(title)}</h3>
        ${message ? `<p class="dialog__message">${escapeText(message)}</p>` : ''}
        ${input ? `<input class="dialog__input" name="value" type="${input.type || 'text'}" value="${escapeText(input.value ?? '')}"
          ${input.type === 'number' ? 'step="any" inputmode="decimal"' : ''} ${input.placeholder ? `placeholder="${escapeText(input.placeholder)}"` : ''} required />` : ''}
        <div class="dialog__actions">
          <button type="button" class="btn" data-dialog-cancel>${escapeText(cancelLabel || 'Отмена')}</button>
          <button type="submit" class="btn ${danger ? 'btn--danger' : 'btn--primary'}">${escapeText(confirmLabel || 'OK')}</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const field = overlay.querySelector('.dialog__input');
    const previousFocus = document.activeElement;

    const finish = (value) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      previousFocus?.focus?.();
      resolve(value);
    };
    // Capture phase, so Esc closes this dialog and not the modal under it.
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(input ? null : false); }
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) finish(input ? null : false); });
    overlay.querySelector('[data-dialog-cancel]').addEventListener('click', () => finish(input ? null : false));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(input ? field.value : true);
    });
    requestAnimationFrame(() => {
      overlay.classList.add('is-visible');
      // Destructive questions start on «Отмена», so a stray Enter deletes nothing.
      if (field) { field.focus(); field.select(); } else form.querySelector(danger ? '[data-dialog-cancel]' : 'button[type="submit"]').focus();
    });
  });
}

export function confirmDialog({ title, message = '', confirmLabel = 'Да', cancelLabel = 'Отмена', danger = false }) {
  return open({ title, message, confirmLabel, cancelLabel, danger });
}

export function promptDialog({ title, message = '', value = '', type = 'text', placeholder = '', confirmLabel = 'Сохранить' }) {
  return open({ title, message, confirmLabel, input: { value, type, placeholder } });
}
