export function clampPercentage(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 0) return null;
  if (value > 100) return null;
  return Math.round(value);
}

export function bucketForPercentage(pct) {
  if (pct === 0) return "Not Started";
  if (pct >= 1 && pct <= 50) return "On Hold";
  if (pct >= 51 && pct <= 99) return "In Progress";
  if (pct === 100) return "Completed";
  return "Not Started";
}

export function defaultPercentageForBucket(bucket) {
  if (bucket === "Not Started") return 0;
  if (bucket === "On Hold") return 1;
  if (bucket === "In Progress") return 51;
  if (bucket === "Completed") return 100;
  return 0;
}

