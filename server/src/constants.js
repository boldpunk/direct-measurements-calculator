// Mirrors src/store.js on the frontend — keep these two in sync.

export const STAGE_DEFS = [
  { key: 'sale', name: 'Продажа', type: 'internal' },
  { key: 'measure', name: 'Замер', type: 'internal' },
  { key: 'design', name: 'Проектирование', type: 'internal' },
  { key: 'check', name: 'Проверка', type: 'internal' },
  { key: 'cutting', name: 'Аутсорс (распил/кромка)', type: 'outsource', service: 'распил' },
  { key: 'delivery', name: 'Доставка', type: 'internal' },
  { key: 'drilling', name: 'Присадка', type: 'internal' },
  { key: 'carpentry', name: 'Столярка', type: 'internal' },
  { key: 'painting', name: 'Покраска', type: 'outsource', service: 'покраска' },
  { key: 'assembly', name: 'Сборка', type: 'internal' },
  { key: 'handover', name: 'Сдача', type: 'internal' },
];

export const DEFAULT_SETTINGS = {
  companyName: 'Sobirov Mebel',
  currency: '$',
  stageBufferDays: 3,
  orderStatusColors: {},
  logoUrl: null,
  faviconUrl: null,
  enableProductType: true,
  enableWeight: true,
  enableStages: true,
  enableExpenses: true,
  enableManufacturingDates: false,
  enableServicesFinanceReport: false,
  enablePurchaseSaleSplit: false,
  enablePdfExtras: false,
  enablePurchaseList: false,
  enableCustomOrderStatuses: false,
};

// Used instead of the default Новый/Замер/.../Завершён/Отменён workflow when
// enableCustomOrderStatuses is on — sps.mebelflow.uz doesn't sell/measure/design,
// it only runs materials through a fixed cutting-service pipeline.
export const CUSTOM_ORDER_STATUSES = [
  'Закупка материалов', 'Распил', 'Кромка', 'Присадка', 'Ровер', 'Овальная кромка', 'Готово',
];

export const SALARY_ACCRUAL_TYPES = [
  'Оклад', 'Аванс', 'Премия', 'Бонус', 'Комиссия', 'Доплата', 'Отпускные', 'Другое',
];
