import type { BuiltinModel } from "@sumeru/adapter-core";

export async function listModels(credential: string): Promise<BuiltinModel[]> {
	const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
		headers: {
			"x-api-key": credential,
			"anthropic-version": "2023-06-01",
		},
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Anthropic API error ${res.status}: ${text}`);
	}
	const data = (await res.json()) as {
		data: Array<{
			id: string;
			display_name?: string;
			context_window?: number;
		}>;
	};
	return data.data.map((m) => ({
		id: m.id,
		name: m.display_name ?? m.id,
		contextWindow: m.context_window ?? null,
	}));
}
