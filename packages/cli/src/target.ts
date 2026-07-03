import type { SessionInfo } from "@sumeru/core";
import type { ApiClient } from "./api-client.js";

export async function resolveTarget(
	target: string,
	api: ApiClient,
): Promise<string> {
	if (target.startsWith("ses_")) {
		return target;
	}
	const { envelope } = await api.post<SessionInfo>("/sessions", {
		prototype: target,
		project: process.cwd(),
		task: "chat",
		model: null,
		env: null,
	});
	return envelope.value.id;
}
