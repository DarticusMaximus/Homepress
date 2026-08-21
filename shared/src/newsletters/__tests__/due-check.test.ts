import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Client } from "node-appwrite";

import { processDueSchedules, resetConsumedScheduleFiresForTests } from "../due-check";
import type { Newsletter } from "../types";
import type { StartRunResult } from "../../runs/start";
import { NEWSLETTER_LIST_LIMIT, type SetScheduleLastFiredAtOpts } from "../repository";
import type { Run } from "../../runs/types";
import type { listRuns as listRunsFn } from "../../runs/repository";

const WEEKDAY_CRON = "0 9 * * 1-5";
const NY_TZ = "America/New_York";
/** Monday 2025-01-06 09:00 America/New_York (EST) → 14:00 UTC. */
const MONDAY_FIRE_ISO = "2025-01-06T14:00:00.000Z";
const MONDAY_AFTER_FIRE = new Date("2025-01-06T15:00:00.000Z");
const STAMP_COMPARE: SetScheduleLastFiredAtOpts = { compare: true };

const ALREADY_IN_PROGRESS_MSG = "A run is already in progress for this newsletter";

const client = {} as Client;

/** Feature 05 StartRunResult shape — may precede production type until Task 2. */
type EnqueueResult =
  | { ok: true; runId: string }
  | { ok: false; error: string; code?: "already_in_progress" };

function makeNewsletter(overrides: Partial<Newsletter> & Pick<Newsletter, "$id">): Newsletter {
  return {
    $id: overrides.$id,
    name: overrides.name ?? "Test Newsletter",
    topics: overrides.topics ?? ["AI"],
    dislikedTopics: overrides.dislikedTopics ?? [],
    audience: overrides.audience ?? "",
    newsItems: overrides.newsItems ?? 16,
    dateRange: overrides.dateRange ?? "yesterday",
    lookback: overrides.lookback ?? 3,
    taggerModel: overrides.taggerModel ?? "",
    scorerModel: overrides.scorerModel ?? "",
    drafterModel: overrides.drafterModel ?? "",
    embedderModel: overrides.embedderModel ?? "",
    titleDekModel: overrides.titleDekModel ?? "",
    drafterPrompt: overrides.drafterPrompt ?? "",
    scheduleEnabled: overrides.scheduleEnabled ?? false,
    scheduleCron: overrides.scheduleCron ?? "",
    scheduleTimezone: overrides.scheduleTimezone ?? "UTC",
    scheduleLastFiredAt:
      "scheduleLastFiredAt" in overrides ? (overrides.scheduleLastFiredAt ?? null) : null,
    recipientEmails: overrides.recipientEmails ?? [],
    autoEmail: overrides.autoEmail ?? false,
    autoRss: overrides.autoRss ?? false,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

function dueNewsletter(id: string): Newsletter {
  return makeNewsletter({
    $id: id,
    scheduleEnabled: true,
    scheduleCron: WEEKDAY_CRON,
    scheduleTimezone: NY_TZ,
    scheduleLastFiredAt: null,
  } as Partial<Newsletter> & Pick<Newsletter, "$id">);
}

function makeScheduledRun(
  overrides: Partial<Run> & Pick<Run, "$id" | "newsletterId">,
): Run {
  return {
    $id: overrides.$id,
    newsletterId: overrides.newsletterId,
    newsletterName: overrides.newsletterName ?? "Test Newsletter",
    status: overrides.status ?? "completed",
    trigger: overrides.trigger ?? "scheduled",
    currentPhase: overrides.currentPhase ?? "",
    completedPhase: overrides.completedPhase ?? "",
    failedPhase: overrides.failedPhase ?? "",
    failureMessage: overrides.failureMessage ?? "",
    startedAt: overrides.startedAt ?? MONDAY_FIRE_ISO,
    endedAt: overrides.endedAt ?? "2025-01-06T15:30:00.000Z",
    topicSummary: overrides.topicSummary ?? "",
    failedFeeds: overrides.failedFeeds ?? "",
    suppressSummary: overrides.suppressSummary ?? "",
    checkpointFetchId: overrides.checkpointFetchId ?? "",
    checkpointScrapeId: overrides.checkpointScrapeId ?? "",
    checkpointTagId: overrides.checkpointTagId ?? "",
    checkpointScoreId: overrides.checkpointScoreId ?? "",
    checkpointSelectionId: overrides.checkpointSelectionId ?? "",
    checkpointDraftId: overrides.checkpointDraftId ?? "",
    emailDeliveryStatus: overrides.emailDeliveryStatus ?? "none",
    emailDeliveryAt: overrides.emailDeliveryAt ?? null,
    emailDeliveryError: overrides.emailDeliveryError ?? "",
    rssDeliveryStatus: overrides.rssDeliveryStatus ?? "none",
    rssDeliveryAt: overrides.rssDeliveryAt ?? null,
    rssDeliveryError: overrides.rssDeliveryError ?? "",
    issueTitle: overrides.issueTitle ?? "",
    issueDek: overrides.issueDek ?? "",
  };
}

describe("processDueSchedules", () => {
  let listNewsletters: Mock<(client: Client) => Promise<Newsletter[]>>;
  let enqueue: Mock<
    (
      client: Client,
      newsletterId: string,
      opts?: { trigger?: string },
    ) => Promise<EnqueueResult>
  >;
  let setLastFired: Mock<
    (
      client: Client,
      id: string,
      iso: string,
      opts?: SetScheduleLastFiredAtOpts,
    ) => Promise<void>
  >;
  let listRuns: Mock<typeof listRunsFn>;

  beforeEach(() => {
    resetConsumedScheduleFiresForTests();
    listNewsletters = vi.fn();
    enqueue = vi.fn();
    setLastFired = vi.fn();
    // Default: no prior scheduled run — first fire is free to enqueue.
    listRuns = vi.fn().mockResolvedValue([]);
  });

  const asEnqueue = (fn: typeof enqueue) =>
    fn as unknown as (
      client: Client,
      newsletterId: string,
      opts?: { trigger?: string },
    ) => Promise<StartRunResult>;
  // Feature 05 success path + Feature 06 Task 1 case 7 — scheduled trigger opts.
  it("enqueues a due newsletter and stamps previous-fire ISO on success", async () => {
    listNewsletters.mockResolvedValue([dueNewsletter("nl-1")]);
    enqueue.mockResolvedValue({ ok: true, runId: "run-1" });
    setLastFired.mockResolvedValue(undefined);

    const result = await processDueSchedules(client, {
      now: MONDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(client, "nl-1", { trigger: "scheduled" });
    expect(setLastFired).toHaveBeenCalledTimes(1);
    expect(setLastFired).toHaveBeenCalledWith(client, "nl-1", MONDAY_FIRE_ISO, STAMP_COMPARE);
    expect(result.enqueued).toBe(1);
    expect(result.skipped).toBe(0);
  });

  // Feature 06 Task 1 case 8 — no catch-up backlog after multi-slot downtime.
  it("enqueues once after multi-slot downtime with scheduled trigger and latest previous-fire stamp", async () => {
    // Stamped Friday 2025-01-03 09:00 EST; now Wednesday after weekend —
    // ≥2 weekday cron boundaries missed; only latest previous fire (Wed) is due.
    const FRIDAY_FIRE_ISO = "2025-01-03T14:00:00.000Z";
    const WEDNESDAY_AFTER_FIRE = new Date("2025-01-08T15:00:00.000Z");
    const WEDNESDAY_FIRE_ISO = "2025-01-08T14:00:00.000Z";

    listNewsletters.mockResolvedValue([
      makeNewsletter({
        $id: "nl-catchup",
        scheduleEnabled: true,
        scheduleCron: WEEKDAY_CRON,
        scheduleTimezone: NY_TZ,
        scheduleLastFiredAt: FRIDAY_FIRE_ISO,
      } as Partial<Newsletter> & Pick<Newsletter, "$id">),
    ]);
    enqueue.mockResolvedValue({ ok: true, runId: "run-catchup" });
    setLastFired.mockResolvedValue(undefined);

    const result = await processDueSchedules(client, {
      now: WEDNESDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(client, "nl-catchup", { trigger: "scheduled" });
    expect(setLastFired).toHaveBeenCalledTimes(1);
    expect(setLastFired).toHaveBeenCalledWith(
      client,
      "nl-catchup",
      WEDNESDAY_FIRE_ISO,
      STAMP_COMPARE,
    );
    expect(result.due).toBe(1);
    expect(result.enqueued).toBe(1);
  });

  it("enqueues and stamps EVERY due newsletter on one tick (multi-due)", async () => {
    listNewsletters.mockResolvedValue([dueNewsletter("nl-a"), dueNewsletter("nl-b")]);
    enqueue.mockResolvedValueOnce({ ok: true, runId: "run-a" });
    enqueue.mockResolvedValueOnce({ ok: true, runId: "run-b" });
    setLastFired.mockResolvedValue(undefined);

    const result = await processDueSchedules(client, {
      now: MONDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
    });

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenNthCalledWith(1, client, "nl-a", { trigger: "scheduled" });
    expect(enqueue).toHaveBeenNthCalledWith(2, client, "nl-b", { trigger: "scheduled" });

    expect(setLastFired).toHaveBeenCalledTimes(2);
    expect(setLastFired).toHaveBeenCalledWith(client, "nl-a", MONDAY_FIRE_ISO, STAMP_COMPARE);
    expect(setLastFired).toHaveBeenCalledWith(client, "nl-b", MONDAY_FIRE_ISO, STAMP_COMPARE);
    expect(result.enqueued).toBe(2);
  });

  // Case 4: stamp on already_in_progress
  it("stamps previous-fire and counts skippedActive when enqueue returns already_in_progress", async () => {
    listNewsletters.mockResolvedValue([dueNewsletter("nl-busy")]);
    enqueue.mockResolvedValue({
      ok: false,
      error: ALREADY_IN_PROGRESS_MSG,
      code: "already_in_progress",
    });
    setLastFired.mockResolvedValue(undefined);

    const result = await processDueSchedules(client, {
      now: MONDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(client, "nl-busy", { trigger: "scheduled" });
    expect(setLastFired).toHaveBeenCalledTimes(1);
    expect(setLastFired).toHaveBeenCalledWith(client, "nl-busy", MONDAY_FIRE_ISO, STAMP_COMPARE);
    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.skippedActive).toBe(1);
  });

  // Case 5 (stamp-first): non-busy !ok still consumes the claimed slot (no catch-up).
  it("stamp-first claims slot then skips on non-busy enqueue failure", async () => {
    listNewsletters.mockResolvedValue([dueNewsletter("nl-fail")]);
    enqueue.mockResolvedValue({
      ok: false,
      error: "Attach at least one healthy (ok) feed before generating",
    });
    setLastFired.mockResolvedValue(undefined);

    const result = await processDueSchedules(client, {
      now: MONDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
    });

    expect(setLastFired).toHaveBeenCalledTimes(1);
    expect(setLastFired).toHaveBeenCalledWith(client, "nl-fail", MONDAY_FIRE_ISO, STAMP_COMPARE);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skippedActive).toBe(0);
  });

  // Case 6: mixed same-tick — A busy + B ok (B-while-A proof)
  it("stamps already_in_progress for A and still enqueues+stamps B on the same tick", async () => {
    listNewsletters.mockResolvedValue([dueNewsletter("nl-a"), dueNewsletter("nl-b")]);
    enqueue.mockImplementation(async (_client, newsletterId) => {
      if (newsletterId === "nl-a") {
        return {
          ok: false,
          error: ALREADY_IN_PROGRESS_MSG,
          code: "already_in_progress",
        };
      }
      return { ok: true, runId: "run-b" };
    });
    setLastFired.mockResolvedValue(undefined);

    const result = await processDueSchedules(client, {
      now: MONDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
    });

    // Both ids must be attempted — no global "anything active → stop"
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(client, "nl-a", { trigger: "scheduled" });
    expect(enqueue).toHaveBeenCalledWith(client, "nl-b", { trigger: "scheduled" });

    expect(setLastFired).toHaveBeenCalledTimes(2);
    expect(setLastFired).toHaveBeenCalledWith(client, "nl-a", MONDAY_FIRE_ISO, STAMP_COMPARE);
    expect(setLastFired).toHaveBeenCalledWith(client, "nl-b", MONDAY_FIRE_ISO, STAMP_COMPARE);

    expect(result.enqueued).toBe(1);
    expect(result.skippedActive).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("still processes other due newsletters after a non-busy enqueue failure", async () => {
    listNewsletters.mockResolvedValue([dueNewsletter("nl-fail"), dueNewsletter("nl-ok")]);
    enqueue.mockResolvedValueOnce({
      ok: false,
      error: "Attach at least one healthy (ok) feed before generating",
    });
    enqueue.mockResolvedValueOnce({ ok: true, runId: "run-ok" });
    setLastFired.mockResolvedValue(undefined);

    const result = await processDueSchedules(client, {
      now: MONDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
    });

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(client, "nl-fail", { trigger: "scheduled" });
    expect(enqueue).toHaveBeenCalledWith(client, "nl-ok", { trigger: "scheduled" });

    // Stamp-first claims both slots before enqueue outcomes.
    expect(setLastFired).toHaveBeenCalledTimes(2);
    expect(setLastFired).toHaveBeenCalledWith(client, "nl-fail", MONDAY_FIRE_ISO, STAMP_COMPARE);
    expect(setLastFired).toHaveBeenCalledWith(client, "nl-ok", MONDAY_FIRE_ISO, STAMP_COMPARE);
    expect(result.enqueued).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("skips disabled and already-stamped newsletters without enqueueing", async () => {
    listNewsletters.mockResolvedValue([
      makeNewsletter({
        $id: "nl-disabled",
        scheduleEnabled: false,
        scheduleCron: WEEKDAY_CRON,
        scheduleTimezone: NY_TZ,
        scheduleLastFiredAt: null,
      } as Partial<Newsletter> & Pick<Newsletter, "$id">),
      makeNewsletter({
        $id: "nl-stamped",
        scheduleEnabled: true,
        scheduleCron: WEEKDAY_CRON,
        scheduleTimezone: NY_TZ,
        scheduleLastFiredAt: MONDAY_FIRE_ISO,
      } as Partial<Newsletter> & Pick<Newsletter, "$id">),
    ]);

    const result = await processDueSchedules(client, {
      now: MONDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(setLastFired).not.toHaveBeenCalled();
    expect(result.due).toBe(0);
    expect(result.enqueued).toBe(0);
  });

  // C1: stamp-fail-then-retry — transient stamp-first claim failure retries, then enqueues once.
  it("retries stamp after transient failure and enqueues only once (stamp-fail-then-retry)", async () => {
    listNewsletters.mockResolvedValue([dueNewsletter("nl-stamp-retry")]);
    enqueue.mockResolvedValue({ ok: true, runId: "run-stamp-retry" });
    setLastFired
      .mockRejectedValueOnce(new Error("transient stamp failure"))
      .mockResolvedValueOnce(undefined);

    const sleep = vi.fn(async () => undefined);

    const result = await processDueSchedules(client, {
      now: MONDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
      sleep,
      stampMaxAttempts: 3,
    });

    expect(setLastFired).toHaveBeenCalledTimes(2);
    expect(setLastFired).toHaveBeenCalledWith(
      client,
      "nl-stamp-retry",
      MONDAY_FIRE_ISO,
      STAMP_COMPARE,
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(setLastFired.mock.invocationCallOrder[0]!).toBeLessThan(
      enqueue.mock.invocationCallOrder[0]!,
    );
    expect(sleep).toHaveBeenCalled();
    expect(result.enqueued).toBe(1);
    expect(result.errors).toBe(0);
  });

  // C1: hard stamp-first failure never enqueues; restart cannot invent a fire.
  it("does not enqueue when stamp claim fails permanently (stamp-fail-no-enqueue)", async () => {
    listNewsletters.mockResolvedValue([dueNewsletter("nl-stamp-hard")]);
    enqueue.mockResolvedValue({ ok: true, runId: "run-stamp-hard" });
    setLastFired.mockRejectedValue(new Error("hard stamp failure"));

    const sleep = vi.fn(async () => undefined);
    const sharedOpts = {
      now: MONDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
      sleep,
      stampMaxAttempts: 2,
    };

    const first = await processDueSchedules(client, sharedOpts);
    expect(enqueue).not.toHaveBeenCalled();
    expect(setLastFired.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(first.enqueued).toBe(0);
    expect(first.errors).toBe(1);

    // Worker restart: empty ledger; stamp still null — still must not enqueue without a claim.
    resetConsumedScheduleFiresForTests();
    enqueue.mockResolvedValue({ ok: true, runId: "run-stamp-hard-2" });

    const second = await processDueSchedules(client, sharedOpts);

    expect(enqueue).not.toHaveBeenCalled();
    expect(second.enqueued).toBe(0);
    expect(second.errors).toBe(1);
  });

  // C1 Hole 1: busy-skip creates no run; stamp-first makes the slot durable across restart.
  it("busy-skip stamp-first survives ledger wipe without second enqueue", async () => {
    listNewsletters.mockResolvedValue([dueNewsletter("nl-busy-restart")]);
    enqueue.mockResolvedValue({
      ok: false,
      error: ALREADY_IN_PROGRESS_MSG,
      code: "already_in_progress",
    });
    setLastFired.mockResolvedValue(undefined);

    const sleep = vi.fn(async () => undefined);
    const sharedOpts = {
      now: MONDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
      sleep,
    };

    const first = await processDueSchedules(client, sharedOpts);
    expect(setLastFired).toHaveBeenCalledWith(
      client,
      "nl-busy-restart",
      MONDAY_FIRE_ISO,
      STAMP_COMPARE,
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(first.skippedActive).toBe(1);
    expect(first.enqueued).toBe(0);

    // Restart: in-process ledger gone; manual run finished; no scheduled run row.
    // Primary durability: Appwrite stamp from stamp-first claim (reflected in next list).
    resetConsumedScheduleFiresForTests();
    listNewsletters.mockResolvedValue([
      makeNewsletter({
        $id: "nl-busy-restart",
        scheduleEnabled: true,
        scheduleCron: WEEKDAY_CRON,
        scheduleTimezone: NY_TZ,
        scheduleLastFiredAt: MONDAY_FIRE_ISO,
      } as Partial<Newsletter> & Pick<Newsletter, "$id">),
    ]);
    listRuns.mockResolvedValue([]);
    enqueue.mockResolvedValue({ ok: true, runId: "run-should-not" });

    const second = await processDueSchedules(client, sharedOpts);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(second.due).toBe(0);
    expect(second.enqueued).toBe(0);
  });

  // C1 secondary: stamp null but scheduled run covers previousFire → stamp-only, no enqueue.
  it("does not re-enqueue when stamp is null but scheduled run covers previousFire", async () => {
    listNewsletters.mockResolvedValue([dueNewsletter("nl-reconcile")]);
    listRuns.mockResolvedValue([
      makeScheduledRun({
        $id: "run-reconcile",
        newsletterId: "nl-reconcile",
        status: "completed",
        startedAt: MONDAY_FIRE_ISO,
      }),
    ]);
    setLastFired.mockRejectedValue(new Error("stamp still failing"));
    enqueue.mockResolvedValue({ ok: true, runId: "run-should-not" });

    const sleep = vi.fn(async () => undefined);

    const result = await processDueSchedules(client, {
      now: MONDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
      sleep,
      stampMaxAttempts: 2,
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(result.enqueued).toBe(0);
    expect(setLastFired.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.errors).toBeGreaterThanOrEqual(1);
  });

  // C1 Hole 2: listRuns throw must fail-closed — never second-enqueue a consumed slot.
  it("does not enqueue when listRuns throws for an already-consumed slot (fail-closed)", async () => {
    listNewsletters.mockResolvedValue([dueNewsletter("nl-list-fail")]);
    // Stamp still null; prior scheduled enqueue exists, but reconcile lookup fails.
    listRuns.mockRejectedValue(new Error("Appwrite listRuns unavailable"));
    enqueue.mockResolvedValue({ ok: true, runId: "run-should-not" });
    setLastFired.mockResolvedValue(undefined);

    const result = await processDueSchedules(client, {
      now: MONDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(setLastFired).not.toHaveBeenCalled();
    expect(result.enqueued).toBe(0);
    expect(result.errors).toBe(1);
  });

  // C2: >NEWSLETTER_LIST_LIMIT fixtures; only the later-page newsletter is due → enqueue once.
  // Fails if processDueSchedules only scans the first page (silently starving schedules).
  it("enqueues a due newsletter beyond the first list page (C2 multi-page)", async () => {
    const fillers = Array.from({ length: NEWSLETTER_LIST_LIMIT }, (_, i) =>
      makeNewsletter({
        $id: `nl-fill-${i}`,
        scheduleEnabled: false,
        scheduleCron: WEEKDAY_CRON,
        scheduleTimezone: NY_TZ,
        scheduleLastFiredAt: null,
      } as Partial<Newsletter> & Pick<Newsletter, "$id">),
    );
    const dueLater = dueNewsletter("nl-due-page-2");
    listNewsletters.mockResolvedValue([...fillers, dueLater]);
    enqueue.mockResolvedValue({ ok: true, runId: "run-page-2" });
    setLastFired.mockResolvedValue(undefined);

    const result = await processDueSchedules(client, {
      now: MONDAY_AFTER_FIRE,
      listNewsletters,
      enqueue: asEnqueue(enqueue),
      setLastFired,
      listRuns,
    });

    expect(result.considered).toBe(NEWSLETTER_LIST_LIMIT + 1);
    expect(result.due).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(client, "nl-due-page-2", { trigger: "scheduled" });
    expect(setLastFired).toHaveBeenCalledWith(
      client,
      "nl-due-page-2",
      MONDAY_FIRE_ISO,
      STAMP_COMPARE,
    );
    expect(result.enqueued).toBe(1);
  });
});
