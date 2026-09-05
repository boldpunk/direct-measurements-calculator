// Frontend mirror of server/src/rbac.js's module/action shape, plus Russian
// labels for rendering the permission matrix in the Сотрудники admin UI.
// The actual preset role matrices are fetched from the server
// (GET /api/employees/roles) rather than duplicated here.

export const MODULES = {
  orders: ['view', 'create', 'edit', 'close', 'cancel', 'delete', 'export'],
  production: ['view', 'changeStatus', 'assign'],
  carpentry: ['view', 'create', 'edit', 'delete', 'changeStatus'],
  rework: ['view', 'create', 'edit', 'delete'],
  tasks: ['view', 'create', 'edit', 'delete'],
  outsource: ['view', 'create', 'edit', 'delete'],
  finance: ['view', 'addPayment', 'editPayment', 'deletePayment', 'export'],
  clients: ['view', 'create', 'edit', 'delete'],
  employees: ['create', 'edit', 'block', 'delete'],
  settings: ['edit', 'manageRoles'],
};

export const MODULE_LABELS = {
  orders: 'Заказы', production: 'Производство', carpentry: 'Столярка', rework: 'Переделки',
  tasks: 'Задачи', outsource: 'Аутсорс', finance: 'Финансы', clients: 'Клиенты',
  employees: 'Сотрудники', settings: 'Настройки',
};

export const ACTION_LABELS = {
  view: 'Просмотр', create: 'Создание', edit: 'Редактирование', delete: 'Удаление', export: 'Экспорт',
  close: 'Закрытие', cancel: 'Отмена', changeStatus: 'Изменение статуса', assign: 'Назначение исполнителей',
  addPayment: 'Внесение платежей', editPayment: 'Редактирование платежей', deletePayment: 'Удаление платежей',
  block: 'Блокировка', manageRoles: 'Управление ролями',
};

export const FINANCIAL_FLAGS = [
  'seesPurchasePrices', 'seesCostPrice', 'seesProfit', 'seesMargin',
  'seesSalaries', 'seesFinanceAnalytics', 'seesSupplierData',
];

export const FINANCIAL_FLAG_LABELS = {
  seesPurchasePrices: 'Видит закупочные цены материалов',
  seesCostPrice: 'Видит себестоимость заказа',
  seesProfit: 'Видит прибыль заказа',
  seesMargin: 'Видит маржинальность',
  seesSalaries: 'Видит зарплаты сотрудников',
  seesFinanceAnalytics: 'Видит финансовую аналитику',
  seesSupplierData: 'Видит данные поставщиков',
};

export const SCOPE_FLAGS = ['ownRequestsOnly', 'ownOrdersOnly', 'ownDepartmentOnly', 'allCompanyData'];

export const SCOPE_FLAG_LABELS = {
  ownRequestsOnly: 'Видит только своих клиентов',
  ownOrdersOnly: 'Видит только свои заказы',
  ownDepartmentOnly: 'Видит только свой отдел (в системе пока нет отделов)',
  allCompanyData: 'Видит все данные компании',
};

export function emptyPermissions() {
  const perms = {};
  for (const [mod, actions] of Object.entries(MODULES)) {
    perms[mod] = {};
    actions.forEach((a) => { perms[mod][a] = false; });
  }
  return perms;
}
