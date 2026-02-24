import { toApiError } from "../utils/apiError.js";

export function errorHandler(err, req, res, _next) {
  const apiErr = toApiError(err);
  res.status(apiErr.statusCode).json({
    statusCode: apiErr.statusCode,
    code: apiErr.code,
    message: apiErr.message,
    requestId: req.requestId
  });
}

