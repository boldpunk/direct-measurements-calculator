// One-off (and idempotent): moves base64 images still stored inline in rows
// into StoredFile, replacing them with "/api/files/<id>". deploy.sh runs it
// after migrations; with nothing left to move it just reports 0.
//
//   node scripts/move-images-to-files.js
import 'dotenv/config';
import { prisma } from '../src/prisma.js';
import { storeIfDataUri } from '../src/stored-files.js';

const TARGETS = [
  { model: 'commercialProposalItem', field: 'imageUrl' },
  { model: 'brand', field: 'logoUrl' },
  { model: 'rework', field: 'photoUrl' },
];

export async function moveImages() {
  const report = {};
  for (const { model, field } of TARGETS) {
    const rows = await prisma[model].findMany({ where: { [field]: { startsWith: 'data:' } }, select: { id: true, [field]: true } });
    let moved = 0;
    let bytes = 0;
    for (const row of rows) {
      try {
        const url = await storeIfDataUri(row[field]);
        await prisma[model].update({ where: { id: row.id }, data: { [field]: url } });
        moved += 1;
        bytes += row[field].length;
      } catch (e) {
        console.warn(`skip ${model} ${row.id}: ${e.message}`);
      }
    }
    report[`${model}.${field}`] = { moved, mb: Math.round(bytes / 10485.76) / 100 };
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  moveImages()
    .then((r) => console.log('images → StoredFile:', JSON.stringify(r)))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
