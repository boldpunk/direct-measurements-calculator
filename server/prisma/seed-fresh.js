// Minimal seed for a brand-new real company: just the Settings row and one
// Суперадминистратор login, no demo employees/orders/clients. Use this
// (instead of seed.js, which fills the database with sample data for demos)
// when standing up a new MebelFlow instance for an actual business.
//
// Takes 4 positional arguments (quoted, so no env-var identifiers to type):
//   node prisma/seed-fresh.js "Sobirov Mebel" "Собиров" "admin@sobirovmebel.uz" "change-me"
// or the equivalent env vars (COMPANY_NAME/ADMIN_NAME/ADMIN_EMAIL/ADMIN_PASSWORD)
// if you're scripting this instead of typing it by hand.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { uid } from '../src/util.js';
import { PRESET_ROLES } from '../src/rbac.js';

const prisma = new PrismaClient();

async function main() {
  const [argCompany, argName, argEmail, argPassword] = process.argv.slice(2);
  const companyName = argCompany || process.env.COMPANY_NAME;
  const adminName = argName || process.env.ADMIN_NAME;
  const adminEmail = argEmail || process.env.ADMIN_EMAIL;
  const adminPassword = argPassword || process.env.ADMIN_PASSWORD;
  if (!companyName || !adminName || !adminEmail || !adminPassword) {
    console.error('Usage: node prisma/seed-fresh.js "<company name>" "<admin name>" "<admin email>" "<admin password>"');
    process.exit(1);
  }

  await prisma.settings.upsert({
    where: { id: 'default' },
    create: { id: 'default', companyName },
    update: { companyName },
  });

  const preset = PRESET_ROLES['Суперадминистратор'];
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const existing = await prisma.employee.findUnique({ where: { email: adminEmail } });
  if (existing) {
    console.log(`Employee ${adminEmail} already exists — leaving it untouched.`);
  } else {
    await prisma.employee.create({
      data: {
        id: uid('emp'),
        name: adminName,
        role: 'Администратор системы',
        email: adminEmail,
        passwordHash,
        createdAt: Date.now(),
        permissions: preset.permissions,
        financialFlags: preset.financialFlags,
        scopeFlags: preset.scopeFlags,
      },
    });
    console.log(`Created admin login: ${adminEmail}`);
  }

  console.log('Fresh seed complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
