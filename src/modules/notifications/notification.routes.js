import express from "express";
import * as c from "./notification.controller.js";

export const notificationRoutes = express.Router();
const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

notificationRoutes.get("/", safe(c.listMine));
notificationRoutes.get("/unread-count", safe(c.unreadCount));
notificationRoutes.patch("/read-all", safe(c.markAllRead));
notificationRoutes.patch("/clear", safe(c.clearAll));
notificationRoutes.delete("/", safe(c.clearAll));
notificationRoutes.patch("/:id/read", safe(c.markRead));
