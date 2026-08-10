import { describe, it, expect } from "vitest";
import { formatDeliveryIssueDate } from "@/components/delivery/delivery-display";
import { formatUpdatedAt } from "@/components/domain-list/format-list-datetime";
import { formatPhasePublished } from "@/components/runs/inspect-article-list";
import { formatRunDateTime } from "@/components/runs/run-display";
import {
  formatOperatorDate,
  formatOperatorDateTime,
} from "@/lib/format-operator-datetime";

const SAMPLE_ISO = "2026-03-15T14:30:00.000Z";

describe("formatOperatorDateTime", () => {
  it("uses pinned short date + short time locale options", () => {
    const expected = new Date(SAMPLE_ISO).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
    expect(formatOperatorDateTime(SAMPLE_ISO)).toBe(expected);
  });
});

describe("formatOperatorDate", () => {
  it("uses pinned short date locale options", () => {
    const expected = new Date(SAMPLE_ISO).toLocaleDateString(undefined, {
      dateStyle: "short",
    });
    expect(formatOperatorDate(SAMPLE_ISO)).toBe(expected);
  });
});

describe("Feature 02 datetime wrappers (T1)", () => {
  it("formatRunDateTime matches formatOperatorDateTime", () => {
    expect(formatRunDateTime(SAMPLE_ISO)).toBe(formatOperatorDateTime(SAMPLE_ISO));
  });

  it("formatDeliveryIssueDate matches formatOperatorDate", () => {
    expect(formatDeliveryIssueDate(SAMPLE_ISO)).toBe(formatOperatorDate(SAMPLE_ISO));
  });

  it("formatPhasePublished matches formatOperatorDate", () => {
    expect(formatPhasePublished(new Date(SAMPLE_ISO))).toBe(formatOperatorDate(SAMPLE_ISO));
  });

  it("formatUpdatedAt matches formatOperatorDateTime", () => {
    expect(formatUpdatedAt(SAMPLE_ISO)).toBe(formatOperatorDateTime(SAMPLE_ISO));
  });
});
