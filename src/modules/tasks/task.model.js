import mongoose from "mongoose";
import { bucketForPercentage } from "../../utils/percentage.js";

const { Schema, Types } = mongoose;

const CommentSchema = new Schema(
  {
    type: { type: String, enum: ["auto", "manual"], required: true },
    message: { type: String, required: true, trim: true },
    name: { type: String, default: "", trim: true },
    employeeId: { type: String, default: "", trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const TaskSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, default: "", trim: true },
    department: { type: String, default: "", trim: true },
    assignedTo: { type: [String], default: [] },
    assignedToUsers: { type: [Types.ObjectId], ref: "User", default: [] },
    assignedBy: { type: [String], default: [] },
    assignedByUser: { type: Types.ObjectId, ref: "User", default: null, index: true },
    assignedByRole: {
      type: String,
      enum: ["god", "leader", "coleader", "elder", "member", ""],
      default: "",
      trim: true
    },
    assignedDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    initialPercentage: { type: Number, default: 0, min: 0, max: 100 },
    percentage: { type: Number, default: 0, min: 0, max: 100 },
    finalPercentage: { type: Number, default: 100, min: 0, max: 100 },
    ticketStatus: { type: String, default: "Open", trim: true },
    parent: { type: Types.ObjectId, ref: "Task", default: null, index: true },
    children: { type: [Types.ObjectId], ref: "Task", default: [] },
    statusBucket: {
      type: String,
      enum: ["Not Started", "On Hold", "In Progress", "Completed"],
      default: "Not Started",
      index: true,
    },
    comments: { type: [CommentSchema], default: [] },
  },
  { timestamps: true }
);

TaskSchema.pre("validate", function taskPreValidate(next) {
  // Keep statusBucket aligned for direct percentage changes.
  this.statusBucket = bucketForPercentage(this.percentage);
  this.ticketStatus = Number(this.percentage) >= 100 ? "Closed" : "Open";
  next();
});

export const TaskModel = mongoose.model("Task", TaskSchema);
