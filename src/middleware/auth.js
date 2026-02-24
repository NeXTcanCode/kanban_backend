import { ApiError } from "../utils/apiError.js";
import { verifyToken } from "../modules/auth/auth.service.js";
import { UserModel } from "../modules/auth/user.model.js";

export function requireAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) throw new ApiError(401, "AUTH_REQUIRED", "Authorization token is required");

    const payload = verifyToken(token);
    UserModel.findById(payload.sub)
      .then((user) => {
        if (!user) throw new ApiError(401, "AUTH_REQUIRED", "User not found for this token");
        req.auth = {
          userId: String(user._id),
          user
        };
        next();
      })
      .catch(next);
  } catch (err) {
    next(err);
  }
}
