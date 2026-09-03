export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Wrap an async route handler so rejected promises reach Express's error middleware.
export function ah(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}
