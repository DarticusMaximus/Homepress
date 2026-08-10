"use server";

import { revalidatePath } from "next/cache";
import {
  createFeed,
  deleteFeed,
  FeedRepositoryError,
  getFeed,
  getServerAppwrite,
  qualifyFeed,
  recordFeedTestResult,
  updateFeed,
} from "@newsletter/shared";

export type FeedActionResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

async function runFeedAction(fn: () => Promise<void>): Promise<FeedActionResult> {
  try {
    await fn();
    revalidatePath("/feeds");
    return { ok: true };
  } catch (err) {
    if (err instanceof FeedRepositoryError) {
      return { ok: false, error: err.message };
    }
    console.error("[feeds]", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function createFeedAction(
  _prev: FeedActionResult | null,
  formData: FormData,
): Promise<FeedActionResult> {
  const name = formData.get("name");
  const url = formData.get("url");
  const notes = formData.get("notes");

  return runFeedAction(async () => {
    await createFeed(getServerAppwrite(), {
      name: typeof name === "string" ? name : "",
      url: typeof url === "string" ? url : "",
      notes: typeof notes === "string" ? notes : undefined,
    });
  });
}

export async function updateFeedAction(
  _prev: FeedActionResult | null,
  formData: FormData,
): Promise<FeedActionResult> {
  const feedId = formData.get("feedId");
  const name = formData.get("name");
  const url = formData.get("url");
  const notes = formData.get("notes");

  if (typeof feedId !== "string" || !feedId) {
    return { ok: false, error: "Feed not found" };
  }

  return runFeedAction(async () => {
    await updateFeed(getServerAppwrite(), feedId, {
      name: typeof name === "string" ? name : undefined,
      url: typeof url === "string" ? url : undefined,
      notes: typeof notes === "string" ? notes : undefined,
    });
  });
}

export async function deleteFeedAction(
  _prev: FeedActionResult | null,
  formData: FormData,
): Promise<FeedActionResult> {
  const feedId = formData.get("feedId");

  if (typeof feedId !== "string" || !feedId) {
    return { ok: false, error: "Feed not found" };
  }

  return runFeedAction(async () => {
    await deleteFeed(getServerAppwrite(), feedId);
  });
}

export async function testFeed(feedId: string): Promise<FeedActionResult> {
  try {
    const client = getServerAppwrite();
    const feed = await getFeed(client, feedId);
    const result = await qualifyFeed(feed.url);

    if (result.ok) {
      await recordFeedTestResult(client, feedId, { status: "ok" });
      revalidatePath("/feeds");
      return { ok: true };
    }

    await recordFeedTestResult(client, feedId, {
      status: "failed",
      error: result.reason,
    });
    revalidatePath("/feeds");
    return { ok: false, error: result.reason };
  } catch (err) {
    if (err instanceof FeedRepositoryError) {
      return { ok: false, error: err.message };
    }
    console.error("[feeds] testFeed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
