import mongoose from "mongoose";
import { ApiError } from "../../utils/apiError.js";
import { NotificationModel } from "./notification.model.js";
import { emitToUser } from "../../realtime/socket.js";

function toDto(doc) {
  return {
    id: String(doc._id),
    recipientId: String(doc.recipient),
    taskId: String(doc.task),
    type: doc.type,
    message: doc.message,
    readAt: doc.readAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

export async function listMyNotifications(userId) {
  const docs = await NotificationModel.find({ recipient: userId }).sort({ createdAt: -1 }).limit(200);
  return docs.map(toDto);
}

export async function unreadCount(userId) {
  return NotificationModel.countDocuments({ recipient: userId, readAt: null });
}

export async function markRead(userId, notificationId) {
  if (!mongoose.Types.ObjectId.isValid(notificationId)) {
    throw new ApiError(400, "INVALID_NOTIFICATION", "Invalid notification id");
  }
  const doc = await NotificationModel.findOne({ _id: notificationId, recipient: userId });
  if (!doc) throw new ApiError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
  if (!doc.readAt) {
    doc.readAt = new Date();
    await doc.save();
  }
  return toDto(doc);
}

export async function markAllRead(userId) {
  await NotificationModel.updateMany(
    { recipient: userId, readAt: null },
    { $set: { readAt: new Date() } }
  );
}

export async function clearAll(userId) {
  await NotificationModel.deleteMany({ recipient: userId });
}

export async function createAssignmentNotifications({ recipientIds, taskId, message }) {
  const uniqueIds = [...new Set((recipientIds || []).filter(Boolean).map((id) => String(id)))];
  if (!uniqueIds.length) return [];
  const docs = await NotificationModel.insertMany(
    uniqueIds.map((recipientId) => ({
      recipient: recipientId,
      task: taskId,
      type: "assignment",
      message
    }))
  );
  const unreadStats = await NotificationModel.aggregate([
    {
      $match: {
        recipient: { $in: uniqueIds.map((id) => new mongoose.Types.ObjectId(id)) },
        readAt: null
      }
    },
    { $group: { _id: "$recipient", unreadCount: { $sum: 1 } } }
  ]);
  const unreadByRecipient = new Map(unreadStats.map((item) => [String(item._id), Number(item.unreadCount || 0)]));
  for (const doc of docs) {
    const recipientId = String(doc.recipient);
    emitToUser(recipientId, "notification:new", {
      notification: toDto(doc),
      unreadCount: unreadByRecipient.get(recipientId) || 0
    });
  }
  return docs.map(toDto);
}

export async function emitUnreadCount(userId) {
  const count = await unreadCount(userId);
  emitToUser(userId, "notification:unread-count", { unreadCount: count });
  return count;
}
