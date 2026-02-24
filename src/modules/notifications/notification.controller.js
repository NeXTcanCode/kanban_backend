import * as notifications from "./notification.service.js";

export async function listMine(req, res) {
  const items = await notifications.listMyNotifications(req.auth.userId);
  res.json(items);
}

export async function unreadCount(req, res) {
  const unread = await notifications.unreadCount(req.auth.userId);
  res.json({ unreadCount: unread });
}

export async function markRead(req, res) {
  const item = await notifications.markRead(req.auth.userId, req.params.id);
  await notifications.emitUnreadCount(req.auth.userId);
  res.json(item);
}

export async function markAllRead(req, res) {
  await notifications.markAllRead(req.auth.userId);
  await notifications.emitUnreadCount(req.auth.userId);
  res.json({ ok: true });
}

export async function clearAll(req, res) {
  await notifications.clearAll(req.auth.userId);
  await notifications.emitUnreadCount(req.auth.userId);
  res.json({ ok: true });
}
