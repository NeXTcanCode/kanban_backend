import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number.parseInt(process.env.PORT || "3000", 10),
  mongodbUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/kanban",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  jwtExpiryHours: Number.parseInt(process.env.JWT_EXPIRY_HOURS || "24", 10)
};
