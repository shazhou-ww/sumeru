import type { BuiltinModel } from "@sumeru/adapter-core";

export async function listModels(credential: string): Promise<BuiltinModel[]> {
	const res = await fetch("https://api.openai.com/v1/models", {
		headers: { Authorization: `Bearer ${credential}` },
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`OpenAI API error ${res.status}: ${text}`);
	}
	const data = (await res.json()) as {
		data: Array<{ id: string }>;
	};
	return data.data.map((m) => ({
		id: m.id,
		name: m.id,
		contextWindow: null,
	}));
}
