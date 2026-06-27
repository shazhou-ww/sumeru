import type { IncomingMessage, ServerResponse } from "node:http";
import type { InstanceInfo } from "@sumeru/core";
import {
	errorEnvelope,
	instanceEnvelope,
	instanceListEnvelope,
	instanceStatusEnvelope,
} from "../envelope.js";
import { readJsonBody, writeJson } from "../http-utils.js";
import type { InstanceManager } from "../instance-manager.js";
import type { CreateInstanceRequest, ManagedInstance } from "../types.js";

function toInstanceInfo(record: ManagedInstance): InstanceInfo {
	return {
		id: record.id,
		prototype: record.prototype,
		status: record.status,
		createdAt: record.createdAt,
		projects: record.projects,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createInstancesHandler(manager: InstanceManager) {
	return {
		list(_req: IncomingMessage, res: ServerResponse): void {
			writeJson(res, 200, instanceListEnvelope(manager.listInstances()));
		},

		async create(req: IncomingMessage, res: ServerResponse): Promise<void> {
			let body: unknown;
			try {
				body = await readJsonBody(req);
			} catch {
				writeJson(
					res,
					400,
					errorEnvelope("invalid_json", "Request body must be valid JSON"),
				);
				return;
			}
			const parsed = parseCreateBody(body);
			if (parsed === null) {
				writeJson(
					res,
					400,
					errorEnvelope(
						"invalid_request",
						'Body must include non-empty string field "prototype"',
					),
				);
				return;
			}
			try {
				const created = await manager.createInstance(parsed);
				writeJson(res, 201, instanceEnvelope(toInstanceInfo(created)));
			} catch (err) {
				writeInstanceError(res, err);
			}
		},

		async remove(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			try {
				await manager.deleteInstance(params.id ?? "");
				res.statusCode = 204;
				res.end();
			} catch (err) {
				writeInstanceError(res, err);
			}
		},

		async status(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			const id = params.id ?? "";
			const record = manager.getInstance(id);
			if (record === null) {
				writeJson(
					res,
					404,
					errorEnvelope("instance_not_found", `Instance ${id} not found`),
				);
				return;
			}
			try {
				const status = await manager.getStatus(id);
				writeJson(
					res,
					200,
					instanceStatusEnvelope({
						id,
						status,
						containerId: record.containerId,
					}),
				);
			} catch (err) {
				writeInstanceError(res, err);
			}
		},

		async reset(
			_req: IncomingMessage,
			res: ServerResponse,
			params: Record<string, string>,
		): Promise<void> {
			try {
				const updated = await manager.resetInstance(params.id ?? "");
				writeJson(res, 200, instanceEnvelope(toInstanceInfo(updated)));
			} catch (err) {
				writeInstanceError(res, err);
			}
		},
	};
}

function parseCreateBody(body: unknown): CreateInstanceRequest | null {
	if (!isRecord(body)) return null;
	const prototype = body.prototype;
	if (typeof prototype !== "string" || prototype.length === 0) return null;
	const projectsRaw = body.projects;
	if (projectsRaw === undefined || projectsRaw === null) {
		return { prototype, projects: null };
	}
	if (!Array.isArray(projectsRaw)) return null;
	const projects: Array<string> = [];
	for (const item of projectsRaw) {
		if (typeof item !== "string") return null;
		projects.push(item);
	}
	return { prototype, projects };
}

function writeInstanceError(res: ServerResponse, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	switch (message) {
		case "prototype_not_found":
			writeJson(
				res,
				404,
				errorEnvelope("prototype_not_found", "Prototype not found"),
			);
			return;
		case "instance_not_found":
			writeJson(
				res,
				404,
				errorEnvelope("instance_not_found", "Instance not found"),
			);
			return;
		case "max_instances_reached":
			writeJson(
				res,
				409,
				errorEnvelope("max_instances_reached", "Maximum instances reached"),
			);
			return;
		case "cannot_delete_master":
		case "cannot_reset_master":
			writeJson(
				res,
				400,
				errorEnvelope("invalid_request", "Master instance cannot be modified"),
			);
			return;
		default:
			writeJson(res, 500, errorEnvelope("internal_error", message));
	}
}
