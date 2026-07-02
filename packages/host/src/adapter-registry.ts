import { manifest as claudeCodeManifest } from "@sumeru/adapter-claude-code";
import { manifest as codexManifest } from "@sumeru/adapter-codex";
import type { AdapterManifest, ProviderMode } from "@sumeru/adapter-core";
import { manifest as cursorAgentManifest } from "@sumeru/adapter-cursor-agent";
import { manifest as hermesManifest } from "@sumeru/adapter-hermes";
import { manifest as sarsapaManifest } from "@sumeru/sarsapa";

const manifests = new Map<string, AdapterManifest>([
	[claudeCodeManifest.name, claudeCodeManifest],
	[codexManifest.name, codexManifest],
	[cursorAgentManifest.name, cursorAgentManifest],
	[hermesManifest.name, hermesManifest],
	[sarsapaManifest.name, sarsapaManifest],
]);

export function listAdapters(): AdapterManifest[] {
	return [...manifests.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getAdapterManifest(name: string): AdapterManifest | null {
	return manifests.get(name) ?? null;
}

export function getProviderMode(name: string): ProviderMode {
	return getAdapterManifest(name)?.providerMode ?? "custom-only";
}
