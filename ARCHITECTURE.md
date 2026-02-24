# Backend Architecture: Hierarchical Kanban API (Node/Express/MongoDB)

## Overview

This document defines the backend architecture for hierarchical Kanban task management, including parent/child tree integrity, ordered sibling priority, percentage/status derivation, and API contracts aligned with frontend behavior.

## Latest Update (February 17, 2026, 3:36 AM)

The backend architecture now includes an active authentication and authorization boundary rather than only future hooks. A dedicated `auth` module was implemented with user model, service, controller, and routes for signup, login, profile read/update, and role-based user creation. Task routes are now protected by auth middleware, and token verification is enforced before API access. User schema rules support optional `company`, `designation`, and `employeeId` while preserving required credentials and role identity. Patch constraints were formalized: `name` and `userRole` are immutable, and `designation`/`employeeId` become immutable after first set. Role-creation policy is hierarchical and explicit: leader -> coleader/elder/member, coleader -> elder/member, elder -> member.

## Language Standard

- Implementation language: JavaScript (ES2022)
- Runtime modules: `.js`
- Do not use TypeScript in this project unless explicitly requested later.

## Tech Stack (Feb 2026 Baseline)

- Runtime: Node.js `20.x` or `22.x` LTS
- Framework: Express `^4.19+`
- Database: MongoDB with Mongoose `^8.x`
- Utilities: `cors`, `dotenv`, `uuid`
- Optional auth: `jsonwebtoken`
- Optional real-time: `socket.io`

## Project Structure

```text
backKanban/
  src/
    app.js
    server.js
    config/
      env.js
      db.js
    modules/
      tasks/
        task.model.js
        task.validators.js
        task.service.js
        task.controller.js
        task.routes.js
        task.repo.js
    middleware/
      errorHandler.js
      auth.js
      requestId.js
    utils/
      hierarchy.js
      percentage.js
      apiError.js
    tests/
      unit/
      integration/
```

## Task Schema (Mongoose)

Based on provided task contract:

```js
const taskDocumentShape = {
  _id: "ObjectId",
  name: "string",
  department: "string",
  assignedTo: ["string"],
  assignedBy: ["string"],
  percentage: 0,
  ticketStatus: "string",
  parent: null,
  children: [],
  createdAt: "Date",
  updatedAt: "Date"
};
```

### Storage Semantics

- `parent` stores single parent reference or `null` for roots.
- `children` stores ordered child references (priority = array order).
- `percentage` stored on all nodes for query efficiency, recomputed on parent-impacting updates.
- `timestamps: true` for `createdAt`, `updatedAt`.

## Hierarchy Invariants

- No cycles are allowed.
- Parent-child links must be consistent:
  - if `A.children` contains `B`, then `B.parent` must equal `A`.
- `children` ordering is stable and authoritative for priority.
- Root tasks have `parent = null`.
- A task cannot be parented to itself or any descendant.

## Percentage and Status Computation Rules

### Bucket Derivation (shared with frontend)

- `0` => `Not Started`
- `1-50` => `On Hold`
- `51-99` => `In Progress`
- `100` => `Completed`

### Recompute Rules

- Leaf percentage is directly editable (`0-100`).
- Parent percentage is derived as average of direct children percentages.
- Recompute triggered on:
  - leaf percentage update,
  - add/remove/reorder child,
  - reparent/move operations.

### Completion Guard

- Parent `Completed` state is valid only if all descendants are `100`.
- If direct-child average reaches `100` but any descendant is below `100`, parent bucket must not be emitted as completed.

## API Surface (Contract-Level)

Base path: `/api/tasks`

### CRUD

- `POST /api/tasks`
  - create task (root or child).
- `GET /api/tasks`
  - list tasks (optionally filtered by department/assignee/status).
- `GET /api/tasks/:id`
  - fetch single task.
- `PATCH /api/tasks/:id`
  - partial update (name, department, ticketStatus, leaf percentage).
- `DELETE /api/tasks/:id`
  - delete task (policy: cascade or block must be explicit in implementation).

### Hierarchy and Ordering Mutations

- `PATCH /api/tasks/:id/reorder`
  - reorder among siblings using target index.
- `PATCH /api/tasks/:id/move`
  - reparent task to `newParentId` (or `null` for root) and optional insertion index.
- `PATCH /api/tasks/:id/percentage`
  - update leaf percentage only; rejects parent-targeted direct update.
- `PATCH /api/tasks/bulk` (optional)
  - batch non-structural updates for efficiency.

## Request/Response DTO Contracts

### Task DTO

```js
const taskDto = {
  id: "string",
  name: "string",
  department: "string",
  assignedTo: ["string"],
  assignedBy: ["string"],
  percentage: 0,
  ticketStatus: "Open",
  parentId: null,
  childrenIds: [],
  statusBucket: "Not Started",
  createdAt: "2026-02-14T00:00:00.000Z",
  updatedAt: "2026-02-14T00:00:00.000Z"
};
```

### Error DTO

```js
const apiError = {
  statusCode: 400,
  code: "INVALID_PERCENTAGE",
  message: "Percentage must be between 0 and 100"
};
```

## Validation and Error Handling

- Reject out-of-range percentage values (`<0`, `>100`).
- Reject invalid/missing parent references.
- Reject moves causing cycles (`CYCLE_DETECTED`).
- Reject parent direct percentage edits (`PARENT_PERCENTAGE_READ_ONLY`).
- Reject children arrays containing duplicates or stale IDs.
- Normalize all IDs and return `404` for missing resources.

## Concurrency and Consistency

- Hierarchy mutations should be executed atomically (MongoDB transaction when available).
- Recompute ancestor chains in same mutation unit to avoid stale reads.
- Use optimistic concurrency (`updatedAt` or version key) to detect conflicting writes.
- Emit consistent post-mutation payloads so frontend can reconcile without extra round trips.

## Indexing and Query Strategy

- Indexes:
  - `{ parent: 1 }` for tree traversal
  - `{ department: 1 }` for filtering
  - `{ assignedTo: 1 }` for assignee filtering
  - optional compound indexes for frequent dashboard queries
- Keep percentage/status precomputed on document for fast status-column retrieval.

## Security and Auth Hooks (Future-Ready)

- Add auth middleware boundary at route layer.
- Validate requester permissions for mutation operations.
- Prefer tenant/workspace scoping field if multi-org support is expected.
- Log audit trails for hierarchy moves and percentage changes.

## Testing Strategy

- Unit tests:
  - hierarchy validators,
  - percentage recomputation utilities,
  - cycle detection.
- Model tests:
  - schema constraints and hooks.
- Service tests:
  - move/reorder transaction behavior and ancestor updates.
- Integration tests:
  - endpoint contracts,
  - DTO mapping consistency,
  - error code semantics.

## Required Test Scenarios

1. Leaf moved `In Progress -> Completed` updates percentage and recomputes ancestor chain.
2. Reorder among siblings changes only `children` order.
3. Move under descendant is rejected with cycle error.
4. Parent percentage uses direct-child average after mixed updates.
5. Parent completion is blocked when any descendant is incomplete.
6. Invalid percentage (`<0` or `>100`) is rejected.
7. API response shape maps `_id/parent/children` to `id/parentId/childrenIds` consistently.

## Shared Interface Alignment with Frontend

- Canonical fields:
  - backend `_id`, `parent`, `children`
  - frontend `id`, `parentId`, `childrenIds`
- Bucket derivation rules are identical across layers.
- Parent recomputation trigger points are identical across layers.
- Priority is represented by ordered children arrays.
- Non-negotiable invariants:
  - no cycles,
  - consistent parent-child linkage,
  - deterministic ordering.

## Open Points

- Auth provider choice and permission model.
- Real-time transport (`socket.io` or SSE).
- Audit/history retention model.
- Deletion policy for parents with descendants (block vs cascade vs soft-delete).

## Context Window Usage

- Date: `2026-02-15`
- Context Window Used: `60%`

## Workflow Performed

1. Implemented Express app bootstrapping with env/db/config and middleware boundaries.
2. Added task schema with hierarchy fields, timeline fields, and comment log records.
3. Implemented task CRUD plus hierarchy operations (`move`, `reorder`, leaf percentage updates).
4. Added cascade delete for parent tasks with descendant cleanup.
5. Added parent recomputation logic for derived percentage and status buckets.
6. Added immutable timeline logging for creation, edits, assignment, timeline, and moves.
7. Added CORS hardening to support preflight and PATCH requests from frontend origin.
