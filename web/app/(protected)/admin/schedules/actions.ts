"use server";

import { revalidatePath } from "next/cache";
import {
  getServerAppwrite,
  NewsletterRepositoryError,
  updateNewsletterSchedule,
} from "@newsletter/shared";

export type ScheduleActionResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

function stringValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

export async function updateNewsletterScheduleAction(
  _prev: ScheduleActionResult | null,
  formData: FormData,
): Promise<ScheduleActionResult> {
  const newsletterId = stringValue(formData, "newsletterId");
  if (!newsletterId) {
    return { ok: false, error: "Newsletter not found" };
  }

  const scheduleEnabled = stringValue(formData, "scheduleEnabled") === "true";
  const scheduleCron = stringValue(formData, "scheduleCron") ?? "";
  const scheduleTimezone = stringValue(formData, "scheduleTimezone") ?? "";

  try {
    await updateNewsletterSchedule(getServerAppwrite(), newsletterId, {
      scheduleEnabled,
      scheduleCron,
      scheduleTimezone,
    });
    revalidatePath("/admin/schedules");
    revalidatePath("/admin/newsletters");
    return { ok: true };
  } catch (err) {
    if (err instanceof NewsletterRepositoryError) {
      return { ok: false, error: err.message };
    }
    console.error("[schedules]", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
