import { describe, it, expect, vi, beforeEach } from "vitest";
import { NewsletterRepositoryError } from "@newsletter/shared";

const mocks = vi.hoisted(() => ({
  updateNewsletterSchedule: vi.fn(),
  getServerAppwrite: vi.fn(),
  revalidatePath: vi.fn(),
  client: { $id: "mock-client" },
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    updateNewsletterSchedule: mocks.updateNewsletterSchedule,
    getServerAppwrite: mocks.getServerAppwrite,
  };
});

import { updateNewsletterScheduleAction } from "@/app/(protected)/schedules/actions";

function scheduleFormData(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("newsletterId", "nl-1");
  fd.set("scheduleEnabled", "true");
  fd.set("scheduleCron", "0 9 * * 1-5");
  fd.set("scheduleTimezone", "America/New_York");
  for (const [key, value] of Object.entries(extra)) {
    fd.set(key, value);
  }
  return fd;
}

beforeEach(() => {
  mocks.updateNewsletterSchedule.mockReset();
  mocks.getServerAppwrite.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
  mocks.updateNewsletterSchedule.mockResolvedValue({ $id: "nl-1" });
});

describe("updateNewsletterScheduleAction", () => {
  it("success: valid enabled cron+TZ calls updateNewsletterSchedule with coerced fields", async () => {
    const result = await updateNewsletterScheduleAction(null, scheduleFormData());

    expect(result).toEqual({ ok: true });
    expect(mocks.getServerAppwrite).toHaveBeenCalled();
    expect(mocks.updateNewsletterSchedule).toHaveBeenCalledWith(
      mocks.client,
      "nl-1",
      expect.objectContaining({
        scheduleEnabled: true,
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "America/New_York",
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/schedules");
  });

  it("validation: NewsletterRepositoryError validation → ok:false with message", async () => {
    mocks.updateNewsletterSchedule.mockRejectedValue(
      new NewsletterRepositoryError("validation", "Schedule cron is invalid"),
    );

    const result = await updateNewsletterScheduleAction(
      null,
      scheduleFormData({ scheduleCron: "not-a-cron" }),
    );

    expect(result).toEqual({
      ok: false,
      error: "Schedule cron is invalid",
    });
    expect(result).not.toEqual({ ok: true });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("not_found: NewsletterRepositoryError not_found → safe error", async () => {
    mocks.updateNewsletterSchedule.mockRejectedValue(
      new NewsletterRepositoryError("not_found", "Newsletter not found"),
    );

    const result = await updateNewsletterScheduleAction(null, scheduleFormData());

    expect(result).toEqual({
      ok: false,
      error: "Newsletter not found",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
