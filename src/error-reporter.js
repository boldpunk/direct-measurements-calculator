// Sends uncaught errors from this tab to the server (Журнал действий →
// «Ошибки»), so problems on staff phones are seen without anyone reporting
// them. Each distinct error once per session, at most 20 per session.
import { getToken, apiUrl } from './api.js';

const sent = new Set();
let budget = 20;

// Browser noise and extensions — not our bugs.
const IGNORE = [/ResizeObserver loop/, /^Script error\.?$/, /chrome-extension:|moz-extension:|safari-extension:/];

function report(message, stack) {
  const msg = String(message || '').slice(0, 1000);
  if (!msg || IGNORE.some((re) => re.test(msg) || re.test(stack || ''))) return;
  const key = `${msg}|${String(stack || '').split('\n')[1] || ''}`;
  if (sent.has(key) || budget <= 0) return;
  sent.add(key);
  budget -= 1;
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  fetch(apiUrl('/api/client-errors'), {
    method: 'POST', headers, keepalive: true,
    body: JSON.stringify({ message: msg, stack: String(stack || '').slice(0, 4000), url: window.location.href.split('?')[0] }),
  }).catch(() => {});
}

export function initErrorReporter() {
  window.addEventListener('error', (e) => report(e.message, e.error?.stack));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    // Network failures are handled (and shown) by the app itself.
    if (r?.name === 'ApiError' || r?.status !== undefined) return;
    report(r?.message || String(r), r?.stack);
  });
}
