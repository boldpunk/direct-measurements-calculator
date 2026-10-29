// Uploaded images: POST stores one (logged-in users), GET serves it.
// GET is not behind auth on purpose — <img> can't send a token — the
// random 22-char id is the capability, as with the branding logo URL.
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah } from '../util.js';
import { requireAuth } from '../middleware/auth.js';
import { storeIfDataUri, fileIdFromUrl, FILE_URL_PREFIX } from '../stored-files.js';

const router = Router();

router.post('/', requireAuth, ah(async (req, res) => {
  const { dataUri, thumbDataUri } = req.body || {};
  if (!String(dataUri || '').startsWith('data:')) return res.status(400).json({ error: 'Ожидается изображение' });
  try {
    const url = await storeIfDataUri(dataUri, { thumb: thumbDataUri, createdById: req.employee.id });
    res.status(201).json({ url });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Не удалось сохранить файл' });
  }
}));

router.get('/:id', ah(async (req, res) => {
  const id = fileIdFromUrl(`${FILE_URL_PREFIX}${req.params.id}`);
  if (!id) return res.status(404).end();
  const wantThumb = req.query.thumb === '1';
  const file = await prisma.storedFile.findUnique({
    where: { id },
    select: { mime: true, data: !wantThumb, thumb: wantThumb },
  });
  if (!file) return res.status(404).end();
  const body = wantThumb ? (file.thumb || (await prisma.storedFile.findUnique({ where: { id }, select: { data: true } })).data) : file.data;
  res.set({
    'Content-Type': wantThumb && file.thumb ? 'image/jpeg' : file.mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  res.send(Buffer.from(body));
}));

export default router;
