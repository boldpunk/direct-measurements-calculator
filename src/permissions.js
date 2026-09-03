import { getCurrentEmployee } from './api.js';

export function can(mod, action) {
  const employee = getCurrentEmployee();
  return !!employee?.permissions?.[mod]?.[action];
}

export function canAny(mod) {
  const employee = getCurrentEmployee();
  const actions = employee?.permissions?.[mod];
  return !!actions && Object.values(actions).some(Boolean);
}

export function sees(financialFlag) {
  const employee = getCurrentEmployee();
  return !!employee?.financialFlags?.[financialFlag];
}

export function currentEmployeeId() {
  return getCurrentEmployee()?.id || null;
}

// True when the current user should only see their own records for the
// given kind ('orders' | 'clients'); false when they see everything.
export function isOwnScopeOnly(kind) {
  const employee = getCurrentEmployee();
  const scope = employee?.scopeFlags;
  if (!scope || scope.allCompanyData) return false;
  if (kind === 'orders') return !!scope.ownOrdersOnly;
  if (kind === 'clients') return !!scope.ownRequestsOnly;
  return false;
}

export function maskUnless(flag, html) {
  return sees(flag) ? html : '<span class="masked-value">••••</span>';
}
