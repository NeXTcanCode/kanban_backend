export class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function toApiError(err) {
  if (err instanceof ApiError) return err;
  if (err?.name === "ValidationError") {
    const message = Object.values(err.errors || {})
      .map((item) => item?.message)
      .filter(Boolean)
      .join("; ");
    return new ApiError(400, "VALIDATION_ERROR", message || "Validation failed");
  }
  if (err?.name === "CastError") {
    return new ApiError(400, "INVALID_REFERENCE", `Invalid ${err.path || "id"} value`);
  }
  if (err?.code === 11000) {
    return new ApiError(409, "DUPLICATE_KEY", "Duplicate value violates uniqueness");
  }
  return new ApiError(500, "INTERNAL_ERROR", "Unexpected server error");
}
