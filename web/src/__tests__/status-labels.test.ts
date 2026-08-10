import { describe, expect, it } from "vitest";
import type { FeedOperationalHealth, FeedStatus, RunStatus } from "@newsletter/shared";
import {
  formatFeedHealthLabel,
  formatFeedStatusLabel,
  formatRunStatusLabel,
} from "@/lib/status-labels";

describe("formatRunStatusLabel", () => {
  it.each<[RunStatus, string]>([
    ["pending", "Pending"],
    ["running", "Running"],
    ["completed", "Completed"],
    ["failed", "Failed"],
  ])("maps %s → %s", (status, label) => {
    expect(formatRunStatusLabel(status)).toBe(label);
  });
});

describe("formatFeedStatusLabel", () => {
  it.each<[FeedStatus, string]>([
    ["untested", "Untested"],
    ["ok", "Ok"],
    ["failed", "Failed"],
  ])("maps %s → %s", (status, label) => {
    expect(formatFeedStatusLabel(status)).toBe(label);
  });
});

describe("formatFeedHealthLabel", () => {
  it.each<[FeedOperationalHealth, string]>([
    ["healthy", "Healthy"],
    ["unhealthy", "Unhealthy"],
  ])("maps %s → %s", (health, label) => {
    expect(formatFeedHealthLabel(health)).toBe(label);
  });
});
