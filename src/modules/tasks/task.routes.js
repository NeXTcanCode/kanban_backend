import express from "express";
import * as c from "./task.controller.js";

export const taskRoutes = express.Router();
const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

taskRoutes.get("/", safe(c.listTasks));
taskRoutes.post("/", safe(c.createTask));
taskRoutes.get("/:id", safe(c.getTask));
taskRoutes.patch("/:id", safe(c.patchTask));
taskRoutes.delete("/:id", safe(c.deleteTask));

taskRoutes.patch("/:id/reorder", safe(c.reorderTask));
taskRoutes.patch("/:id/move", safe(c.moveTask));
taskRoutes.patch("/:id/percentage", safe(c.setPercentage));
taskRoutes.patch("/:id/bucket", safe(c.setBucket));
