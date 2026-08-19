"use server";

import { revalidatePath } from "next/cache";
import type { NewsletterDateRange } from "@newsletter/shared";
import type { StartRunResult } from "@newsletter/shared";
import {
  attachFeed,
  createNewsletter,
  deleteNewsletter,
  detachFeed,
  enqueueNewsletterRun,
  getNewsletter,
  getServerAppwrite,
  NewsletterRepositoryError,
  parseChipJsonField,
  resolveDeliveryFields,
  setScheduleLastFiredAt,
  updateNewsletter,
  updateNewsletterDelivery,
  updateNewsletterSchedule,
  validateChipList,
} from "@newsletter/shared";
import { getAuthenticatedUser } from "@/lib/auth/session";

export type NewsletterActionResult =
  | { ok: true; newsletterId?: string }
  | { ok: false; error: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Returned when definition save fails and schedule/delivery rollback also fails.
 * Schedule and delivery may be out of sync with the prior definition.
 */
const SCHEDULE_PARTIAL_FAILURE_ERROR =
  "Newsletter details could not be saved, but the schedule or delivery settings were already changed and could not be restored. Refresh Schedules and Newsletters — schedule and delivery may be out of sync.";

async function runNewsletterAction(
  fn: () => Promise<void>,
  revalidatePaths: string[] = ["/admin/newsletters"],
): Promise<NewsletterActionResult> {
  try {
    await fn();
    for (const path of revalidatePaths) {
      revalidatePath(path);
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof NewsletterRepositoryError) {
      return { ok: false, error: err.message };
    }
    console.error("[newsletters]", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

function stringValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

/** Checkbox FormData: "on" / "true" / "1" → true; absent or other → false. */
function parseCheckboxFlag(formData: FormData, key: string): boolean {
  const raw = stringValue(formData, key);
  return raw === "on" || raw === "true" || raw === "1";
}

function parseScheduleEnabled(formData: FormData): boolean {
  return parseCheckboxFlag(formData, "scheduleEnabled");
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export async function createNewsletterAction(
  _prev: NewsletterActionResult | null,
  formData: FormData,
): Promise<NewsletterActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const name = stringValue(formData, "name") ?? "";
  const topicsJson = stringValue(formData, "topicsJson");
  const dislikedTopicsJson = stringValue(formData, "dislikedTopicsJson");
  const audience = stringValue(formData, "audience");
  const newsItems = parseOptionalInt(stringValue(formData, "newsItems"));
  const lookback = parseOptionalInt(stringValue(formData, "lookback"));
  const dateRange = stringValue(formData, "dateRange") as NewsletterDateRange | undefined;

  // Create UI is Basics-only — do not read model override FormData; repository defaults to "".
  try {
    const topics = validateChipList(parseChipJsonField("topics", topicsJson), "topics");
    const dislikedTopics = validateChipList(
      parseChipJsonField("disliked topics", dislikedTopicsJson),
      "disliked topics",
    );
    const created = await createNewsletter(getServerAppwrite(), {
      name,
      topics,
      dislikedTopics,
      audience,
      newsItems,
      lookback,
      dateRange,
    });
    revalidatePath("/admin/newsletters");
    revalidatePath(`/admin/newsletters/${created.$id}`);
    return { ok: true, newsletterId: created.$id };
  } catch (err) {
    if (err instanceof NewsletterRepositoryError) {
      return { ok: false, error: err.message };
    }
    console.error("[newsletters]", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function updateNewsletterAction(
  _prev: NewsletterActionResult | null,
  formData: FormData,
): Promise<NewsletterActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const newsletterId = stringValue(formData, "newsletterId");
  if (!newsletterId) {
    return { ok: false, error: "Newsletter not found" };
  }

  const name = stringValue(formData, "name") ?? "";
  const topicsJson = stringValue(formData, "topicsJson");
  const dislikedTopicsJson = stringValue(formData, "dislikedTopicsJson");
  const audience = stringValue(formData, "audience") ?? "";
  const newsItems = parseOptionalInt(stringValue(formData, "newsItems"));
  const lookback = parseOptionalInt(stringValue(formData, "lookback"));
  const dateRange = stringValue(formData, "dateRange") as NewsletterDateRange | undefined;
  const taggerModel = stringValue(formData, "taggerModel") ?? "";
  const scorerModel = stringValue(formData, "scorerModel") ?? "";
  const drafterModel = stringValue(formData, "drafterModel") ?? "";
  const embedderModel = stringValue(formData, "embedderModel") ?? "";
  // Edit Advanced tab submits drafterPrompt; when key absent, preserve existing override.
  const drafterPromptRaw = stringValue(formData, "drafterPrompt");

  const scheduleEnabled = parseScheduleEnabled(formData);
  const scheduleCron = (stringValue(formData, "scheduleCron") ?? "").trim();
  const scheduleTimezone = (stringValue(formData, "scheduleTimezone") ?? "").trim();

  const autoEmail = parseCheckboxFlag(formData, "autoEmail");
  const autoRss = parseCheckboxFlag(formData, "autoRss");
  const recipientEmailsJson = stringValue(formData, "recipientEmailsJson");

  return runNewsletterAction(
    async () => {
      const topics = validateChipList(
        parseChipJsonField("topics", topicsJson, { required: true }),
        "topics",
      );
      const dislikedTopics = validateChipList(
        parseChipJsonField("disliked topics", dislikedTopicsJson, {
          required: true,
        }),
        "disliked topics",
      );
      const recipientEmails = parseChipJsonField("recipients", recipientEmailsJson, {
        required: true,
      });
      // Validate delivery before any Appwrite write so invalid recipients never
      // leave a committed schedule (or delivery) change.
      const deliveryFields = resolveDeliveryFields({
        recipientEmails,
        autoEmail,
        autoRss,
      });

      const client = getServerAppwrite();
      // Load prior so we can roll back schedule (+ delivery) if a later write fails.
      const prior = await getNewsletter(client, newsletterId);
      // Locked order: schedule → delivery → definition.
      await updateNewsletterSchedule(client, newsletterId, {
        scheduleEnabled,
        scheduleCron,
        scheduleTimezone,
      });
      try {
        await updateNewsletterDelivery(client, newsletterId, deliveryFields);
      } catch (deliveryErr) {
        try {
          await updateNewsletterSchedule(client, newsletterId, {
            scheduleEnabled: prior.scheduleEnabled,
            scheduleCron: prior.scheduleCron,
            scheduleTimezone: prior.scheduleTimezone,
          });
          if (prior.scheduleLastFiredAt) {
            await setScheduleLastFiredAt(
              client,
              newsletterId,
              prior.scheduleLastFiredAt,
            );
          }
        } catch (rollbackErr) {
          console.error("[newsletters] schedule rollback failed", rollbackErr);
          revalidatePath("/admin/newsletters");
          revalidatePath("/admin/schedules");
          throw new NewsletterRepositoryError(
            "appwrite",
            SCHEDULE_PARTIAL_FAILURE_ERROR,
          );
        }
        throw deliveryErr;
      }
      try {
        await updateNewsletter(client, newsletterId, {
          name,
          topics,
          dislikedTopics,
          audience,
          newsItems: newsItems ?? 0,
          lookback: lookback ?? -1,
          dateRange: (dateRange ?? "") as NewsletterDateRange,
          taggerModel,
          scorerModel,
          drafterModel,
          embedderModel,
          drafterPrompt: drafterPromptRaw ?? prior.drafterPrompt,
        });
      } catch (definitionErr) {
        try {
          await updateNewsletterSchedule(client, newsletterId, {
            scheduleEnabled: prior.scheduleEnabled,
            scheduleCron: prior.scheduleCron,
            scheduleTimezone: prior.scheduleTimezone,
          });
          if (prior.scheduleLastFiredAt) {
            await setScheduleLastFiredAt(
              client,
              newsletterId,
              prior.scheduleLastFiredAt,
            );
          }
          await updateNewsletterDelivery(client, newsletterId, {
            recipientEmails: prior.recipientEmails,
            autoEmail: prior.autoEmail,
            autoRss: prior.autoRss,
          });
        } catch (rollbackErr) {
          console.error(
            "[newsletters] schedule/delivery rollback failed",
            rollbackErr,
          );
          revalidatePath("/admin/newsletters");
          revalidatePath("/admin/schedules");
          throw new NewsletterRepositoryError(
            "appwrite",
            SCHEDULE_PARTIAL_FAILURE_ERROR,
          );
        }
        throw definitionErr;
      }
    },
    ["/admin/newsletters", `/admin/newsletters/${newsletterId}`, "/admin/schedules"],
  );
}

export async function deleteNewsletterAction(
  _prev: NewsletterActionResult | null,
  formData: FormData,
): Promise<NewsletterActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const newsletterId = stringValue(formData, "newsletterId");
  if (!newsletterId) {
    return { ok: false, error: "Newsletter not found" };
  }

  return runNewsletterAction(async () => {
    await deleteNewsletter(getServerAppwrite(), newsletterId);
  });
}

export async function attachFeedToNewsletter(
  newsletterId: string,
  feedId: string,
): Promise<NewsletterActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: GENERIC_ERROR };
  }

  return runNewsletterAction(
    async () => {
      await attachFeed(getServerAppwrite(), newsletterId, feedId);
    },
    ["/admin/newsletters", `/admin/newsletters/${newsletterId}`, "/admin/schedules"],
  );
}

export async function detachFeedFromNewsletter(
  newsletterId: string,
  feedId: string,
): Promise<NewsletterActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: GENERIC_ERROR };
  }

  return runNewsletterAction(
    async () => {
      await detachFeed(getServerAppwrite(), newsletterId, feedId);
    },
    ["/admin/newsletters", `/admin/newsletters/${newsletterId}`, "/admin/schedules"],
  );
}

export async function startNewsletterRun(newsletterId: string): Promise<StartRunResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: GENERIC_ERROR };
  }

  try {
    const result = await enqueueNewsletterRun(getServerAppwrite(), newsletterId);
    if (result.ok) {
      revalidatePath("/admin/newsletters");
      return { ok: true, runId: result.runId };
    }
    return result;
  } catch (err) {
    console.error("[newsletters] startNewsletterRun", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
