import type { Client } from "node-appwrite";
import { getNewsletter } from "../newsletters/repository";
import { listAttachmentsForNewsletter } from "../newsletters/attachments";
import { createNewsletterConfig } from "../pipeline/types";
import type { NewsletterConfig } from "../pipeline/types";
import { NewsletterRepositoryError } from "../newsletters/types";
import type { Newsletter } from "../newsletters/types";
import { RUN_TRIGGERS } from "../schema/declarations";
import type { RunTrigger } from "./types";
import {
  createRun,
  findActiveRunForNewsletter,
  listActiveRunsForNewsletter,
  markFailed,
} from "./repository";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";

function resolveEnqueueTrigger(trigger: RunTrigger | undefined): RunTrigger {
  if (trigger !== undefined && (RUN_TRIGGERS as readonly string[]).includes(trigger)) {
    return trigger;
  }
  return "manual";
}

const ALREADY_IN_PROGRESS = "A run is already in progress for this newsletter";

/** Machine-readable code for busy / concurrent-start failures. */
export const ALREADY_IN_PROGRESS_CODE = "already_in_progress" as const;

export type StartRunResult =
  | { ok: true; runId: string }
  | { ok: false; error: string; code?: "already_in_progress" };

export type BuildPipelineConfigResult =
  | {
      ok: true;
      newsletter: Newsletter;
      feedUrls: string[];
      config: NewsletterConfig;
    }
  | { ok: false; error: string };

/**
 * Validate that a newsletter is runnable and assemble its pipeline config.
 *
 * Returns `{ ok: false, error }` with a stable operator-facing message when the
 * newsletter is missing, has no topics, or has no healthy (`ok`) feeds.
 * `NewsletterRepositoryError("appwrite")` (unexpected DB failures) propagates —
 * the caller is expected to catch it.
 *
 * Non-`ok` feed attachments are excluded (not fatal) as long as at least one
 * `ok` attachment remains. Does not mutate Stage-03 DB write rules.
 */
export async function buildPipelineConfigForNewsletter(
  client: Client,
  newsletterId: string,
  opts?: { requireOkFeeds?: boolean },
): Promise<BuildPipelineConfigResult> {
  const requireOkFeeds = opts?.requireOkFeeds ?? true;

  let newsletter: Newsletter;
  try {
    newsletter = await getNewsletter(client, newsletterId);
  } catch (err) {
    if (err instanceof NewsletterRepositoryError && err.code === "not_found") {
      return { ok: false, error: "Newsletter not found" };
    }
    throw err;
  }

  const trimmedTopics = newsletter.topics.map((t) => t.trim()).filter((t) => t.length > 0);
  if (trimmedTopics.length === 0) {
    return { ok: false, error: "Add at least one topic before generating" };
  }

  const attachments = await listAttachmentsForNewsletter(client, newsletterId);
  const feedUrls = attachments.filter((a) => a.feedStatus === "ok").map((a) => a.feedUrl);

  if (requireOkFeeds && feedUrls.length === 0) {
    return {
      ok: false,
      error: "Attach at least one healthy (ok) feed before generating",
    };
  }

  const config: NewsletterConfig =
    feedUrls.length > 0
      ? createNewsletterConfig({
          name: newsletter.name,
          topics: trimmedTopics,
          dislikedTopics: newsletter.dislikedTopics,
          audience: newsletter.audience,
          newsItems: newsletter.newsItems,
          dateRange: newsletter.dateRange,
          feeds: feedUrls,
        })
      : {
          name: newsletter.name,
          topics: trimmedTopics,
          dislikedTopics: newsletter.dislikedTopics,
          audience: newsletter.audience,
          newsItems: newsletter.newsItems,
          feeds: [],
          dateRange: newsletter.dateRange,
          interPhaseDelaySeconds: 3,
        };

  return { ok: true, newsletter, feedUrls, config };
}

/**
 * Start a newsletter generation run (manual by default, or scheduled when opts say so).
 *
 * Validates the newsletter is runnable, guards against a concurrent active run,
 * creates a pending run with `trigger` (`"manual"` | `"scheduled"`; defaults to
 * `"manual"`; invalid values are rejected and written as `"manual"`), then
 * re-checks for races. If the just-created run is not the sole or oldest active
 * run, newer runs are marked failed and an error is returned. Operator-facing
 * success only when the created run is the sole or oldest active run.
 *
 * Does not invoke the executor, wait for completion, or call `revalidatePath` —
 * those concerns belong to the web action. May throw
 * `NewsletterRepositoryError` / `RunRepositoryError` for unexpected DB failures.
 */
export async function enqueueNewsletterRun(
  client: Client,
  newsletterId: string,
  opts?: { trigger?: RunTrigger },
): Promise<StartRunResult> {
  const buildResult = await buildPipelineConfigForNewsletter(client, newsletterId);
  if (!buildResult.ok) {
    return { ok: false, error: buildResult.error };
  }

  const existing = await findActiveRunForNewsletter(client, newsletterId);
  if (existing) {
    return { ok: false, error: ALREADY_IN_PROGRESS, code: ALREADY_IN_PROGRESS_CODE };
  }

  const trigger = resolveEnqueueTrigger(opts?.trigger);
  const run = await createRun(client, {
    newsletterId,
    newsletterName: buildResult.newsletter.name,
    trigger,
  });

  const actives = await listActiveRunsForNewsletter(client, newsletterId);
  if (actives.length > 1) {
    for (let i = 1; i < actives.length; i++) {
      try {
        await markFailed(client, actives[i].$id, {
          failedPhase: "fetch",
          failureMessage: "Superseded by a concurrent start",
        });
      } catch (cleanupErr) {
        const errMsg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        console.error({
          phase: "start-race-cleanup",
          runId: actives[i].$id,
          message: sanitizeAppwriteMessageForLog(errMsg),
        });
      }
    }
  }

  if (actives.length > 0 && actives[0].$id !== run.$id) {
    return { ok: false, error: ALREADY_IN_PROGRESS, code: ALREADY_IN_PROGRESS_CODE };
  }

  return { ok: true, runId: run.$id };
}
