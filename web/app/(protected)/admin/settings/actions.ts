"use server";

import { revalidatePath } from "next/cache";
import {
  diagnoseOpenRouterConnection,
  diagnosePublicUrl,
  diagnoseSmtpConnection,
  getServerAppwrite,
  sanitizeAppwriteMessageForLog,
  SettingsRepositoryError,
  updateConnectionSettings,
  updatePipelineKnobsSettings,
  clearOpenRouterApiKeyOverride,
  clearSmtpBundleOverride,
  type ConnectionDiagnosticResult,
} from "@newsletter/shared";
import { requireOperator } from "@/lib/auth/require-operator";

export type SettingsActionResult = { ok: true } | { ok: false; error: string };

export type SettingsDiagnosticActionResult = ConnectionDiagnosticResult;

export type ConnectionsSettingsInput = {
  openRouterApiKey: string;
  smtpHost: string;
  smtpPort: number | null;
  smtpUsername: string;
  smtpPassword: string;
  smtpFrom: string;
  smtpSecure: string;
  appPublicUrl: string;
};

export type PipelineKnobsSettingsInput = {
  scoreThreshold: number | null;
  crossRunSimilarityThreshold: number | null;
  rssFeedMaxItems: number | null;
  drafterReasoningEffort: string;
  drafterMaxCompletionTokens: number | null;
};

const GENERIC_SAVE_ERROR = "Something went wrong while saving settings. Please try again.";
const GENERIC_DIAGNOSTIC_ERROR =
  "Something went wrong while checking the connection. Please try again.";

/**
 * Log settings-action failures without dumping the raw Error / unknown.
 * Uses sanitizeAppwriteMessageForLog (same spirit as diagnostics). Optional
 * safe name/code only — never secrets that may appear in err.message.
 */
function logSettingsActionFailure(phase: string, err: unknown, messageRaw: string): void {
  const payload: { message: string; name?: string; code?: string } = {
    message: sanitizeAppwriteMessageForLog(messageRaw),
  };
  if (err instanceof Error && err.name) {
    payload.name = err.name;
  }
  if (err instanceof SettingsRepositoryError) {
    payload.code = err.code;
  }
  console.error(`[settings/actions] ${phase}`, payload);
}

function mapSettingsActionError(err: unknown, phase: string): SettingsActionResult {
  if (err instanceof SettingsRepositoryError && err.code === "validation") {
    return { ok: false, error: err.message };
  }
  // Fixed summary — do not echo err.message. OpenRouter keys and short SMTP
  // passwords (missed by LONG_RUN) can appear in Appwrite/client error text.
  logSettingsActionFailure(phase, err, "settings action failed");
  return { ok: false, error: GENERIC_SAVE_ERROR };
}

export async function saveConnectionsSettingsAction(
  input: ConnectionsSettingsInput,
): Promise<SettingsActionResult> {
  await requireOperator();
  try {
    const client = getServerAppwrite();
    await updateConnectionSettings(client, input);
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return mapSettingsActionError(err, "saveConnectionsSettingsAction");
  }
}

export async function savePipelineKnobsSettingsAction(
  input: PipelineKnobsSettingsInput,
): Promise<SettingsActionResult> {
  await requireOperator();
  try {
    const client = getServerAppwrite();
    await updatePipelineKnobsSettings(client, input);
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return mapSettingsActionError(err, "savePipelineKnobsSettingsAction");
  }
}

/** Immediate Clear OpenRouter — writes `""`, not empty→keep. */
export async function clearOpenRouterOverrideAction(): Promise<SettingsActionResult> {
  await requireOperator();
  try {
    const client = getServerAppwrite();
    await clearOpenRouterApiKeyOverride(client);
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return mapSettingsActionError(err, "clearOpenRouterOverrideAction");
  }
}

/** Immediate Clear SMTP — clears all six GUI attrs, not password-only. */
export async function clearSmtpOverrideAction(): Promise<SettingsActionResult> {
  await requireOperator();
  try {
    const client = getServerAppwrite();
    await clearSmtpBundleOverride(client);
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return mapSettingsActionError(err, "clearSmtpOverrideAction");
  }
}

function mapDiagnosticActionError(err: unknown, phase: string): SettingsDiagnosticActionResult {
  // Never surface thrown messages — they may include secrets from infra layers.
  const raw = err instanceof Error ? err.message : String(err);
  logSettingsActionFailure(phase, err, raw);
  return { status: "fail", message: GENERIC_DIAGNOSTIC_ERROR };
}

/** Probe OpenRouter using resolved operator settings (GUI → env). */
export async function testOpenRouterConnectionAction(): Promise<SettingsDiagnosticActionResult> {
  await requireOperator();
  try {
    const client = getServerAppwrite();
    return await diagnoseOpenRouterConnection({ client });
  } catch (err) {
    return mapDiagnosticActionError(err, "testOpenRouterConnectionAction");
  }
}

/** Probe SMTP using resolved operator settings (GUI → env). */
export async function testSmtpConnectionAction(): Promise<SettingsDiagnosticActionResult> {
  await requireOperator();
  try {
    const client = getServerAppwrite();
    return await diagnoseSmtpConnection({ client });
  } catch (err) {
    return mapDiagnosticActionError(err, "testSmtpConnectionAction");
  }
}

/** Check reachability of the resolved public app URL. */
export async function checkPublicUrlAction(): Promise<SettingsDiagnosticActionResult> {
  await requireOperator();
  try {
    const client = getServerAppwrite();
    return await diagnosePublicUrl({ client });
  } catch (err) {
    return mapDiagnosticActionError(err, "checkPublicUrlAction");
  }
}
