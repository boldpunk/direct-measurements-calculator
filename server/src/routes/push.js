import { Router } from 'express';
import { ah } from '../util.js';
import { publicKey, saveSubscription, removeSubscription, notifyEmployees } from '../push.js';

const router = Router();

router.get('/key', ah(async (req, res) => res.json({ publicKey: await publicKey() })));

router.post('/subscribe', ah(async (req, res) => {
  try {
    await saveSubscription(req.employee.id, req.body?.subscription, req.headers['user-agent']);
    res.status(204).end();
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}));

router.post('/unsubscribe', ah(async (req, res) => {
  await removeSubscription(req.body?.endpoint);
  res.status(204).end();
}));

// «Проверить» button: a test notification to your own devices.
router.post('/test', ah(async (req, res) => {
  notifyEmployees([req.employee.id], { title: 'MebelFlow', body: 'Уведомления работают 👍', url: '/#/dashboard' });
  res.status(204).end();
}));

export default router;
