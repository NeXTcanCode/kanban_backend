import express from "express";
import * as c from "./auth.controller.js";
import { requireAuth } from "../../middleware/auth.js";

export const authRoutes = express.Router();
const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

authRoutes.post("/signup", safe(c.signup));
authRoutes.post("/login", safe(c.login));
authRoutes.get("/me", requireAuth, safe(c.me));
authRoutes.patch("/me", requireAuth, safe(c.patchMe));
authRoutes.post("/users", requireAuth, safe(c.createUser));
authRoutes.get("/companies", requireAuth, safe(c.companies));
authRoutes.get("/departments", requireAuth, safe(c.departments));
authRoutes.get("/assignees/search", requireAuth, safe(c.assigneeSearch));
authRoutes.patch("/users/:id/role", requireAuth, safe(c.updateUserRole));
