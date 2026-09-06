// RBAC schema: modules/actions that exist in MebelFlow today, financial
// visibility flags, object-scope flags, and the 9 preset roles from the spec
// mapped onto those modules. CRM / Конструкторский отдел / Закупки don't
// exist as standalone modules, so roles referencing them (Технолог,
// Закупщик) are mapped onto the closest existing equivalent and documented
// inline — see mirrored copy at src/rbac-schema.js on the frontend. Склад
// (Кладовщик's home module) is a real module — see MODULES.stock below.

export const MODULES = {
  orders: ['view', 'create', 'edit', 'close', 'cancel', 'delete', 'export'],
  production: ['view', 'changeStatus', 'assign'],
  carpentry: ['view', 'create', 'edit', 'delete', 'changeStatus'],
  rework: ['view', 'create', 'edit', 'delete'],
  tasks: ['view', 'create', 'edit', 'delete'],
  outsource: ['view', 'create', 'edit', 'delete'],
  finance: ['view', 'addPayment', 'editPayment', 'deletePayment', 'export'],
  clients: ['view', 'create', 'edit', 'delete'],
  stock: ['view', 'create', 'edit', 'delete', 'income', 'expense', 'adjustment', 'export'],
  employees: ['create', 'edit', 'block', 'delete'],
  settings: ['edit', 'manageRoles'],
};

export const FINANCIAL_FLAGS = [
  'seesPurchasePrices', 'seesCostPrice', 'seesProfit', 'seesMargin',
  'seesSalaries', 'seesFinanceAnalytics', 'seesSupplierData',
];

export const SCOPE_FLAGS = ['ownRequestsOnly', 'ownOrdersOnly', 'ownDepartmentOnly', 'allCompanyData'];

export function emptyPermissions() {
  const perms = {};
  for (const [mod, actions] of Object.entries(MODULES)) {
    perms[mod] = {};
    actions.forEach((a) => { perms[mod][a] = false; });
  }
  return perms;
}

export function fullPermissions() {
  const perms = {};
  for (const [mod, actions] of Object.entries(MODULES)) {
    perms[mod] = {};
    actions.forEach((a) => { perms[mod][a] = true; });
  }
  return perms;
}

export function emptyFinancialFlags() {
  const f = {};
  FINANCIAL_FLAGS.forEach((k) => { f[k] = false; });
  return f;
}

export function fullFinancialFlags() {
  const f = {};
  FINANCIAL_FLAGS.forEach((k) => { f[k] = true; });
  return f;
}

export function defaultScopeFlags() {
  return { ownRequestsOnly: false, ownOrdersOnly: false, ownDepartmentOnly: false, allCompanyData: true };
}

function permSet(overrides) {
  const p = emptyPermissions();
  Object.entries(overrides).forEach(([mod, actions]) => {
    p[mod] = { ...p[mod], ...actions };
  });
  return p;
}

export const PRESET_ROLES = {
  'Суперадминистратор': {
    permissions: fullPermissions(),
    financialFlags: fullFinancialFlags(),
    scopeFlags: defaultScopeFlags(),
  },
  'Руководитель': {
    permissions: (() => {
      const p = fullPermissions();
      p.settings = { edit: false, manageRoles: false };
      return p;
    })(),
    financialFlags: fullFinancialFlags(),
    scopeFlags: defaultScopeFlags(),
  },
  'Менеджер продаж': {
    permissions: permSet({
      clients: { view: true, create: true, edit: true },
      orders: { view: true, create: true, edit: true },
      stock: { view: true },
    }),
    financialFlags: emptyFinancialFlags(),
    scopeFlags: defaultScopeFlags(),
  },
  // "Конструкторский отдел" doesn't exist yet -> mapped onto Производство + Столярка.
  'Технолог': {
    permissions: permSet({
      production: { view: true, changeStatus: true },
      carpentry: { view: true, create: true, edit: true, changeStatus: true },
    }),
    financialFlags: emptyFinancialFlags(),
    scopeFlags: defaultScopeFlags(),
  },
  'Производственник': {
    permissions: permSet({
      production: { view: true, changeStatus: true },
      carpentry: { view: true, changeStatus: true },
      tasks: { view: true },
    }),
    financialFlags: emptyFinancialFlags(),
    scopeFlags: { ownRequestsOnly: false, ownOrdersOnly: false, ownDepartmentOnly: true, allCompanyData: false },
  },
  'Кладовщик': {
    permissions: permSet({
      stock: { view: true, create: true, edit: true, delete: true, income: true, expense: true, adjustment: true, export: true },
      orders: { view: true },
    }),
    financialFlags: { ...emptyFinancialFlags(), seesPurchasePrices: true, seesSupplierData: true },
    scopeFlags: defaultScopeFlags(),
  },
  // "Закупки" doesn't exist as a standalone module -> mapped onto Аутсорс
  // (closest thing to a supplier directory) plus Склад's income/supplier side.
  'Закупщик': {
    permissions: permSet({
      outsource: { view: true, create: true, edit: true, delete: true },
      orders: { view: true },
      stock: { view: true, income: true, edit: true },
    }),
    financialFlags: { ...emptyFinancialFlags(), seesPurchasePrices: true, seesSupplierData: true },
    scopeFlags: defaultScopeFlags(),
  },
  'Бухгалтер': {
    permissions: permSet({
      finance: { view: true, addPayment: true, editPayment: true, deletePayment: true, export: true },
      orders: { view: true, export: true },
    }),
    financialFlags: fullFinancialFlags(),
    scopeFlags: defaultScopeFlags(),
  },
  'Монтажник': {
    permissions: permSet({
      orders: { view: true },
      tasks: { view: true },
      carpentry: { view: true, changeStatus: true },
    }),
    financialFlags: emptyFinancialFlags(),
    scopeFlags: { ownRequestsOnly: false, ownOrdersOnly: true, ownDepartmentOnly: false, allCompanyData: false },
  },
};

export function can(employee, mod, action) {
  if (!employee || !employee.permissions) return false;
  return !!employee.permissions[mod]?.[action];
}
