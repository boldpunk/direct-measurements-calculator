// Turns this instance's per-company feature toggles on or off directly in
// the database — no HTTP/auth/JSON round-trip needed, so it's safe to run
// from a console that mangles curl one-liners full of quotes/braces/@.
//
// Usage: node prisma/set-feature-flags.js <on|off>
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const mode = process.argv[2];

if (!['on', 'off'].includes(mode)) {
  console.error('Usage: node prisma/set-feature-flags.js <on|off>');
  process.exit(1);
}

const enabled = mode === 'on';

async function main() {
  const settings = await prisma.settings.upsert({
    where: { id: 'default' },
    create: { id: 'default', enableProductType: enabled, enableWeight: enabled, enableStages: enabled },
    update: { enableProductType: enabled, enableWeight: enabled, enableStages: enabled },
  });
  console.log(`Feature toggles set to "${mode}":`);
  console.log(`  enableProductType = ${settings.enableProductType}`);
  console.log(`  enableWeight      = ${settings.enableWeight}`);
  console.log(`  enableStages      = ${settings.enableStages}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
