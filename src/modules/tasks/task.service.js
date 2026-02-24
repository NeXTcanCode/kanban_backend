import mongoose from "mongoose";
import { ApiError } from "../../utils/apiError.js";
import { bucketForPercentage, clampPercentage, defaultPercentageForBucket } from "../../utils/percentage.js";
import { TaskModel } from "./task.model.js";
import { uniqStrings } from "../../utils/hierarchy.js";
import { UserModel } from "../auth/user.model.js";
import { createAssignmentNotifications } from "../notifications/notification.service.js";

function pushAutoLog(task, message) {
  task.comments = task.comments || [];
  task.comments.push({
    type: "auto",
    message,
    name: "System",
    employeeId: "AUTO",
    createdAt: new Date()
  });
}

function syncTicketStatusFromCompletion(task) {
  const pct = Number(task?.percentage ?? 0);
  task.ticketStatus = pct >= 100 ? "Closed" : "Open";
}

async function loadTaskOr404(id, session = null) {
  const query = TaskModel.findById(id);
  if (session) query.session(session);
  const task = await query;
  if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
  return task;
}

function actorRole(actorUser) {
  return String(actorUser?.userRole || "").trim();
}

const ROLE_RANK = {
  god: 5,
  leader: 4,
  coleader: 3,
  elder: 2,
  member: 1
};

function roleRank(role) {
  return ROLE_RANK[String(role || "").trim()] || 0;
}

function actorId(actorUser) {
  return String(actorUser?.id || actorUser?._id || "").trim();
}

function assertCanCreateTask(actorUser) {
  const role = actorRole(actorUser);
  if (!["god", "leader", "coleader", "elder"].includes(role)) {
    throw new ApiError(403, "FORBIDDEN_CREATE_TASK", "You are not allowed to create tasks");
  }
}

function assertAllowedPatchByRole(actorUser, input) {
  const role = actorRole(actorUser);
  if (["god", "leader"].includes(role)) return;

  const keys = Object.keys(input || {});
  const allowedForColeaderOrElder = new Set(["percentage", "addComment", "assignedTo", "assignedToUserIds"]);
  const allowedForMember = new Set(["percentage", "addComment"]);
  const allowed = role === "member" ? allowedForMember : allowedForColeaderOrElder;
  for (const key of keys) {
    if (!allowed.has(key)) {
      throw new ApiError(403, "FORBIDDEN_PATCH_FIELD", `You are not allowed to update '${key}'`);
    }
  }
}

function assertTaskScope(actorUser, task) {
  const role = actorRole(actorUser);
  if (role === "god") return;
  if (!role) throw new ApiError(403, "FORBIDDEN", "Missing actor role");

  const actorCompany = String(actorUser?.company || "").trim();
  const taskCompany = String(task?.company || "").trim();
  if (actorCompany && taskCompany && actorCompany !== taskCompany) {
    throw new ApiError(403, "FORBIDDEN_SCOPE", "Task is outside your company scope");
  }

  if (role === "member") {
    const currentActorId = actorId(actorUser);
    const assigneeIds = (task?.assignedToUsers || []).map((id) => String(id));
    if (!currentActorId || !assigneeIds.includes(currentActorId)) {
      throw new ApiError(403, "FORBIDDEN_SCOPE", "Members can only mutate assigned tasks");
    }
  }
}

function assertAssignerAuthority(actorUser, task) {
  const currentActorId = actorId(actorUser);
  const assignerId = String(task?.assignedByUser || "").trim();
  const currentRoleRank = roleRank(actorRole(actorUser));
  const assignerRank = roleRank(task?.assignedByRole);
  if (!currentActorId || !assignerId || !currentRoleRank || !assignerRank) {
    throw new ApiError(403, "FORBIDDEN_ASSIGNMENT_CHAIN", "Task assignment chain is invalid");
  }
  const isAssigner = currentActorId === assignerId;
  const outranksAssigner = currentRoleRank > assignerRank;
  if (!isAssigner && !outranksAssigner) {
    throw new ApiError(403, "FORBIDDEN_ASSIGNMENT_CHAIN", "You cannot modify tasks assigned by a senior");
  }
}

function assertNoSelfRemoval(actorUser, task, nextAssigneeUserIds) {
  const currentActorId = actorId(actorUser);
  if (!currentActorId) return;
  const prevAssignees = new Set((task?.assignedToUsers || []).map((id) => String(id)));
  if (!prevAssignees.has(currentActorId)) return;
  const nextAssignees = new Set((nextAssigneeUserIds || []).map((id) => String(id)));
  if (!nextAssignees.has(currentActorId)) {
    throw new ApiError(403, "SELF_REMOVAL_FORBIDDEN", "You cannot remove yourself from assignees");
  }
}

function requiresAssignerAuthorityForPatch(input = {}) {
  return [
    "name",
    "company",
    "department",
    "ticketStatus",
    "assignedBy",
    "assignedDate",
    "dueDate",
    "targetPercentage",
    "finalPercentage"
  ].some((field) => input[field] !== undefined);
}

function assertCanMutateStructure(actorUser) {
  const role = actorRole(actorUser);
  if (["god", "leader", "coleader", "elder"].includes(role)) return;
  throw new ApiError(403, "FORBIDDEN_MUTATION", "You are not allowed to mutate task hierarchy");
}

function parseAssigneeUserIds(input) {
  const ids = Array.isArray(input?.assignedToUserIds) ? input.assignedToUserIds : [];
  return uniqStrings(ids.filter(Boolean).map((id) => String(id)));
}

async function validateAndResolveAssignees(actorUser, { assigneeUserIds, company, department }, session = null) {
  if (!assigneeUserIds.length) return [];
  const actorRole = String(actorUser?.userRole || "");
  const currentActorId = actorId(actorUser);
  const actorCompany = String(actorUser?.company || "").trim();
  const roleMap = {
    god: ["leader", "coleader", "elder", "member"],
    leader: ["coleader", "elder", "member"],
    coleader: ["elder", "member"],
    elder: ["member"]
  };
  const allowedRoles = roleMap[actorRole] || [];
  if (!allowedRoles.length) {
    throw new ApiError(403, "FORBIDDEN_ASSIGNMENT", "You are not allowed to assign tasks");
  }
  const query = UserModel.find({ _id: { $in: assigneeUserIds } });
  if (session) query.session(session);
  const users = await query;
  if (users.length !== assigneeUserIds.length) {
    throw new ApiError(400, "INVALID_ASSIGNEE", "One or more assignee users were not found");
  }
  for (const user of users) {
    const isSelf = String(user._id) === String(currentActorId);
    if (isSelf) {
      continue;
    }
    if (!allowedRoles.includes(String(user.userRole))) {
      throw new ApiError(403, "FORBIDDEN_ASSIGNMENT", "Hierarchy rule prevents this assignment");
    }
    if (actorRole !== "god" && String(user.company || "").trim() !== actorCompany) {
      throw new ApiError(403, "CROSS_COMPANY_ASSIGNMENT", "Assignee must belong to your company");
    }
    if (company && String(user.company || "").trim() !== company) {
      throw new ApiError(400, "COMPANY_MISMATCH", "Assignee does not belong to selected company");
    }
    if (department && String(user.department || "").trim() !== department) {
      throw new ApiError(400, "DEPARTMENT_MISMATCH", "Assignee does not belong to selected department");
    }
  }
  return users;
}

async function computeParentPercentage(parentDoc, session = null) {
  if (!parentDoc.children?.length) return parentDoc.percentage;
  const query = TaskModel.find({ _id: { $in: parentDoc.children } }, { percentage: 1 });
  if (session) query.session(session);
  const children = await query;
  if (!children.length) return parentDoc.percentage;
  const avg = children.reduce((acc, c) => acc + (c.percentage || 0), 0) / children.length;
  return Math.round(avg);
}

async function hasIncompleteDescendant(rootId, session = null) {
  // BFS to detect any descendant < 100.
  const queue = [rootId];
  const seen = new Set([String(rootId)]);
  while (queue.length) {
    const id = queue.shift();
    const query = TaskModel.findById(id, { children: 1, percentage: 1 });
    if (session) query.session(session);
    const node = await query;
    if (!node) continue;
    if (String(node._id) !== String(rootId) && node.percentage !== 100) return true;
    for (const childId of node.children) {
      const s = String(childId);
      if (seen.has(s)) continue;
      seen.add(s);
      queue.push(childId);
    }
  }
  return false;
}

async function recomputeUpwards(startParentId, session) {
  // Recompute percentages up the ancestor chain.
  let currentId = startParentId;
  while (currentId) {
    const parent = await TaskModel.findById(currentId).session(session);
    if (!parent) break;

    const prevPercentage = parent.percentage;
    const prevBucket = parent.statusBucket;
    const pct = await computeParentPercentage(parent, session);
    parent.percentage = pct;
    syncTicketStatusFromCompletion(parent);

    let bucket = bucketForPercentage(pct);
    if (bucket === "Completed") {
      const incomplete = await hasIncompleteDescendant(parent._id, session);
      if (incomplete) bucket = "In Progress";
    }
    parent.statusBucket = bucket;
    if (prevPercentage !== pct) {
      pushAutoLog(parent, `Derived completion changed ${prevPercentage}% -> ${pct}%`);
    }
    if (prevBucket !== bucket) {
      pushAutoLog(parent, `Status bucket moved ${prevBucket} -> ${bucket}`);
    }
    await parent.save({ session });

    currentId = parent.parent;
  }
}

async function assertNoCycle(taskId, newParentId, session = null) {
  if (!newParentId) return;
  if (String(taskId) === String(newParentId)) {
    throw new ApiError(400, "CYCLE_DETECTED", "Task cannot be parented to itself");
  }

  // Walk upward from newParentId; if we ever see taskId, it would create a cycle.
  let currentId = newParentId;
  const guard = new Set();
  while (currentId) {
    const s = String(currentId);
    if (guard.has(s)) break;
    guard.add(s);
    if (s === String(taskId)) throw new ApiError(400, "CYCLE_DETECTED", "Move would create a cycle");
    const query = TaskModel.findById(currentId, { parent: 1 });
    if (session) query.session(session);
    const node = await query;
    currentId = node?.parent ?? null;
  }
}

export async function listTasks() {
  const tasks = await TaskModel.find().sort({ updatedAt: -1 });
  return tasks;
}

export async function createTask(input, actorUser = null) {
  assertCanCreateTask(actorUser);
  const session = await mongoose.startSession();
  try {
    let created;
    let assigneeUsers = [];
    const assigneeUserIds = parseAssigneeUserIds(input);
    const incomingAssignedTo = Array.isArray(input.assignedTo) ? input.assignedTo.filter(Boolean) : [];
    const company = String(input.company ?? "").trim();
    const department = String(input.department ?? "").trim();
    if (incomingAssignedTo.length && !assigneeUserIds.length) {
      throw new ApiError(400, "ASSIGNEE_USER_REQUIRED", "assignedToUserIds is required for assignment");
    }
    const assignerName = String(actorUser?.name || "System").trim() || "System";
    const assignerId = actorId(actorUser) || null;
    const assignerRole = actorRole(actorUser);
    if (assigneeUserIds.length) {
      assigneeUsers = await validateAndResolveAssignees(actorUser, {
        assigneeUserIds,
        company,
        department
      }, session);
    }
    await session.withTransaction(async () => {
      const incomingTargetPercentage =
        input?.targetPercentage !== undefined ? input.targetPercentage : input?.finalPercentage;

      if (!input?.dueDate) {
        throw new ApiError(400, "MISSING_DUE_DATE", "Final date (dueDate) is required");
      }
      if (incomingTargetPercentage === undefined || incomingTargetPercentage === null || String(incomingTargetPercentage).trim() === "") {
        throw new ApiError(400, "MISSING_FINAL_PERCENTAGE", "Final percentage is required");
      }
      const parsedDueDate = new Date(input.dueDate);
      if (Number.isNaN(parsedDueDate.getTime())) {
        throw new ApiError(400, "INVALID_DUE_DATE", "Final date (dueDate) is invalid");
      }
      const parsedFinalPercentage = clampPercentage(Number(incomingTargetPercentage));
      if (parsedFinalPercentage === null) {
        throw new ApiError(400, "INVALID_FINAL_PERCENTAGE", "Final percentage must be between 0 and 100");
      }

      const parentId = input.parentId ?? null;
      if (parentId) await assertNoCycle("new", parentId, session);
      const parentTask = parentId ? await loadTaskOr404(parentId, session) : null;
      const effectiveAssignerName =
        parentTask && Array.isArray(parentTask.assignedBy) && parentTask.assignedBy.length
          ? String(parentTask.assignedBy[0] || "").trim() || assignerName
          : assignerName;
      const effectiveAssignerId = parentTask?.assignedByUser || assignerId;
      const effectiveAssignerRole = String(parentTask?.assignedByRole || "").trim() || assignerRole;

      created = await TaskModel.create(
        [
          {
            // initialPercentage is a snapshot captured at task creation.
            initialPercentage:
              clampPercentage(
                Number(
                  input.initialPercentage !== undefined
                    ? input.initialPercentage
                    : input.percentage ?? 0
                )
              ) ?? 0,
            name: input.name,
            company,
            department,
            assignedTo:
              assigneeUsers.length > 0
                ? assigneeUsers.map((user) => `${user.name} (${user.employeeId || "-"} | ${user.userName})`)
                : Array.isArray(input.assignedTo)
                  ? input.assignedTo
                  : [],
            assignedToUsers: assigneeUsers.map((u) => u._id),
            assignedBy: [effectiveAssignerName],
            assignedByUser: effectiveAssignerId,
            assignedByRole: effectiveAssignerRole,
            assignedDate: input.assignedDate ? new Date(input.assignedDate) : null,
            dueDate: parsedDueDate,
            percentage: clampPercentage(Number(input.percentage ?? 0)) ?? 0,
            finalPercentage: parsedFinalPercentage,
            ticketStatus: input.ticketStatus ?? "Open",
            parent: parentId,
            children: [],
            comments: [
              {
                type: "auto",
                message: `Ticket created by ${effectiveAssignerName} (${parentId ? "child task" : "root task"})`,
                name: effectiveAssignerName,
                employeeId: "AUTO"
              }
            ]
          }
        ],
        { session }
      );
      created = created[0];
      syncTicketStatusFromCompletion(created);
      await created.save({ session });

      if (parentId) {
        const parent = parentTask;
        parent.children = uniqStrings([...parent.children.map(String), String(created._id)]).map(
          (s) => new mongoose.Types.ObjectId(s)
        );
        await parent.save({ session });
        await recomputeUpwards(parent._id, session);
      }
    });
    if (assigneeUsers.length && actorUser) {
      const actorName = String(actorUser?.name || "System").trim() || "System";
      const context = [created.company, created.department].filter(Boolean).join(" / ");
      await createAssignmentNotifications({
        recipientIds: assigneeUsers.map((u) => String(u._id)),
        taskId: String(created._id),
        message: `${actorName} assigned "${created.name}"${context ? ` (${context})` : ""}`
      });
    }
    return created;
  } finally {
    session.endSession();
  }
}

export async function updateTask(id, input, actorUser = null) {
  assertAllowedPatchByRole(actorUser, input);
  const session = await mongoose.startSession();
  try {
    let updated;
    let notifyRecipientIds = [];
    await session.withTransaction(async () => {
      const task = await loadTaskOr404(id, session);
      assertTaskScope(actorUser, task);
      if (requiresAssignerAuthorityForPatch(input)) {
        assertAssignerAuthority(actorUser, task);
      }

      if (input.name !== undefined) task.name = String(input.name);
      if (input.company !== undefined) task.company = String(input.company ?? "");
      if (input.department !== undefined) task.department = String(input.department ?? "");
      if (input.ticketStatus !== undefined) task.ticketStatus = String(input.ticketStatus ?? "");
      let changedAssignment = false;
      let changedTimeline = false;
      let changedTicketMeta = false;
      if (input.name !== undefined || input.company !== undefined || input.department !== undefined || input.ticketStatus !== undefined) {
        changedTicketMeta = true;
      }
      if (input.assignedTo !== undefined) {
        const nextAssigneeUserIds = parseAssigneeUserIds(input);
        const incomingAssignedTo = Array.isArray(input.assignedTo) ? input.assignedTo.filter(Boolean) : [];
        if (incomingAssignedTo.length && !nextAssigneeUserIds.length) {
          throw new ApiError(400, "ASSIGNEE_USER_REQUIRED", "assignedToUserIds is required for assignment");
        }
        assertNoSelfRemoval(actorUser, task, nextAssigneeUserIds);
        const prevAssigneeIds = new Set((task.assignedToUsers || []).map((id) => String(id)));
        const nextAssigneeIds = new Set(nextAssigneeUserIds.map((id) => String(id)));
        const removedAssignees = [...prevAssigneeIds].filter((id) => !nextAssigneeIds.has(id));
        if (removedAssignees.length) {
          assertAssignerAuthority(actorUser, task);
        }
        const company = input.company !== undefined ? String(input.company || "").trim() : String(task.company || "").trim();
        const department =
          input.department !== undefined ? String(input.department || "").trim() : String(task.department || "").trim();
        let assigneeUsers = [];
        if (nextAssigneeUserIds.length) {
          assigneeUsers = await validateAndResolveAssignees(actorUser, {
            assigneeUserIds: nextAssigneeUserIds,
            company,
            department
          }, session);
        }
        const prevIds = new Set((task.assignedToUsers || []).map((u) => String(u)));
        notifyRecipientIds = assigneeUsers.map((u) => String(u._id)).filter((uid) => !prevIds.has(uid));
        task.assignedToUsers = assigneeUsers.map((u) => u._id);
        task.assignedTo =
          assigneeUsers.length > 0
            ? assigneeUsers.map((user) => `${user.name} (${user.employeeId || "-"} | ${user.userName})`)
            : Array.isArray(input.assignedTo)
              ? input.assignedTo
              : [];
        changedAssignment = true;
      }
      if (input.assignedDate !== undefined) {
        task.assignedDate = input.assignedDate ? new Date(input.assignedDate) : null;
        changedTimeline = true;
      }
      if (input.dueDate !== undefined) {
        task.dueDate = input.dueDate ? new Date(input.dueDate) : null;
        changedTimeline = true;
      }
      const incomingPatchTarget =
        input.targetPercentage !== undefined ? input.targetPercentage : input.finalPercentage;
      if (incomingPatchTarget !== undefined) {
        const pct = clampPercentage(Number(incomingPatchTarget));
        if (pct === null) throw new ApiError(400, "INVALID_PERCENTAGE", "Final percentage must be between 0 and 100");
        task.finalPercentage = pct;
      }

      if (input.percentage !== undefined) {
        if (task.children?.length) throw new ApiError(400, "PARENT_PERCENTAGE_READ_ONLY", "Parent percentage is derived");
        if (task.initialPercentage === undefined || task.initialPercentage === null) {
          task.initialPercentage = clampPercentage(Number(task.percentage ?? 0)) ?? 0;
        }
        const prevPercentage = task.percentage;
        const prevBucket = task.statusBucket;
        const pct = clampPercentage(Number(input.percentage));
        if (pct === null) throw new ApiError(400, "INVALID_PERCENTAGE", "Percentage must be between 0 and 100");
        task.percentage = pct;
        task.statusBucket = bucketForPercentage(pct);
        syncTicketStatusFromCompletion(task);
        if (prevPercentage !== pct) {
          pushAutoLog(task, `Completion updated ${prevPercentage}% -> ${pct}%`);
        }
        if (prevBucket !== task.statusBucket) {
          pushAutoLog(task, `Status bucket moved ${prevBucket} -> ${task.statusBucket}`);
        }
      }

      if (input.addComment && typeof input.addComment === "object") {
        const isManual = input.addComment.type === "manual";
        const message = String(input.addComment.message || "").trim();
        if (message) {
          task.comments = task.comments || [];
          task.comments.push({
            type: isManual ? "manual" : "auto",
            message,
            name: String(input.addComment.name || ""),
            employeeId: String(input.addComment.employeeId || ""),
            createdAt: new Date()
          });
        }
      }

      if (changedAssignment) {
        pushAutoLog(task, `Assignment updated (assignee: ${task.assignedTo.join(", ") || "-"}, assigned by: ${task.assignedBy.join(", ") || "-"})`);
      }
      if (changedTimeline) {
        pushAutoLog(
          task,
          `Timeline updated (assigned date: ${task.assignedDate ? new Date(task.assignedDate).toISOString().slice(0, 10) : "-"}, final date: ${
            task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : "-"
          })`
        );
      }
      if (changedTicketMeta) {
        pushAutoLog(task, "Ticket metadata updated (name/department/status)");
      }

      await task.save({ session });
      if (task.parent) await recomputeUpwards(task.parent, session);
      updated = task;
    });
    if (notifyRecipientIds.length && actorUser) {
      const actorName = String(actorUser?.name || "System").trim() || "System";
      const context = [updated.company, updated.department].filter(Boolean).join(" / ");
      await createAssignmentNotifications({
        recipientIds: notifyRecipientIds,
        taskId: String(updated._id),
        message: `${actorName} added you to "${updated.name}"${context ? ` (${context})` : ""}`
      });
    }
    return updated;
  } finally {
    session.endSession();
  }
}

export async function deleteTask(id, actorUser = null) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      assertCanMutateStructure(actorUser);
      const task = await loadTaskOr404(id, session);
      assertTaskScope(actorUser, task);
      assertAssignerAuthority(actorUser, task);
      const parentId = task.parent;

      // Cascade delete: remove task and all descendants.
      const toDelete = [];
      const queue = [task._id];
      const seen = new Set();
      while (queue.length) {
        const current = queue.shift();
        const key = String(current);
        if (seen.has(key)) continue;
        seen.add(key);
        const node = await TaskModel.findById(current, { children: 1 }).session(session);
        if (!node) continue;
        toDelete.push(node._id);
        for (const childId of node.children || []) queue.push(childId);
      }

      await TaskModel.deleteMany({ _id: { $in: toDelete } }).session(session);

      if (parentId) {
        const parent = await TaskModel.findById(parentId).session(session);
        if (parent) {
          parent.children = parent.children.filter((c) => String(c) !== String(task._id));
          await parent.save({ session });
          await recomputeUpwards(parent._id, session);
        }
      }
    });
  } finally {
    session.endSession();
  }
}

export async function reorderTask(id, input, actorUser = null) {
  const session = await mongoose.startSession();
  try {
    let parentIdForRecompute = null;
    await session.withTransaction(async () => {
      assertCanMutateStructure(actorUser);
      const task = await loadTaskOr404(id, session);
      assertTaskScope(actorUser, task);
      assertAssignerAuthority(actorUser, task);
      const parentId = task.parent;
      if (!parentId) throw new ApiError(400, "REORDER_REQUIRES_PARENT", "Root task reorder requires a parent context");

      const parent = await loadTaskOr404(parentId, session);
      const ids = parent.children.map(String);
      const fromIndex = ids.indexOf(String(task._id));
      if (fromIndex === -1) throw new ApiError(409, "PARENT_CHILD_MISMATCH", "Parent/child references are inconsistent");

      const toIndex = Number.parseInt(String(input.toIndex), 10);
      if (!Number.isFinite(toIndex) || toIndex < 0 || toIndex >= ids.length) {
        throw new ApiError(400, "INVALID_INDEX", "Target index is invalid");
      }

      ids.splice(fromIndex, 1);
      ids.splice(toIndex, 0, String(task._id));
      parent.children = ids.map((s) => new mongoose.Types.ObjectId(s));
      pushAutoLog(parent, `Child priority reordered for task ${String(task._id)}`);
      await parent.save({ session });
      parentIdForRecompute = parent._id;
      await recomputeUpwards(parent._id, session);
    });
    return parentIdForRecompute;
  } finally {
    session.endSession();
  }
}

export async function moveTask(id, input, actorUser = null) {
  const session = await mongoose.startSession();
  try {
    let moved;
    await session.withTransaction(async () => {
      assertCanMutateStructure(actorUser);
      const task = await loadTaskOr404(id, session);
      assertTaskScope(actorUser, task);
      assertAssignerAuthority(actorUser, task);
      const oldParentId = task.parent ? String(task.parent) : null;
      const newParentId = input.newParentId ?? null;

      await assertNoCycle(task._id, newParentId, session);

      // Remove from old parent children list.
      if (oldParentId) {
        const oldParent = await TaskModel.findById(oldParentId).session(session);
        if (oldParent) {
          oldParent.children = oldParent.children.filter((c) => String(c) !== String(task._id));
          pushAutoLog(oldParent, `Child task ${String(task._id)} moved out`);
          await oldParent.save({ session });
        }
      }

      // Add into new parent children list or keep as root.
      if (newParentId) {
        const newParent = await loadTaskOr404(newParentId, session);
        assertTaskScope(actorUser, newParent);
        const nextChildren = newParent.children.map(String);
        const insertAtRaw = input.insertAt;
        const insertAt = insertAtRaw === undefined || insertAtRaw === null ? nextChildren.length : Number(insertAtRaw);
        const safeIndex = Number.isFinite(insertAt) ? Math.max(0, Math.min(nextChildren.length, insertAt)) : nextChildren.length;
        nextChildren.splice(safeIndex, 0, String(task._id));
        newParent.children = uniqStrings(nextChildren).map((s) => new mongoose.Types.ObjectId(s));
        pushAutoLog(newParent, `Child task ${String(task._id)} moved in`);
        await newParent.save({ session });
        task.parent = newParent._id;
      } else {
        task.parent = null;
      }

      pushAutoLog(task, `Parent changed from ${oldParentId || "ROOT"} to ${newParentId || "ROOT"}`);

      await task.save({ session });

      if (oldParentId) await recomputeUpwards(oldParentId, session);
      if (newParentId) await recomputeUpwards(newParentId, session);
      moved = task;
    });
    return moved;
  } finally {
    session.endSession();
  }
}

export async function setLeafPercentage(id, input, actorUser = null) {
  assertAllowedPatchByRole(actorUser, { percentage: input?.percentage });
  const session = await mongoose.startSession();
  try {
    let updated;
    await session.withTransaction(async () => {
      const task = await loadTaskOr404(id, session);
      assertTaskScope(actorUser, task);
      if (task.children?.length) throw new ApiError(400, "PARENT_PERCENTAGE_READ_ONLY", "Parent percentage is derived");
      if (task.initialPercentage === undefined || task.initialPercentage === null) {
        task.initialPercentage = clampPercentage(Number(task.percentage ?? 0)) ?? 0;
      }
      const prevPercentage = task.percentage;
      const prevBucket = task.statusBucket;
      const pct = clampPercentage(Number(input.percentage));
      if (pct === null) throw new ApiError(400, "INVALID_PERCENTAGE", "Percentage must be between 0 and 100");
      task.percentage = pct;
      task.statusBucket = bucketForPercentage(pct);
      syncTicketStatusFromCompletion(task);
      if (prevPercentage !== pct) {
        pushAutoLog(task, `Completion updated ${prevPercentage}% -> ${pct}%`);
      }
      if (prevBucket !== task.statusBucket) {
        pushAutoLog(task, `Status bucket moved ${prevBucket} -> ${task.statusBucket}`);
      }
      await task.save({ session });
      if (task.parent) await recomputeUpwards(task.parent, session);
      updated = task;
    });
    return updated;
  } finally {
    session.endSession();
  }
}

export async function setLeafBucket(id, input, actorUser = null) {
  assertAllowedPatchByRole(actorUser, { percentage: defaultPercentageForBucket(String(input.statusBucket)) });
  // Convenience mutation: set a leaf into a bucket by applying default percentage.
  const pct = defaultPercentageForBucket(String(input.statusBucket));
  return setLeafPercentage(id, { percentage: pct }, actorUser);
}

export async function getTask(id) {
  return loadTaskOr404(id);
}
