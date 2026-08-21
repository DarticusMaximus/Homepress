"use server";

import { revalidatePath } from "next/cache";
import {
  getServerAppwrite,
  PromptRepositoryError,
  resetPromptTemplate,
  SettingsRepositoryError,
  updateGlobalModelDefaults,
  updatePromptTemplate,
  type AppSettings,
  type PromptRole,
  type PromptTemplate,
} from "@newsletter/shared";
import { getAuthenticatedUser } from "@/lib/auth/session";

const GENERIC_ERROR = "Something went wrong. Please try again.";

export type UpdatePromptTemplateActionResult =
  | { ok: true; template: PromptTemplate; warnings: string[] }
  | { ok: false; error: string };

export type ResetPromptTemplateActionResult =
  | { ok: true; template: PromptTemplate; warnings: string[] }
  | { ok: false; error: string };

export type UpdateGlobalModelDefaultsActionResult =
  | {
      ok: true;
      settings: Pick<
        AppSettings,
        | "taggerModel"
        | "scorerModel"
        | "drafterModel"
        | "titleDekModel"
        | "embedderModel"
        | "updatedAt"
      >;
    }
  | { ok: false; error: string };

export type GlobalModelDefaultsInput = {
  taggerModel: string;
  scorerModel: string;
  drafterModel: string;
  titleDekModel: string;
  embedderModel: string;
};

export async function updatePromptTemplateAction(
  role: PromptRole,
  body: string,
): Promise<UpdatePromptTemplateActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: GENERIC_ERROR };
  }

  try {
    const result = await updatePromptTemplate(getServerAppwrite(), role, body);
    revalidatePath("/admin/prompts");
    return { ok: true, template: result.template, warnings: result.warnings };
  } catch (err) {
    if (err instanceof PromptRepositoryError && err.code === "validation") {
      return { ok: false, error: err.message };
    }
    console.error("[prompts/actions] updatePromptTemplateAction", err);
    return {
      ok: false,
      error: "Something went wrong while saving the prompt template.",
    };
  }
}

export async function resetPromptTemplateAction(
  role: PromptRole,
): Promise<ResetPromptTemplateActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: GENERIC_ERROR };
  }

  try {
    const result = await resetPromptTemplate(getServerAppwrite(), role);
    revalidatePath("/admin/prompts");
    return { ok: true, template: result.template, warnings: result.warnings };
  } catch (err) {
    if (err instanceof PromptRepositoryError && err.code === "validation") {
      return { ok: false, error: err.message };
    }
    console.error("[prompts/actions] resetPromptTemplateAction", err);
    return {
      ok: false,
      error: "Something went wrong while resetting the prompt template.",
    };
  }
}

export async function updateGlobalModelDefaultsAction(
  models: GlobalModelDefaultsInput,
): Promise<UpdateGlobalModelDefaultsActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: GENERIC_ERROR };
  }

  try {
    const settings = await updateGlobalModelDefaults(getServerAppwrite(), {
      taggerModel: models.taggerModel,
      scorerModel: models.scorerModel,
      drafterModel: models.drafterModel,
      titleDekModel: models.titleDekModel,
      embedderModel: models.embedderModel,
    });
    revalidatePath("/admin/prompts");
    return {
      ok: true,
      settings: {
        taggerModel: settings.taggerModel,
        scorerModel: settings.scorerModel,
        drafterModel: settings.drafterModel,
        titleDekModel: settings.titleDekModel,
        embedderModel: settings.embedderModel,
        updatedAt: settings.updatedAt,
      },
    };
  } catch (err) {
    if (err instanceof SettingsRepositoryError && err.code === "validation") {
      return { ok: false, error: err.message };
    }
    console.error("[prompts/actions] updateGlobalModelDefaultsAction", err);
    return {
      ok: false,
      error: "Something went wrong while saving default models.",
    };
  }
}
