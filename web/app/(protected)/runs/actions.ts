"use server";

import { revalidatePath } from "next/cache";
import {
  getServerAppwrite,
  purgeExpiredRuns,
  requestFailedRunRetry,
  updateRunRetentionDays,
  SettingsRepositoryError,
  type RetryResult,
} from "@newsletter/shared";

export async function retryFailedRun(runId: string): Promise<RetryResult> {
  const result = await requestFailedRunRetry(getServerAppwrite(), runId);
  if (result.ok) {
    revalidatePath("/runs");
  }
  return result;
}

export async function updateRunRetentionSetting(
  days: number,
): Promise<{ ok: true; days: number } | { ok: false; error: string }> {
  try {
    await updateRunRetentionDays(getServerAppwrite(), days);
    revalidatePath("/runs");
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
  try {
    const result = await purgeExpiredRuns(getServerAppwrite());
    revalidatePath("/runs");
    return { ok: true, deleted: result.deleted, errors: result.errors };
  } catch (err) {
    console.error("[runs/actions] purgeRunsNow", err);
    return {
      ok: false,
      error: "Something went wrong while cleaning up old runs.",
    };
  }
}
