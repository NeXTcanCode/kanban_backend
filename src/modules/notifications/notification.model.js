import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const NotificationSchema = new Schema(
  {
    recipient: { type: Types.ObjectId, ref: "User", required: true, index: true },
    task: { type: Types.ObjectId, ref: "Task", required: true, index: true },
    type: { type: String, enum: ["assignment"], default: "assignment", required: true },
    message: { type: String, required: true, trim: true },
    readAt: { type: Date, default: null, index: true }
  },
  { timestamps: true }
);

NotificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });

export const NotificationModel = mongoose.model("Notification", NotificationSchema);
