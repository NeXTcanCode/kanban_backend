import { randomUUID } from "node:crypto";

export function requestId(req, res, next) {
  const id = randomUUID();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}

