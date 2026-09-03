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
};
