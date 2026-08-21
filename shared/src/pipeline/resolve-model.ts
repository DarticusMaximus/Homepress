import { DEFAULT_MODELS, type ModelComponent } from "./config";

export type ModelIdSources = {
  newsletterOverride?: string | null;
  globalDefault?: string | null;
  envValue?: string | null;
};

function firstNonEmpty(...candidates: Array<string | null | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

export function resolveModelId(role: ModelComponent, sources: ModelIdSources = {}): string {
  return (
    firstNonEmpty(sources.newsletterOverride, sources.globalDefault, sources.envValue) ??
    DEFAULT_MODELS[role]
  );
}

export type ResolvedModelIds = Record<ModelComponent, string>;

export type AllModelIdSources = {
  newsletterOverrides?: Partial<Record<ModelComponent, string | null>>;
  globalDefaults?: Partial<Record<ModelComponent, string | null>>;
  envValues?: Partial<Record<ModelComponent, string | null>>;
};

const MODEL_ROLES: readonly ModelComponent[] = ["tagger", "scorer", "drafter", "titleDek", "embedder"];

export function resolveAllModelIds(sources: AllModelIdSources = {}): ResolvedModelIds {
  const result = {} as ResolvedModelIds;
  for (const role of MODEL_ROLES) {
    result[role] = resolveModelId(role, {
      newsletterOverride: sources.newsletterOverrides?.[role],
      globalDefault: sources.globalDefaults?.[role],
      envValue: sources.envValues?.[role],
    });
  }
  return result;
}
