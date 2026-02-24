export function toIdString(v) {
  if (!v) return null;
  return String(v);
}

export function mapTaskToDto(doc) {
  const percentage = Number(doc.percentage ?? 0);
  const initialPercentage = Number(doc.initialPercentage ?? percentage);
  return {
    id: String(doc._id),
    name: doc.name,
    company: doc.company || "",
    department: doc.department,
    assignedTo: doc.assignedTo,
    assignedToUserIds: (doc.assignedToUsers || []).map((u) => String(u)),
    assignedBy: doc.assignedBy,
    assignedByUserId: doc.assignedByUser ? String(doc.assignedByUser) : null,
    assignedByRole: doc.assignedByRole || "",
    assignedDate: doc.assignedDate ? new Date(doc.assignedDate).toISOString() : null,
    dueDate: doc.dueDate ? new Date(doc.dueDate).toISOString() : null,
    percentage,
    initialPercentage,
    finalPercentage: doc.finalPercentage ?? 100,
    targetPercentage: doc.finalPercentage ?? 100,
    ticketStatus: percentage >= 100 ? "Closed" : "Open",
    parentId: doc.parent ? String(doc.parent) : null,
    childrenIds: doc.children.map((c) => String(c)),
    statusBucket: doc.statusBucket,
    comments: (doc.comments || []).map((c) => ({
      type: c.type,
      message: c.message,
      name: c.name || "",
      employeeId: c.employeeId || "",
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString()
    })),
    createdAt: doc.createdAt?.toISOString?.() ?? new Date(doc.createdAt).toISOString(),
    updatedAt: doc.updatedAt?.toISOString?.() ?? new Date(doc.updatedAt).toISOString()
  };
}

export function uniqStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const s = String(v);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
