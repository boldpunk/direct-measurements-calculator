// Turns this instance's per-company feature toggles on or off directly in
// the database — no HTTP/auth/JSON round-trip needed, so it's safe to run
// from a console that mangles curl one-liners full of quotes/braces/@.
//
// Usage: node prisma/set-feature-flags.js <flag>=on|off [<flag>=on|off ...]
// Flags: productType, weight, stages, expenses, manufacturing,
//        servicesReport, purchaseSaleSplit, pdfExtras, purchaseList, customStatuses
// Only the flags you name are changed — everything else is left as-is.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FIELD_MAP = {
  productType: 'enableProductType',
  weight: 'enableWeight',
  stages: 'enableStages',
  expenses: 'enableExpenses',
  manufacturing: 'enableManufacturingDates',
  servicesReport: 'enableServicesFinanceReport',
  purchaseSaleSplit: 'enablePurchaseSaleSplit',
  pdfExtras: 'enablePdfExtras',
  purchaseList: 'enablePurchaseList',
  customStatuses: 'enableCustomOrderStatuses',
};

function usage() {
  console.error('Usage: node prisma/set-feature-flags.js <flag>=on|off [<flag>=on|off ...]');
  console.error(`Flags: ${Object.keys(FIELD_MAP).join(', ')}`);
}

const data = {};
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.split('=');
  const field = FIELD_MAP[key];
  if (!field || (value !== 'on' && value !== 'off')) {
    console.error(`Bad argument: ${arg}`);
    usage();
    process.exit(1);
  }
  data[field] = value === 'on';
}

if (!Object.keys(data).length) {
  usage();
  process.exit(1);
}

async function main() {
  const settings = await prisma.settings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...data },
    update: data,
  });
  console.log('Feature toggles now:');
  for (const field of Object.values(FIELD_MAP)) {
    console.log(`  ${field} = ${settings[field]}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
