export function money(n) {
  const v = Number(n) || 0;
  return `${v.toLocaleString('ru-RU')} $`;
}

export function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function statusBadgeClass(status) {
  switch (status) {
    case 'готово': return 'badge badge--done';
    case 'в работе': return 'badge badge--active';
    case 'проверка': return 'badge badge--review';
    case 'ожидает': return 'badge badge--pending';
    default: return 'badge';
  }
}

export function priorityBadgeClass(priority) {
  switch (priority) {
    case 'срочный': return 'badge badge--urgent';
    case 'переделка': return 'badge badge--rework';
    default: return 'badge badge--muted';
  }
}
