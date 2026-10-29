// Web Push: notifications on staff phones (Android app, PWA on iPhone home
// screen, desktop browsers) — "вам назначили этап", "пришла оплата"…
// VAPID keys are generated on first use and kept in this company's Settings.
import webpush from 'web-push';
import { prisma } from './prisma.js';
import { uid } from './util.js';

let configured = null;

async function vapid() {
  if (configured) return configured;
  let s = await prisma.settings.findUnique({ where: { id: 'default' }, select: { vapidPublicKey: true, vapidPrivateKey: true } });
  if (!s?.vapidPublicKey) {
    const keys = webpush.generateVAPIDKeys();
    await prisma.settings.update({ where: { id: 'default' }, data: { vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey } });
    s = { vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey };
  }
  webpush.setVapidDetails('mailto:noreply@mebelflow.uz', s.vapidPublicKey, s.vapidPrivateKey);
  configured = { publicKey: s.vapidPublicKey };
  return configured;
}

export async function publicKey() {
  return (await vapid()).publicKey;
}

export async function saveSubscription(employeeId, sub, userAgent = '') {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw Object.assign(new Error('Некорректная подписка'), { status: 400 });
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { id: uid('psh'), employeeId, endpoint: sub.endpoint, keys: sub.keys, userAgent: String(userAgent).slice(0, 300), createdAt: Date.now() },
    update: { employeeId, keys: sub.keys },
  });
}

export async function removeSubscription(endpoint) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint: String(endpoint || '') } });
}

// Fire-and-forget: never slows down or fails the request that triggered it.
// payload: { title, body, url }
export function notifyEmployees(employeeIds, payload) {
  const ids = [...new Set((employeeIds || []).filter(Boolean))];
  if (!ids.length) return;
  (async () => {
    try {
      await vapid();
      const subs = await prisma.pushSubscription.findMany({ where: { employeeId: { in: ids } } });
      await Promise.all(subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 6 * 3600 });
        } catch (e) {
          // 404/410: the device unsubscribed or the app was removed.
          if (e.statusCode === 404 || e.statusCode === 410) await removeSubscription(s.endpoint);
        }
      }));
    } catch (e) {
      console.error('push failed', e);
    }
  })();
}
