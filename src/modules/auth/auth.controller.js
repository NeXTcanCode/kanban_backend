import * as auth from "./auth.service.js";

export async function signup(req, res) {
  const data = await auth.signup(req.body || {});
  res.status(201).json(data);
}

export async function login(req, res) {
  const data = await auth.login(req.body || {});
  res.json(data);
}

export async function me(req, res) {
  const user = await auth.getMe(req.auth.userId);
  res.json(user);
}

export async function patchMe(req, res) {
  const user = await auth.patchMe(req.auth.userId, req.body || {});
  res.json(user);
}

export async function createUser(req, res) {
  const user = await auth.createUserByRole(req.auth.user, req.body || {});
  res.status(201).json(user);
}

export async function companies(req, res) {
  const items = await auth.listCompanies(req.auth.user, req.query.q || "");
  res.json(items);
}

export async function departments(req, res) {
  const items = await auth.listDepartments(req.auth.user, req.query.company || "", req.query.q || "");
  res.json(items);
}

export async function assigneeSearch(req, res) {
  const items = await auth.searchAssignableUsers(req.auth.user, {
    company: req.query.company || "",
    department: req.query.department || "",
    query: req.query.q || ""
  });
  res.json(items);
}

export async function updateUserRole(req, res) {
  const user = await auth.updateUserRole(req.auth.user, req.params.id, req.body?.userRole);
  res.json(user);
}
