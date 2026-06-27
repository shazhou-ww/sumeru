import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { InstanceId } from "@sumeru/core";
import { errorEnvelope } from "../envelope.js";
import { writeJson } from "../http-utils.js";
import type { InstanceManager } from "../instance-manager.js";

export function createExportHandler(manager: InstanceManager, dataDir: string) {
	return async (
		_req: IncomingMessage,
		res: ServerResponse,
		params: Record<string, string>,
		_path: string,
		_queryString: string,
	): Promise<void> => {
		const id = (params.id ?? "") as InstanceId;
		const record = manager.getInstance(id);
		if (record === null) {
			writeJson(
				res,
				404,
				errorEnvelope("instance_not_found", "Instance not found"),
			);
			return;
		}

		const filePath = join(dataDir, `${id}.jsonl`);
		if (!hasHistory(filePath)) {
			writeJson(
				res,
				404,
				errorEnvelope("no_history", "No history for instance"),
			);
			return;
		}

		res.statusCode = 200;
		res.setHeader("Content-Type", "application/gzip");
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="${id}.jsonl.gz"`,
		);

		const gzip = createGzip();
		const source = createReadStream(filePath);
		try {
			await pipeline(source, gzip, res);
		} catch {
			if (!res.headersSent) {
				writeJson(
					res,
					500,
					errorEnvelope("export_failed", "Failed to export instance history"),
				);
			}
		}
	};
}

function hasHistory(filePath: string): boolean {
	if (!existsSync(filePath)) return false;
	try {
		return statSync(filePath).size > 0;
	} catch {
		return false;
	}
}
