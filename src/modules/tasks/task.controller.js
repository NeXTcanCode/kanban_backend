import { mapTaskToDto } from "../../utils/hierarchy.js";
import * as tasks from "./task.service.js";

export async function listTasks(req, res) {
  const docs = await tasks.listTasks();
  res.json(docs.map(mapTaskToDto));
}

export async function getTask(req, res) {
  const doc = await tasks.getTask(req.params.id);
  res.json(mapTaskToDto(doc));
}

export async function createTask(req, res) {
  const doc = await tasks.createTask(req.body || {}, req.auth.user);
  res.status(201).json(mapTaskToDto(doc));
}

export async function patchTask(req, res) {
  const doc = await tasks.updateTask(req.params.id, req.body || {}, req.auth.user);
  res.json(mapTaskToDto(doc));
}

export async function deleteTask(req, res) {
  await tasks.deleteTask(req.params.id, req.auth.user);
  res.status(204).send();
}

export async function reorderTask(req, res) {
  await tasks.reorderTask(req.params.id, req.body || {}, req.auth.user);
  const parentId = (await tasks.getTask(req.params.id)).parent;
  res.json({ ok: true, parentId: parentId ? String(parentId) : null });
}

export async function moveTask(req, res) {
  const doc = await tasks.moveTask(req.params.id, req.body || {}, req.auth.user);
  res.json(mapTaskToDto(doc));
}

export async function setPercentage(req, res) {
  const doc = await tasks.setLeafPercentage(req.params.id, req.body || {}, req.auth.user);
  res.json(mapTaskToDto(doc));
}

export async function setBucket(req, res) {
  const doc = await tasks.setLeafBucket(req.params.id, req.body || {}, req.auth.user);
  res.json(mapTaskToDto(doc));
}
