// Turning push notifications on/off for this device (Профиль → «Уведомления
// на телефон»). Needs the service worker, so it works on the real sites
// (https) and, on iPhone, only in the app added to the home screen.
import { api } from './api.js';

function base64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupport() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const iosBrowser = /iPhone|iPad/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;
    return { ok: false, reason: iosBrowser
      ? 'На iPhone уведомления работают в приложении с экрана «Домой»: Safari → «Поделиться» → «На экран Домой», затем откройте MebelFlow оттуда.'
      : 'Этот браузер не поддерживает уведомления.' };
  }
  return { ok: true };
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('Уведомления доступны на сайте после полной загрузки — обновите страницу и попробуйте снова.');
  return navigator.serviceWorker.ready;
}

export async function currentSubscription() {
  if (!pushSupport().ok) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Уведомления запрещены. Разрешите их в настройках браузера или телефона для этого сайта.');
  const reg = await registration();
  const { publicKey } = await api.getPushKey();
  const sub = (await reg.pushManager.getSubscription())
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) });
  await api.pushSubscribe(sub.toJSON());
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
