import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { requestId } from "./middleware/requestId.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireAuth } from "./middleware/auth.js";
import { taskRoutes } from "./modules/tasks/task.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { notificationRoutes } from "./modules/notifications/notification.routes.js";

export function createApp() {
  const app = express();
  const corsOptions = {
    origin: env.corsOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-request-id"]
  };

  app.use(requestId);
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", env.corsOrigin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-request-id");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRoutes);
  app.use("/api/tasks", requireAuth, taskRoutes);
  app.use("/api/notifications", requireAuth, notificationRoutes);

  app.use(errorHandler);
  return app;
}
