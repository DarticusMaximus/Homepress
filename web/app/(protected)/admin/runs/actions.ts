"use server";

import { revalidatePath } from "next/cache";
import {
  getServerAppwrite,
  purgeExpiredRuns,
  requestFailedRunRetry,
  requestRegenerateDraft,
  updateRunRetentionDays,
  SettingsRepositoryError,
  type RetryResult,
} from "@newsletter/shared";
import { requireOperator } from "@/lib/auth/require-operator";

export async function retryFailedRun(runId: string): Promise<RetryResult> {
  await requireOperator();
  const result = await requestFailedRunRetry(getServerAppwrite(), runId);
  if (result.ok) {
    revalidatePath("/admin/runs");
  }
  return result;
}

export async function regenerateDraft(runId: string): Promise<RetryResult> {
  await requireOperator();
  const result = await requestRegenerateDraft(getServerAppwrite(), runId);
  if (result.ok) {
    revalidatePath("/admin/runs");
    revalidatePath("/admin/issues");
    revalidatePath(`/admin/issues/${runId}`);
    revalidatePath(`/issues/${runId}`);
    revalidatePath("/");
  }
  return result;
}

export async function updateRunRetentionSetting(
  days: number,
): Promise<{ ok: true; days: number } | { ok: false; error: string }> {
  await requireOperator();
  try {
    await updateRunRetentionDays(getServerAppwrite(), days);
    revalidatePath("/admin/runs");
    return { ok: true, days };
  } catch (err) {
    if (err instanceof SettingsRepositoryError && err.code === "validation") {
      return { ok: false, error: err.message };
    }
    console.error("[runs/actions] updateRunRetentionSetting", err);
    return {
      ok: false,
      error: "Something went wrong while updating retention settings.",
    };
  }
}

export async function purgeRunsNow(): Promise<
  { ok: true; deleted: number; errors: number } | { ok: false; error: string }
> {
  await requireOperator();
  try {
    const result = await purgeExpiredRuns(getServerAppwrite());
    revalidatePath("/admin/runs");
    return { ok: true, deleted: result.deleted, errors: result.errors };
  } catch (err) {
    console.error("[runs/actions] purgeRunsNow", err);
    return {
      ok: false,
      error: "Something went wrong while cleaning up old runs.",
    };
  }
}
