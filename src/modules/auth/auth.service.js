import crypto from "crypto";
import bcrypt from "bcryptjs";
import { ApiError } from "../../utils/apiError.js";
import { env } from "../../config/env.js";
import { UserModel } from "./user.model.js";

const BCRYPT_ROUNDS = 12;

function hashPasswordLegacy(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

async function hashPassword(password) {
  return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

async function verifyPassword(password, passwordHash) {
  const hash = String(passwordHash || "");
  if (hash.startsWith("$2")) {
    return bcrypt.compare(String(password), hash);
  }
  return hashPasswordLegacy(password) === hash;
}

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", env.jwtSecret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token) {
  const [header, body, signature] = String(token || "").split(".");
  if (!header || !body || !signature) throw new ApiError(401, "INVALID_TOKEN", "Invalid token");

  const expectedSig = crypto.createHmac("sha256", env.jwtSecret).update(`${header}.${body}`).digest("base64url");
  if (expectedSig !== signature) throw new ApiError(401, "INVALID_TOKEN", "Invalid token");

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid token");
  }

  if (!payload.exp || Date.now() / 1000 > payload.exp) throw new ApiError(401, "TOKEN_EXPIRED", "Session expired");
  return payload;
}

function normalizeUser(userDoc) {
  return {
    id: String(userDoc._id),
    name: userDoc.name,
    company: userDoc.company || "",
    department: userDoc.department || "",
    designation: userDoc.designation || "",
    userName: userDoc.userName,
    employeeId: userDoc.employeeId || "",
    userRole: userDoc.userRole,
    createdAt: userDoc.createdAt,
    updatedAt: userDoc.updatedAt
  };
}

function issueAuthResponse(userDoc) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = nowSeconds + env.jwtExpiryHours * 60 * 60;
  const token = signToken({ sub: String(userDoc._id), role: userDoc.userRole, exp });
  return {
    token,
    user: normalizeUser(userDoc)
  };
}

export async function signup(input) {
  const name = String(input.name || "").trim();
  const userName = String(input.userName || "").trim();
  const password = String(input.password || "");
  const userRole = String(input.userRole || "member").trim();

  if (!name) throw new ApiError(400, "INVALID_NAME", "Name is required");
  if (!userName) throw new ApiError(400, "INVALID_USERNAME", "userName is required");
  if (!password || password.length < 6) {
    throw new ApiError(400, "INVALID_PASSWORD", "Password must be at least 6 characters");
  }

  const existing = await UserModel.findOne({ userName });
  if (existing) throw new ApiError(409, "USERNAME_EXISTS", "userName already exists");

  const normalizedRole = ["god", "leader", "coleader", "elder", "member"].includes(userRole)
    ? userRole
    : null;
  if (!normalizedRole) {
    throw new ApiError(400, "INVALID_ROLE", "userRole must be one of god, leader, coleader, elder, member");
  }
  if (normalizedRole === "god") {
    const godCount = await UserModel.countDocuments({ userRole: "god" });
    if (godCount > 0) {
      throw new ApiError(403, "FORBIDDEN_ROLE", "Only one god user is allowed");
    }
  }

  const user = await UserModel.create({
    name,
    company: String(input.company || "").trim(),
    department: String(input.department || "").trim(),
    designation: String(input.designation || "").trim(),
    userName,
    employeeId: String(input.employeeId || "").trim(),
    passwordHash: await hashPassword(password),
    userRole: normalizedRole
  });

  return issueAuthResponse(user);
}

export async function login(input) {
  const userId = String(input.userId || "").trim();
  const password = String(input.password || "");

  if (!userId || !password) throw new ApiError(400, "INVALID_CREDENTIALS", "userId and password are required");

  const user = await UserModel.findOne({ userName: userId });
  if (!user) throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid userId or password");

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid userId or password");
  }
  if (!String(user.passwordHash || "").startsWith("$2")) {
    user.passwordHash = await hashPassword(password);
    await user.save();
  }

  return issueAuthResponse(user);
}

export async function getMe(userId) {
  const user = await UserModel.findById(userId);
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
  return normalizeUser(user);
}

export async function patchMe(userId, input) {
  const user = await UserModel.findById(userId);
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");

  if (input.name !== undefined && String(input.name).trim() !== user.name) {
    throw new ApiError(400, "IMMUTABLE_FIELD", "name cannot be changed");
  }
  if (input.userRole !== undefined && String(input.userRole) !== user.userRole) {
    throw new ApiError(400, "IMMUTABLE_FIELD", "userRole cannot be changed");
  }

  const incomingEmployeeId = input.employeeId !== undefined ? String(input.employeeId || "").trim() : undefined;
  if (incomingEmployeeId !== undefined && user.employeeId && incomingEmployeeId !== user.employeeId) {
    throw new ApiError(400, "IMMUTABLE_FIELD", "employeeId cannot be changed once set");
  }

  const incomingDesignation = input.designation !== undefined ? String(input.designation || "").trim() : undefined;
  if (incomingDesignation !== undefined && user.designation && incomingDesignation !== user.designation) {
    throw new ApiError(400, "IMMUTABLE_FIELD", "designation cannot be changed once set");
  }

  if (input.company !== undefined) user.company = String(input.company || "").trim();
  if (input.department !== undefined) user.department = String(input.department || "").trim();
  if (incomingDesignation !== undefined && !user.designation) user.designation = incomingDesignation;
  if (incomingEmployeeId !== undefined && !user.employeeId) user.employeeId = incomingEmployeeId;
  if (input.password !== undefined) {
    const password = String(input.password || "");
    if (!password || password.length < 6) {
      throw new ApiError(400, "INVALID_PASSWORD", "Password must be at least 6 characters");
    }
    user.passwordHash = await hashPassword(password);
  }

  await user.save();
  return normalizeUser(user);
}

export async function createUserByRole(actorUser, input) {
  const actorRole = actorUser?.userRole;
  const allowedMap = {
    god: ["leader", "coleader", "elder", "member"],
    leader: ["coleader", "elder", "member"],
    coleader: ["elder", "member"],
    elder: ["member"]
  };
  const allowedRoles = allowedMap[actorRole] || [];
  if (!allowedRoles.length) {
    throw new ApiError(403, "FORBIDDEN", "You are not allowed to add users");
  }
  const userRole = String(input.userRole || "").trim();
  if (!allowedRoles.includes(userRole)) {
    throw new ApiError(400, "INVALID_ROLE", "This role cannot be created from your account role");
  }

  const actorCompany = String(actorUser?.company || "").trim();
  const payload = {
    ...input,
    userRole
  };
  if (actorRole !== "god") {
    payload.company = actorCompany;
  }
  const result = await signup(payload);
  return result.user;
}

export async function listCompanies(actorUser, query = "") {
  const actorRole = String(actorUser?.userRole || "");
  const actorCompany = String(actorUser?.company || "").trim();
  const q = String(query || "").trim();
  if (actorRole !== "god") {
    if (!actorCompany) return [];
    if (q && !actorCompany.toLowerCase().includes(q.toLowerCase())) return [];
    return [actorCompany];
  }
  const regex = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  const docs = await UserModel.find(
    {
      company: { $ne: "", ...(regex ? { $regex: regex } : {}) }
    },
    { company: 1 }
  ).limit(500);
  return [...new Set(docs.map((doc) => String(doc.company || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

export async function listDepartments(actorUser, companyName, query = "") {
  const actorRole = String(actorUser?.userRole || "");
  const actorCompany = String(actorUser?.company || "").trim();
  const company = String(companyName || "").trim();
  if (!company) return [];
  if (actorRole !== "god" && company !== actorCompany) return [];
  const q = String(query || "").trim();
  const regex = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  const docs = await UserModel.find(
    {
      company,
      ...(regex ? { department: { $regex: regex } } : {})
    },
    { department: 1 }
  ).limit(200);
  const unique = [...new Set(docs.map((doc) => String(doc.department || "").trim()).filter(Boolean))];
  return unique.sort((a, b) => a.localeCompare(b));
}

export async function searchAssignableUsers(actorUser, filters = {}) {
  const actorRole = String(actorUser?.userRole || "");
  const actorCompany = String(actorUser?.company || "").trim();
  const roleMap = {
    god: ["leader", "coleader", "elder", "member"],
    leader: ["coleader", "elder", "member"],
    coleader: ["elder", "member"],
    elder: ["member"]
  };
  const allowedRoles = roleMap[actorRole] || [];
  if (!allowedRoles.length) return [];

  const company = String(filters.company || "").trim();
  const department = String(filters.department || "").trim();
  const q = String(filters.query || "").trim();
  if (!company || !department || q.length < 1) return [];
  if (actorRole !== "god" && company !== actorCompany) return [];

  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const users = await UserModel.find(
    {
      company,
      department,
      userRole: { $in: allowedRoles },
      $or: [{ name: { $regex: regex } }, { userName: { $regex: regex } }, { employeeId: { $regex: regex } }]
    },
    {
      name: 1,
      userName: 1,
      employeeId: 1,
      userRole: 1,
      department: 1,
      company: 1
    }
  )
    .sort({ name: 1 })
    .limit(20);

  return users.map((u) => ({
    id: String(u._id),
    name: u.name,
    userName: u.userName,
    employeeId: u.employeeId || "",
    userRole: u.userRole,
    company: u.company || "",
    department: u.department || "",
    label: `${u.name} (${u.employeeId || "-"} | ${u.userName})`
  }));
}

export async function updateUserRole(actorUser, targetUserId, nextRole) {
  const actorRole = String(actorUser?.userRole || "");
  if (!["god", "leader"].includes(actorRole)) {
    throw new ApiError(403, "FORBIDDEN", "Only god or leader can update user role");
  }
  const actorCompany = String(actorUser?.company || "").trim();
  const user = await UserModel.findById(targetUserId);
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
  if (actorRole === "leader" && String(user.company || "").trim() !== actorCompany) {
    throw new ApiError(403, "FORBIDDEN", "Role updates are limited to your company");
  }
  const role = String(nextRole || "").trim();
  if (actorRole === "leader" && !["coleader", "elder", "member"].includes(role)) {
    throw new ApiError(400, "INVALID_ROLE", "leader can assign only coleader, elder, or member roles");
  }
  if (actorRole === "god" && !["leader", "coleader", "elder", "member", "god"].includes(role)) {
    throw new ApiError(400, "INVALID_ROLE", "god can assign only valid role values");
  }
  if (actorRole === "leader" && String(actorUser?._id || "") === String(targetUserId || "")) {
    throw new ApiError(400, "INVALID_ROLE_CHANGE", "Leader cannot change own role");
  }
  if (actorRole === "god" && String(actorUser?._id || "") === String(targetUserId || "") && role !== "god") {
    throw new ApiError(400, "INVALID_ROLE_CHANGE", "God cannot remove own god role");
  }
  user.userRole = role;
  await user.save();
  return normalizeUser(user);
}
