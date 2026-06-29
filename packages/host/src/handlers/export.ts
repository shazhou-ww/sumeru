import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { errorEnvelope } from "../envelope.js";
import { writeJson } from "../http-utils.js";
import type { InstanceManager } from "../instance-manager.js";
import type { InstanceId } from "../legacy-types.js";
import { openOcasStore, readChain } from "../ocas-recorder.js";

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

		const handle = openOcasStore(dataDir);
		try {
			const chain = readChain(handle.store, id);
			if (chain.length === 0) {
				writeJson(
					res,
					404,
					errorEnvelope("no_history", "No history for instance"),
				);
				return;
			}

			const ndjson = `${chain
				.map((entry) =>
					JSON.stringify({
						hash: entry.hash,
						...entry.payload,
					}),
				)
				.join("\n")}\n`;

			res.statusCode = 200;
			res.setHeader("Content-Type", "application/gzip");
			res.setHeader(
				"Content-Disposition",
				`attachment; filename="${id}.ndjson.gz"`,
			);

			const source = Readable.from([ndjson]);
			const gzip = createGzip();
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
		} finally {
			handle.close();
		}
	};
}
