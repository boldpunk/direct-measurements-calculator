// Shared helpers for StoredFile (see schema.prisma): turning data URIs into
// stored files, and reading "/api/files/<id>" back for the PDF renderers.
import crypto from 'node:crypto';
import { prisma } from './prisma.js';
import { parseDataUri } from './branding-assets.js';

export const FILE_URL_PREFIX = '/api/files/';
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
// No SVG: opened directly it could run script on our origin.
export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Unguessable: the URL is the capability (images are shown via <img>, which
// can't send the auth header).
export const newFileId = () => crypto.randomBytes(16).toString('base64url');

export function fileIdFromUrl(url) {
  const s = String(url || '');
  const i = s.indexOf(FILE_URL_PREFIX);
  if (i < 0) return null;
  const id = s.slice(i + FILE_URL_PREFIX.length).split(/[?#]/)[0];
  return /^[A-Za-z0-9_-]{10,64}$/.test(id) ? id : null;
}

// Stores a data URI and returns its URL; anything else (http URL, '', null,
// an already-stored /api/files URL) comes back unchanged.
export async function storeIfDataUri(value, { thumb = null, createdById = null, db = prisma } = {}) {
  const parsed = parseDataUri(value);
  if (!parsed) return value;
  if (!ALLOWED_MIME.has(parsed.type)) throw Object.assign(new Error('Неподдерживаемый формат изображения'), { status: 400 });
  if (parsed.body.length > MAX_FILE_BYTES) throw Object.assign(new Error('Файл больше 8 МБ'), { status: 413 });
  const thumbParsed = parseDataUri(thumb);
  const id = newFileId();
  await db.storedFile.create({
    data: {
      id, mime: parsed.type, data: parsed.body, size: parsed.body.length, createdAt: Date.now(), createdById,
      thumb: thumbParsed && ALLOWED_MIME.has(thumbParsed.type) && thumbParsed.body.length < parsed.body.length ? thumbParsed.body : null,
    },
  });
  return `${FILE_URL_PREFIX}${id}`;
}

// Bytes for a "/api/files/<id>" URL (for PDFKit), or null.
export async function readStoredFile(url) {
  const id = fileIdFromUrl(url);
  if (!id) return null;
  const file = await prisma.storedFile.findUnique({ where: { id }, select: { data: true } });
  return file ? Buffer.from(file.data) : null;
}

// Middleware: any of these body fields arriving as a data URI is stored and
// replaced by its file URL before the route sees it — so rows never get
// base64 again, even from an old cached app version.
export function dataUrisToFiles(fields) {
  return async (req, res, next) => {
    try {
      const body = req.body;
      if (body && typeof body === 'object') {
        for (const field of fields) {
          if (typeof body[field] === 'string' && body[field].startsWith('data:')) {
            body[field] = await storeIfDataUri(body[field], { createdById: req.employee?.id || null });
          }
        }
      }
      next();
    } catch (e) {
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Не удалось сохранить изображение' });
    }
  };
}
