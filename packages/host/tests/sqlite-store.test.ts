import { afterEach, describe, expect, it } from "vitest";
import {
	maskApiKey,
	openDatabase,
	ProviderInUseError,
	type SqliteStore,
} from "../src/sqlite-store.js";

describe("sqlite-store", () => {
	let store: SqliteStore;

	afterEach(() => {
		store?.close();
	});

	it("masks api keys for display", () => {
		expect(maskApiKey(null)).toBeNull();
		expect(maskApiKey("short")).toBe("short****");
		expect(maskApiKey("sk-ant-1234567890abcdef")).toBe("sk-ant-1****");
	});

	it("runs provider CRUD lifecycle", () => {
		store = openDatabase(":memory:");

		const created = store.createProvider({
			name: "anthropic-local",
			apiType: "anthropic",
			baseUrl: "http://localhost:8080",
			apiKey: "sk-ant-secret-key",
		});
		expect(created.name).toBe("anthropic-local");
		expect(created.apiType).toBe("anthropic");
		expect(created.baseUrl).toBe("http://localhost:8080");
		expect(created.apiKey).toBe("sk-ant-s****");
		expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		const fetched = store.getProvider("anthropic-local");
		expect(fetched?.apiKey).toBe("sk-ant-s****");

		const listed = store.listProviders();
		expect(listed).toHaveLength(1);
		expect(listed[0]?.name).toBe("anthropic-local");

		const updated = store.updateProvider("anthropic-local", {
			apiType: "openai",
			baseUrl: "http://localhost:9090",
			apiKey: "sk-new-secret-key-value",
		});
		expect(updated?.apiType).toBe("openai");
		expect(updated?.baseUrl).toBe("http://localhost:9090");
		expect(updated?.apiKey).toBe("sk-new-s****");

		const partialUpdate = store.updateProvider("anthropic-local", {
			apiType: undefined,
			baseUrl: "http://localhost:7070",
			apiKey: undefined,
		});
		expect(partialUpdate?.apiType).toBe("openai");
		expect(partialUpdate?.baseUrl).toBe("http://localhost:7070");
		expect(partialUpdate?.apiKey).toBe("sk-new-s****");

		const keptKey = store.updateProvider("anthropic-local", {
			apiType: undefined,
			baseUrl: undefined,
			apiKey: undefined,
		});
		expect(keptKey?.apiKey).toBe("sk-new-s****");

		expect(store.deleteProvider("anthropic-local")).toBe(true);
		expect(store.getProvider("anthropic-local")).toBeNull();
		expect(store.deleteProvider("missing")).toBe(false);
	});

	it("runs model CRUD lifecycle", () => {
		store = openDatabase(":memory:");
		store.createProvider({
			name: "openai-proxy",
			apiType: "openai",
			baseUrl: "http://localhost:8080",
			apiKey: "sk-test",
		});

		const created = store.createModel({
			id: "gpt-4o-mini",
			provider: "openai-proxy",
			model: "gpt-4o-mini",
			contextWindow: 128000,
			toolUse: true,
			streaming: true,
			metadata: { tier: "fast" },
		});
		expect(created.id).toBe("gpt-4o-mini");
		expect(created.provider).toBe("openai-proxy");
		expect(created.model).toBe("gpt-4o-mini");
		expect(created.contextWindow).toBe(128000);
		expect(created.toolUse).toBe(true);
		expect(created.streaming).toBe(true);
		expect(created.metadata).toEqual({ tier: "fast" });

		const fetched = store.getModel("gpt-4o-mini");
		expect(fetched?.model).toBe("gpt-4o-mini");

		const listed = store.listModels();
		expect(listed).toHaveLength(1);

		const updated = store.updateModel("gpt-4o-mini", {
			provider: undefined,
			model: "gpt-4o",
			contextWindow: undefined,
			toolUse: false,
			streaming: undefined,
			metadata: undefined,
		});
		expect(updated?.model).toBe("gpt-4o");
		expect(updated?.contextWindow).toBe(128000);
		expect(updated?.toolUse).toBe(false);
		expect(updated?.streaming).toBe(true);
		expect(updated?.metadata).toEqual({ tier: "fast" });

		const clearedMetadata = store.updateModel("gpt-4o-mini", {
			provider: undefined,
			model: undefined,
			contextWindow: undefined,
			toolUse: undefined,
			streaming: undefined,
			metadata: null,
		});
		expect(clearedMetadata?.metadata).toBeNull();

		expect(store.deleteModel("gpt-4o-mini")).toBe(true);
		expect(store.getModel("gpt-4o-mini")).toBeNull();
		expect(store.deleteModel("missing")).toBe(false);
	});

	it("rejects provider delete when models reference it", () => {
		store = openDatabase(":memory:");
		store.createProvider({
			name: "in-use",
			apiType: "anthropic",
			baseUrl: null,
			apiKey: null,
		});
		store.createModel({
			id: "claude-sonnet",
			provider: "in-use",
			model: "claude-sonnet-4",
			contextWindow: null,
			toolUse: true,
			streaming: true,
			metadata: null,
		});

		expect(() => store.deleteProvider("in-use")).toThrow(ProviderInUseError);
		try {
			store.deleteProvider("in-use");
		} catch (err) {
			expect(err).toBeInstanceOf(ProviderInUseError);
			if (err instanceof ProviderInUseError) {
				expect(err.providerName).toBe("in-use");
				expect(err.modelCount).toBe(1);
			}
		}
		expect(store.getProvider("in-use")).not.toBeNull();
	});

	it("returns raw api key via getProviderApiKey", () => {
		store = openDatabase(":memory:");
		store.createProvider({
			name: "key-test",
			apiType: "anthropic",
			baseUrl: null,
			apiKey: "sk-very-secret-key-12345",
		});
		expect(store.getProviderApiKey("key-test")).toBe(
			"sk-very-secret-key-12345",
		);
		expect(store.getProvider("key-test")?.apiKey).toBe("sk-very-****");
		expect(store.getProviderApiKey("nonexistent")).toBeNull();
	});

	it("runs skill CRUD lifecycle", () => {
		store = openDatabase(":memory:");

		const created = store.createSkill({
			name: "test-skill",
			content: "# Test Skill\nSome content.",
		});
		expect(created.name).toBe("test-skill");
		expect(created.content).toBe("# Test Skill\nSome content.");
		expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		const fetched = store.getSkill("test-skill");
		expect(fetched?.content).toBe("# Test Skill\nSome content.");

		const listed = store.listSkills();
		expect(listed).toHaveLength(1);
		expect(listed[0]?.name).toBe("test-skill");

		expect(store.skillExists("test-skill")).toBe(true);
		expect(store.skillExists("nonexistent")).toBe(false);

		const updated = store.updateSkill("test-skill", {
			content: "# Updated\nNew content.",
		});
		expect(updated?.content).toBe("# Updated\nNew content.");

		expect(store.updateSkill("missing", { content: "x" })).toBeNull();

		expect(store.deleteSkill("test-skill")).toBe(true);
		expect(store.getSkill("test-skill")).toBeNull();
		expect(store.deleteSkill("missing")).toBe(false);
	});
});
