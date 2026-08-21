import type { Client } from "node-appwrite";

import type { Newsletter } from "../newsletters/types";
import { ENV_MODEL_KEYS, type ModelComponent } from "../pipeline/config";
import { resolveAllModelIds } from "../pipeline/resolve-model";
import { PROMPT_ROLES, type PromptRole } from "../prompts/types";
import { listPromptTemplates } from "../prompts/repository";
import { getOrCreateAppSettings } from "../settings/repository";

export type RunLlmResolution = {
  models: Record<ModelComponent, string>;
  prompts: Record<PromptRole, string>;
};

/**
 * Load claim-time prompt bodies and resolve model IDs for a newsletter run.
 * Cascade: newsletter override → global app_settings → env → built-in DEFAULT_MODELS.
 * Repository/Appwrite failures propagate (operator-safe messages from the stores).
 */
export async function loadRunLlmResolution(
  client: Client,
  newsletter: Newsletter,
): Promise<RunLlmResolution> {
  const templates = await listPromptTemplates(client);
  const settings = await getOrCreateAppSettings(client);

  const prompts = {} as RunLlmResolution["prompts"];
  for (const role of PROMPT_ROLES) {
    const template = templates.find((t) => t.role === role);
    if (!template) {
      throw new Error(
        "Could not load prompt templates or model settings. Please try again.",
      );
    }
    prompts[role] = template.body;
  }

  // Newsletter drafter prompt override: non-empty after trim wins over global.
  const drafterOverride = newsletter.drafterPrompt.trim();
  if (drafterOverride.length > 0) {
    prompts.drafter = drafterOverride;
  }

  const models = resolveAllModelIds({
    newsletterOverrides: {
      tagger: newsletter.taggerModel,
      scorer: newsletter.scorerModel,
      drafter: newsletter.drafterModel,
      titleDek: newsletter.titleDekModel,
      embedder: newsletter.embedderModel,
    },
    globalDefaults: {
      tagger: settings.taggerModel,
      scorer: settings.scorerModel,
      drafter: settings.drafterModel,
      titleDek: settings.titleDekModel,
      embedder: settings.embedderModel,
    },
    envValues: {
      tagger: process.env[ENV_MODEL_KEYS.tagger] ?? null,
      scorer: process.env[ENV_MODEL_KEYS.scorer] ?? null,
      drafter: process.env[ENV_MODEL_KEYS.drafter] ?? null,
      titleDek: process.env[ENV_MODEL_KEYS.titleDek] ?? null,
      embedder: process.env[ENV_MODEL_KEYS.embedder] ?? null,
    },
  });

  return { models, prompts };
}
