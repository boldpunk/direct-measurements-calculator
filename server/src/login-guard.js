// Per-IP brake on failed logins. The per-account lockout (5 wrong passwords
// → 15 min, routes/auth.js) stops guessing one password, but not trying a
// few passwords against many emails from one address — nor someone locking
// out a colleague on purpose. Here: more than IP_MAX_FAILURES failures from
// one IP within IP_WINDOW_MS and that IP gets 429 until the window passes.
// In memory: a restart resets it, which is fine for a brake.
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_FAILURES = 20;
const failures = new Map(); // ip -> [timestamps]

function recent(ip, now) {
  const list = (failures.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
  if (list.length) failures.set(ip, list); else failures.delete(ip);
  return list;
}

// Minutes until this IP may try again, or 0.
export function ipBlockedMinutes(ip, now = Date.now()) {
  const list = recent(ip, now);
  if (list.length < IP_MAX_FAILURES) return 0;
  return Math.max(1, Math.ceil((list[0] + IP_WINDOW_MS - now) / 60000));
}

export function noteFailure(ip, now = Date.now()) {
  const list = recent(ip, now);
  list.push(now);
  failures.set(ip, list);
  // Bound memory under a flood of distinct IPs.
  if (failures.size > 10000) failures.delete(failures.keys().next().value);
}

export function resetLoginGuard() {
  failures.clear();
}
