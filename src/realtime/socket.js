import { Server } from "socket.io";
import { verifyToken } from "../modules/auth/auth.service.js";
import { UserModel } from "../modules/auth/user.model.js";

let ioInstance = null;

export function initSocket(httpServer, corsOrigin) {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true
    }
  });

  ioInstance.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || "";
      const payload = verifyToken(token);
      const user = await UserModel.findById(payload.sub, { _id: 1 });
      if (!user) return next(new Error("AUTH_REQUIRED"));
      socket.data.userId = String(user._id);
      return next();
    } catch {
      return next(new Error("AUTH_REQUIRED"));
    }
  });

  ioInstance.on("connection", (socket) => {
    const userId = socket.data.userId;
    if (userId) socket.join(`user:${userId}`);
  });

  return ioInstance;
}

export function emitToUser(userId, eventName, payload) {
  if (!ioInstance || !userId) return;
  ioInstance.to(`user:${String(userId)}`).emit(eventName, payload);
}

