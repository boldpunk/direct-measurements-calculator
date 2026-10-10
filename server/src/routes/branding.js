// Public (unauthenticated) branding info — just enough to paint the login
// screen and browser favicon before anyone has signed in. Everything else
// about Settings requires auth; this route intentionally exposes only these
// three non-sensitive fields.
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah } from '../util.js';
import { DEFAULT_SETTINGS } from '../constants.js';
import { brandingAssetUrl, parseDataUri } from '../branding-assets.js';

const router = Router();

router.get('/', ah(async (req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
  res.json({
    companyName: settings?.companyName ?? DEFAULT_SETTINGS.companyName,
    logoUrl: brandingAssetUrl('logo', settings?.logoUrl),
    faviconUrl: brandingAssetUrl('favicon', settings?.faviconUrl),
  });
}));

// The image bytes behind the URLs above. The ?v= hash changes whenever the
// image does, so the response can be cached for good.
for (const kind of ['logo', 'favicon']) {
  router.get(`/${kind}`, ah(async (req, res) => {
    const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
    const asset = parseDataUri(settings?.[`${kind}Url`]);
    if (!asset) return res.status(404).end();
    res.set('Content-Type', asset.type);
    res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(asset.body);
  }));
}

export default router;
