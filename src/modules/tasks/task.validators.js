import { ApiError } from "../../utils/apiError.js";

export function assertObjectIdOrNull(maybeId, code, message) {
  if (maybeId === null || maybeId === undefined || maybeId === "") return;
  // Mongoose ObjectId strings are 24-hex, but we keep it simple here and
  // let Mongoose throw on invalid cast in queries.
  if (typeof maybeId !== "string") throw new ApiError(400, code, message);
}

export function assertNonEmptyString(value, code, message) {
  if (typeof value !== "string" || value.trim() === "") throw new ApiError(400, code, message);
}

