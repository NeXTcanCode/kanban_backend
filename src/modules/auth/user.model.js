import mongoose from "mongoose";

const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, default: "", trim: true },
    department: { type: String, default: "", trim: true },
    designation: { type: String, default: "", trim: true },
    userName: { type: String, required: true, trim: true, unique: true, index: true },
    employeeId: { type: String, default: "", trim: true },
    passwordHash: { type: String, required: true },
    userRole: {
      type: String,
      enum: ["god", "leader", "coleader", "elder", "member"],
      default: "member",
      required: true
    }
  },
  { timestamps: true }
);

export const UserModel = mongoose.model("User", UserSchema);
