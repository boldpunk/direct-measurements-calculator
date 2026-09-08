// Public (unauthenticated) branding info — just enough to paint the login
// screen and browser favicon before anyone has signed in. Everything else
// about Settings requires auth; this route intentionally exposes only these
// three non-sensitive fields.
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah } from '../util.js';
import { DEFAULT_SETTINGS } from '../constants.js';

const router = Router();

router.get('/', ah(async (req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
  res.json({
    companyName: settings?.companyName ?? DEFAULT_SETTINGS.companyName,
    logoUrl: settings?.logoUrl ?? null,
    faviconUrl: settings?.faviconUrl ?? null,
  });
}));

export default router;
