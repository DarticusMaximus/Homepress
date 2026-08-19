import { describe, it, expect, vi, beforeEach } from "vitest";
import { NewsletterRepositoryError } from "@newsletter/shared";
import type { Newsletter } from "@newsletter/shared";

const mocks = vi.hoisted(() => ({
  createNewsletter: vi.fn(),
  updateNewsletter: vi.fn(),
  updateNewsletterSchedule: vi.fn(),
  updateNewsletterDelivery: vi.fn(),
  resolveDeliveryFields: vi.fn(),
  actualResolveDeliveryFields: null as null | ((input: {
    recipientEmails: string[];
    autoEmail: boolean;
    autoRss: boolean;
  }) => {
    recipientEmails: string[];
    autoEmail: boolean;
    autoRss: boolean;
  }),
  getNewsletter: vi.fn(),
  setScheduleLastFiredAt: vi.fn(),
  deleteNewsletter: vi.fn(),
  attachFeed: vi.fn(),
  detachFeed: vi.fn(),
  enqueueNewsletterRun: vi.fn(),
  getServerAppwrite: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  revalidatePath: vi.fn(),
  client: { $id: "mock-client" },
  user: { $id: "user-1", email: "op@example.com" },
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  mocks.actualResolveDeliveryFields = actual.resolveDeliveryFields;
  return {
    ...actual,
    createNewsletter: mocks.createNewsletter,
    updateNewsletter: mocks.updateNewsletter,
    updateNewsletterSchedule: mocks.updateNewsletterSchedule,
    updateNewsletterDelivery: mocks.updateNewsletterDelivery,
    resolveDeliveryFields: mocks.resolveDeliveryFields,
    getNewsletter: mocks.getNewsletter,
    setScheduleLastFiredAt: mocks.setScheduleLastFiredAt,
    deleteNewsletter: mocks.deleteNewsletter,
    attachFeed: mocks.attachFeed,
    detachFeed: mocks.detachFeed,
    enqueueNewsletterRun: mocks.enqueueNewsletterRun,
    getServerAppwrite: mocks.getServerAppwrite,
  };
});

vi.mock("@/lib/auth/session", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));

import {
  attachFeedToNewsletter,
  createNewsletterAction,
  deleteNewsletterAction,
  detachFeedFromNewsletter,
  startNewsletterRun,
  updateNewsletterAction,
} from "@/app/(protected)/admin/newsletters/actions";

const MODELS = {
  taggerModel: "provider/tagger",
  scorerModel: "provider/scorer",
  drafterModel: "provider/drafter",
  embedderModel: "provider/embedder",
};

const PRIOR_LAST_FIRED = "2026-07-10T14:00:00.000Z";

function priorNewsletter(overrides: Partial<Newsletter> = {}): Newsletter {
  return {
    $id: "nl-1",
    name: "Daily AI",
    topics: ["ai"],
    dislikedTopics: [],
    audience: "engineers",
    newsItems: 16,
    lookback: 3,
    dateRange: "yesterday",
    taggerModel: "",
    scorerModel: "",
    drafterModel: "",
    embedderModel: "",
    drafterPrompt: "",
    scheduleEnabled: false,
    scheduleCron: "0 8 * * *",
    scheduleTimezone: "UTC",
    scheduleLastFiredAt: PRIOR_LAST_FIRED,
    recipientEmails: [],
    autoEmail: false,
    autoRss: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseCreateFormData(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("name", "Daily AI");
  fd.set("topicsJson", JSON.stringify(["ai"]));
  fd.set("dislikedTopicsJson", JSON.stringify([]));
  fd.set("audience", "engineers");
  fd.set("newsItems", "16");
  fd.set("lookback", "3");
  fd.set("dateRange", "yesterday");
  for (const [key, value] of Object.entries(extra)) {
    fd.set(key, value);
  }
  return fd;
}

function baseUpdateFormData(extra: Record<string, string> = {}): FormData {
  const fd = baseCreateFormData({
    recipientEmailsJson: "[]",
    ...extra,
  });
  fd.set("newsletterId", "nl-1");
  return fd;
}

beforeEach(() => {
  mocks.createNewsletter.mockReset();
  mocks.updateNewsletter.mockReset();
  mocks.updateNewsletterSchedule.mockReset();
  mocks.updateNewsletterDelivery.mockReset();
  mocks.resolveDeliveryFields.mockReset();
  mocks.getNewsletter.mockReset();
  mocks.setScheduleLastFiredAt.mockReset();
  mocks.deleteNewsletter.mockReset();
  mocks.attachFeed.mockReset();
  mocks.detachFeed.mockReset();
  mocks.enqueueNewsletterRun.mockReset();
  mocks.getServerAppwrite.mockReset();
  mocks.getAuthenticatedUser.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
  mocks.getAuthenticatedUser.mockResolvedValue(mocks.user);
  mocks.createNewsletter.mockResolvedValue({ $id: "nl-1" });
  mocks.updateNewsletter.mockResolvedValue({ $id: "nl-1" });
  mocks.updateNewsletterSchedule.mockResolvedValue({ $id: "nl-1" });
  mocks.updateNewsletterDelivery.mockResolvedValue({ $id: "nl-1" });
  mocks.resolveDeliveryFields.mockImplementation((input) =>
    mocks.actualResolveDeliveryFields!(input),
  );
  mocks.getNewsletter.mockResolvedValue(priorNewsletter());
  mocks.setScheduleLastFiredAt.mockResolvedValue(undefined);
  mocks.deleteNewsletter.mockResolvedValue(undefined);
  mocks.attachFeed.mockResolvedValue(undefined);
  mocks.detachFeed.mockResolvedValue(undefined);
  mocks.enqueueNewsletterRun.mockResolvedValue({ ok: true, runId: "run-1" });
});

const GENERIC_ERROR = "Something went wrong. Please try again.";

describe("newsletter mutators — session gates (S1)", () => {
  it("updateNewsletterAction returns GENERIC_ERROR and does not call Appwrite when unauthenticated", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const result = await updateNewsletterAction(null, baseUpdateFormData(MODELS));

    expect(result).toEqual({ ok: false, error: GENERIC_ERROR });
    expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
    expect(mocks.getNewsletter).not.toHaveBeenCalled();
    expect(mocks.updateNewsletterSchedule).not.toHaveBeenCalled();
    expect(mocks.updateNewsletterDelivery).not.toHaveBeenCalled();
    expect(mocks.updateNewsletter).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("createNewsletterAction returns GENERIC_ERROR and does not create when unauthenticated", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const result = await createNewsletterAction(null, baseCreateFormData());

    expect(result).toEqual({ ok: false, error: GENERIC_ERROR });
    expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
    expect(mocks.createNewsletter).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("deleteNewsletterAction returns GENERIC_ERROR and does not delete when unauthenticated", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const fd = new FormData();
    fd.set("newsletterId", "nl-1");

    const result = await deleteNewsletterAction(null, fd);

    expect(result).toEqual({ ok: false, error: GENERIC_ERROR });
    expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
    expect(mocks.deleteNewsletter).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("attachFeedToNewsletter returns GENERIC_ERROR and does not attach when unauthenticated", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const result = await attachFeedToNewsletter("nl-1", "feed-1");

    expect(result).toEqual({ ok: false, error: GENERIC_ERROR });
    expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
    expect(mocks.attachFeed).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("detachFeedFromNewsletter returns GENERIC_ERROR and does not detach when unauthenticated", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const result = await detachFeedFromNewsletter("nl-1", "feed-1");

    expect(result).toEqual({ ok: false, error: GENERIC_ERROR });
    expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
    expect(mocks.detachFeed).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("startNewsletterRun returns GENERIC_ERROR and does not enqueue when unauthenticated", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const result = await startNewsletterRun("nl-1");

    expect(result).toEqual({ ok: false, error: GENERIC_ERROR });
    expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
    expect(mocks.enqueueNewsletterRun).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("authenticated happy paths still mutate for create/delete/attach/detach/start", async () => {
    const createResult = await createNewsletterAction(null, baseCreateFormData());
    expect(createResult).toEqual({ ok: true, newsletterId: "nl-1" });
    expect(mocks.createNewsletter).toHaveBeenCalled();

    const deleteFd = new FormData();
    deleteFd.set("newsletterId", "nl-1");
    const deleteResult = await deleteNewsletterAction(null, deleteFd);
    expect(deleteResult).toEqual({ ok: true });
    expect(mocks.deleteNewsletter).toHaveBeenCalledWith(mocks.client, "nl-1");

    const attachResult = await attachFeedToNewsletter("nl-1", "feed-1");
    expect(attachResult).toEqual({ ok: true });
    expect(mocks.attachFeed).toHaveBeenCalledWith(mocks.client, "nl-1", "feed-1");

    const detachResult = await detachFeedFromNewsletter("nl-1", "feed-1");
    expect(detachResult).toEqual({ ok: true });
    expect(mocks.detachFeed).toHaveBeenCalledWith(mocks.client, "nl-1", "feed-1");

    const startResult = await startNewsletterRun("nl-1");
    expect(startResult).toEqual({ ok: true, runId: "run-1" });
    expect(mocks.enqueueNewsletterRun).toHaveBeenCalledWith(mocks.client, "nl-1");
  });
});

describe("createNewsletterAction — Basics-only + newsletterId", () => {
  it("returns newsletterId from createNewsletter.$id and revalidates list + edit path", async () => {
    mocks.createNewsletter.mockResolvedValue({ $id: "nl-created" });
    const formData = baseCreateFormData();

    const result = await createNewsletterAction(null, formData);

    expect(result).toEqual({ ok: true, newsletterId: "nl-created" });
    expect(mocks.getServerAppwrite).toHaveBeenCalled();
    expect(mocks.createNewsletter).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({
        name: "Daily AI",
        topics: ["ai"],
        dislikedTopics: [],
        audience: "engineers",
        newsItems: 16,
        lookback: 3,
        dateRange: "yesterday",
      }),
    );
    expect(mocks.createNewsletter.mock.calls[0][1]).not.toHaveProperty("taggerModel");
    expect(mocks.createNewsletter.mock.calls[0][1]).not.toHaveProperty("scorerModel");
    expect(mocks.createNewsletter.mock.calls[0][1]).not.toHaveProperty("drafterModel");
    expect(mocks.createNewsletter.mock.calls[0][1]).not.toHaveProperty("embedderModel");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/newsletters");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/newsletters/nl-created");
  });

  it("ignores model FormData keys on create (does not pass them to createNewsletter)", async () => {
    const formData = baseCreateFormData(MODELS);

    const result = await createNewsletterAction(null, formData);

    expect(result).toEqual({ ok: true, newsletterId: "nl-1" });
    const input = mocks.createNewsletter.mock.calls[0][1] as Record<string, unknown>;
    expect(input).not.toHaveProperty("taggerModel");
    expect(input).not.toHaveProperty("scorerModel");
    expect(input).not.toHaveProperty("drafterModel");
    expect(input).not.toHaveProperty("embedderModel");
  });

  it("returns repository validation error without revalidating", async () => {
    mocks.createNewsletter.mockRejectedValue(
      new NewsletterRepositoryError("validation", "Name is required"),
    );

    const result = await createNewsletterAction(null, baseCreateFormData({ name: "" }));

    expect(result).toEqual({
      ok: false,
      error: "Name is required",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateNewsletterAction — model overrides", () => {
  it("passes the four model FormData fields into updateNewsletter", async () => {
    const formData = baseUpdateFormData(MODELS);

    const result = await updateNewsletterAction(null, formData);

    expect(result).toEqual({ ok: true });
    expect(mocks.getServerAppwrite).toHaveBeenCalled();
    expect(mocks.updateNewsletter).toHaveBeenCalledWith(
      mocks.client,
      "nl-1",
      expect.objectContaining(MODELS),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/newsletters");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/newsletters/nl-1");
  });

  it("missing model FormData keys pass empty strings", async () => {
    const formData = baseUpdateFormData();

    const result = await updateNewsletterAction(null, formData);

    expect(result).toEqual({ ok: true });
    expect(mocks.updateNewsletter).toHaveBeenCalledWith(
      mocks.client,
      "nl-1",
      expect.objectContaining({
        taggerModel: "",
        scorerModel: "",
        drafterModel: "",
        embedderModel: "",
        drafterPrompt: "",
      }),
    );
  });

  it("returns repository validation error on a model field", async () => {
    mocks.updateNewsletter.mockRejectedValue(
      new NewsletterRepositoryError(
        "validation",
        "Invalid model ID for scorer. Use an OpenRouter-style id like provider/model (max 256 characters, no whitespace).",
      ),
    );

    const result = await updateNewsletterAction(
      null,
      baseUpdateFormData({ ...MODELS, scorerModel: "also-bad" }),
    );

    expect(result).toEqual({
      ok: false,
      error:
        "Invalid model ID for scorer. Use an OpenRouter-style id like provider/model (max 256 characters, no whitespace).",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateNewsletterAction — schedule", () => {
  it("calls updateNewsletterSchedule before updateNewsletter and revalidates /admin/schedules", async () => {
    const formData = baseUpdateFormData({
      ...MODELS,
      scheduleEnabled: "true",
      scheduleCron: "0 9 * * 1-5",
      scheduleTimezone: "America/New_York",
    });

    const result = await updateNewsletterAction(null, formData);

    expect(result).toEqual({ ok: true });
    expect(mocks.updateNewsletterSchedule).toHaveBeenCalledWith(
      mocks.client,
      "nl-1",
      expect.objectContaining({
        scheduleEnabled: true,
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "America/New_York",
      }),
    );
    expect(mocks.updateNewsletter).toHaveBeenCalled();
    expect(mocks.updateNewsletterSchedule.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateNewsletter.mock.invocationCallOrder[0],
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/newsletters");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/newsletters/nl-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/schedules");
  });

  it("returns schedule validation error and does not call updateNewsletter", async () => {
    mocks.updateNewsletterSchedule.mockRejectedValue(
      new NewsletterRepositoryError("validation", "Schedule cron is invalid"),
    );

    const result = await updateNewsletterAction(
      null,
      baseUpdateFormData({
        ...MODELS,
        scheduleEnabled: "true",
        scheduleCron: "not-a-cron",
        scheduleTimezone: "America/New_York",
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: "Schedule cron is invalid",
    });
    expect(mocks.updateNewsletterSchedule).toHaveBeenCalled();
    expect(mocks.updateNewsletter).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("omitted scheduleEnabled coerces to false for updateNewsletterSchedule", async () => {
    const formData = baseUpdateFormData({
      ...MODELS,
      scheduleCron: "",
      scheduleTimezone: "UTC",
    });

    const result = await updateNewsletterAction(null, formData);

    expect(result).toEqual({ ok: true });
    expect(mocks.updateNewsletterSchedule).toHaveBeenCalledWith(
      mocks.client,
      "nl-1",
      expect.objectContaining({
        scheduleEnabled: false,
        scheduleCron: "",
        scheduleTimezone: "UTC",
      }),
    );
  });

  it("rolls back schedule (and last-fired) when definition update fails after schedule success", async () => {
    mocks.updateNewsletter.mockRejectedValue(
      new NewsletterRepositoryError(
        "validation",
        "Invalid model ID for scorer. Use an OpenRouter-style id like provider/model (max 256 characters, no whitespace).",
      ),
    );

    const result = await updateNewsletterAction(
      null,
      baseUpdateFormData({
        ...MODELS,
        scorerModel: "also-bad",
        scheduleEnabled: "true",
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "America/New_York",
      }),
    );

    expect(result).toEqual({
      ok: false,
      error:
        "Invalid model ID for scorer. Use an OpenRouter-style id like provider/model (max 256 characters, no whitespace).",
    });
    expect(mocks.getNewsletter).toHaveBeenCalledWith(mocks.client, "nl-1");
    expect(mocks.updateNewsletterSchedule).toHaveBeenCalledTimes(2);
    expect(mocks.updateNewsletterSchedule).toHaveBeenNthCalledWith(
      1,
      mocks.client,
      "nl-1",
      expect.objectContaining({
        scheduleEnabled: true,
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "America/New_York",
      }),
    );
    expect(mocks.updateNewsletterSchedule).toHaveBeenNthCalledWith(
      2,
      mocks.client,
      "nl-1",
      expect.objectContaining({
        scheduleEnabled: false,
        scheduleCron: "0 8 * * *",
        scheduleTimezone: "UTC",
      }),
    );
    expect(mocks.setScheduleLastFiredAt).toHaveBeenCalledWith(
      mocks.client,
      "nl-1",
      PRIOR_LAST_FIRED,
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("reports partial failure and revalidates when schedule rollback fails", async () => {
    mocks.updateNewsletter.mockRejectedValue(
      new NewsletterRepositoryError("validation", "Invalid model ID for scorer."),
    );
    mocks.updateNewsletterSchedule
      .mockResolvedValueOnce({ $id: "nl-1" })
      .mockRejectedValueOnce(
        new NewsletterRepositoryError("appwrite", "DB write failed"),
      );

    const result = await updateNewsletterAction(
      null,
      baseUpdateFormData({
        ...MODELS,
        scheduleEnabled: "true",
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "America/New_York",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/schedule or delivery/i);
    expect(result.error).toMatch(/out of sync/i);
    expect(mocks.setScheduleLastFiredAt).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/newsletters");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/schedules");
  });
});

describe("updateNewsletterAction — delivery (cases 17–19)", () => {
  it("17. call order: resolveDeliveryFields before writes; schedule → delivery → definition", async () => {
    const formData = baseUpdateFormData({
      ...MODELS,
      scheduleEnabled: "true",
      scheduleCron: "0 9 * * 1-5",
      scheduleTimezone: "America/New_York",
      autoEmail: "true",
      autoRss: "true",
      recipientEmailsJson: JSON.stringify(["family@example.com"]),
    });

    const result = await updateNewsletterAction(null, formData);

    expect(result).toEqual({ ok: true });
    expect(mocks.resolveDeliveryFields).toHaveBeenCalledWith({
      recipientEmails: ["family@example.com"],
      autoEmail: true,
      autoRss: true,
    });
    expect(mocks.updateNewsletterSchedule).toHaveBeenCalledTimes(1);
    expect(mocks.updateNewsletterDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.updateNewsletter).toHaveBeenCalledTimes(1);

    const resolveOrder = mocks.resolveDeliveryFields.mock.invocationCallOrder[0];
    const scheduleOrder = mocks.updateNewsletterSchedule.mock.invocationCallOrder[0];
    const deliveryOrder = mocks.updateNewsletterDelivery.mock.invocationCallOrder[0];
    const definitionOrder = mocks.updateNewsletter.mock.invocationCallOrder[0];

    expect(resolveOrder).toBeLessThan(scheduleOrder);
    expect(scheduleOrder).toBeLessThan(deliveryOrder);
    expect(deliveryOrder).toBeLessThan(definitionOrder);

    expect(mocks.updateNewsletterDelivery).toHaveBeenCalledWith(
      mocks.client,
      "nl-1",
      expect.objectContaining({
        recipientEmails: ["family@example.com"],
        autoEmail: true,
        autoRss: true,
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/newsletters");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/newsletters/nl-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/schedules");
  });

  it("18. invalid delivery before writes: no schedule/delivery/definition calls", async () => {
    const result = await updateNewsletterAction(
      null,
      baseUpdateFormData({
        ...MODELS,
        scheduleEnabled: "true",
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "America/New_York",
        autoEmail: "true",
        recipientEmailsJson: JSON.stringify(["not-an-email"]),
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: "Invalid recipient email",
    });
    expect(mocks.resolveDeliveryFields).toHaveBeenCalled();
    expect(mocks.getNewsletter).not.toHaveBeenCalled();
    expect(mocks.updateNewsletterSchedule).not.toHaveBeenCalled();
    expect(mocks.updateNewsletterDelivery).not.toHaveBeenCalled();
    expect(mocks.updateNewsletter).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("C2. rolls back schedule (and last-fired) when delivery fails after schedule success", async () => {
    mocks.updateNewsletterDelivery.mockRejectedValue(
      new NewsletterRepositoryError("appwrite", "Delivery write failed"),
    );

    const result = await updateNewsletterAction(
      null,
      baseUpdateFormData({
        ...MODELS,
        scheduleEnabled: "true",
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "America/New_York",
        autoEmail: "true",
        recipientEmailsJson: JSON.stringify(["family@example.com"]),
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: "Delivery write failed",
    });
    expect(mocks.getNewsletter).toHaveBeenCalledWith(mocks.client, "nl-1");
    expect(mocks.updateNewsletterSchedule).toHaveBeenCalledTimes(2);
    expect(mocks.updateNewsletterSchedule).toHaveBeenNthCalledWith(
      1,
      mocks.client,
      "nl-1",
      expect.objectContaining({
        scheduleEnabled: true,
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "America/New_York",
      }),
    );
    expect(mocks.updateNewsletterSchedule).toHaveBeenNthCalledWith(
      2,
      mocks.client,
      "nl-1",
      expect.objectContaining({
        scheduleEnabled: false,
        scheduleCron: "0 8 * * *",
        scheduleTimezone: "UTC",
      }),
    );
    expect(mocks.setScheduleLastFiredAt).toHaveBeenCalledWith(
      mocks.client,
      "nl-1",
      PRIOR_LAST_FIRED,
    );
    expect(mocks.updateNewsletterDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.updateNewsletter).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("19. dual rollback on definition failure restores prior schedule + delivery", async () => {
    mocks.getNewsletter.mockResolvedValue(
      priorNewsletter({
        recipientEmails: ["old@example.com"],
        autoEmail: true,
        autoRss: false,
      }),
    );
    mocks.updateNewsletter.mockRejectedValue(
      new NewsletterRepositoryError(
        "validation",
        "Invalid model ID for scorer. Use an OpenRouter-style id like provider/model (max 256 characters, no whitespace).",
      ),
    );

    const result = await updateNewsletterAction(
      null,
      baseUpdateFormData({
        ...MODELS,
        scorerModel: "also-bad",
        scheduleEnabled: "true",
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "America/New_York",
        autoEmail: "true",
        autoRss: "true",
        recipientEmailsJson: JSON.stringify(["new@example.com"]),
      }),
    );

    expect(result).toEqual({
      ok: false,
      error:
        "Invalid model ID for scorer. Use an OpenRouter-style id like provider/model (max 256 characters, no whitespace).",
    });

    expect(mocks.updateNewsletterSchedule).toHaveBeenCalledTimes(2);
    expect(mocks.updateNewsletterSchedule).toHaveBeenNthCalledWith(
      1,
      mocks.client,
      "nl-1",
      expect.objectContaining({
        scheduleEnabled: true,
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "America/New_York",
      }),
    );
    expect(mocks.updateNewsletterSchedule).toHaveBeenNthCalledWith(
      2,
      mocks.client,
      "nl-1",
      expect.objectContaining({
        scheduleEnabled: false,
        scheduleCron: "0 8 * * *",
        scheduleTimezone: "UTC",
      }),
    );
    expect(mocks.setScheduleLastFiredAt).toHaveBeenCalledWith(
      mocks.client,
      "nl-1",
      PRIOR_LAST_FIRED,
    );

    expect(mocks.updateNewsletterDelivery).toHaveBeenCalledTimes(2);
    expect(mocks.updateNewsletterDelivery).toHaveBeenNthCalledWith(
      1,
      mocks.client,
      "nl-1",
      expect.objectContaining({
        recipientEmails: ["new@example.com"],
        autoEmail: true,
        autoRss: true,
      }),
    );
    expect(mocks.updateNewsletterDelivery).toHaveBeenNthCalledWith(
      2,
      mocks.client,
      "nl-1",
      expect.objectContaining({
        recipientEmails: ["old@example.com"],
        autoEmail: true,
        autoRss: false,
      }),
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("19b. partial failure when dual rollback itself fails", async () => {
    mocks.updateNewsletter.mockRejectedValue(
      new NewsletterRepositoryError("validation", "Invalid model ID for scorer."),
    );
    mocks.updateNewsletterSchedule
      .mockResolvedValueOnce({ $id: "nl-1" })
      .mockRejectedValueOnce(
        new NewsletterRepositoryError("appwrite", "DB write failed"),
      );

    const result = await updateNewsletterAction(
      null,
      baseUpdateFormData({
        ...MODELS,
        scheduleEnabled: "true",
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "America/New_York",
        recipientEmailsJson: JSON.stringify(["family@example.com"]),
        autoEmail: "true",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/schedule or delivery/i);
    expect(result.error).toMatch(/out of sync/i);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/newsletters");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/schedules");
  });
});
