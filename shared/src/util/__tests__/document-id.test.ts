import { describe, it, expect } from "vitest";
import {
  APWRITE_DOCUMENT_ID_MAX,
  LIST_LIMIT_MAX,
  clampListLimit,
  isValidAppwriteDocumentId,
} from "../document-id";

describe("APWRITE_DOCUMENT_ID_MAX", () => {
  it("is Appwrite's max custom-id length", () => {
    expect(APWRITE_DOCUMENT_ID_MAX).toBe(36);
  });
});

describe("isValidAppwriteDocumentId", () => {
  it("accepts ULID-ish ids (Appwrite ID.unique() length)", () => {
    expect(isValidAppwriteDocumentId("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
  });

  it("accepts a 36-char alphanumeric id", () => {
    expect(isValidAppwriteDocumentId("A".repeat(36))).toBe(true);
  });

  it("accepts underscores and hyphens", () => {
    expect(isValidAppwriteDocumentId("feed_doc-1")).toBe(true);
    expect(isValidAppwriteDocumentId("_leading")).toBe(true);
    expect(isValidAppwriteDocumentId("trailing-")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidAppwriteDocumentId("")).toBe(false);
  });

  it("rejects path separators", () => {
    expect(isValidAppwriteDocumentId("a/b")).toBe(false);
  });

  it("rejects dot-dot traversal", () => {
    expect(isValidAppwriteDocumentId("..")).toBe(false);
  });

  it("rejects query-string characters", () => {
    expect(isValidAppwriteDocumentId("?x")).toBe(false);
  });

  it("rejects ids longer than 36 characters", () => {
    expect(isValidAppwriteDocumentId("A".repeat(37))).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(isValidAppwriteDocumentId(" ")).toBe(false);
    expect(isValidAppwriteDocumentId("id with space")).toBe(false);
  });

  it("rejects percent-encoded slashes", () => {
    expect(isValidAppwriteDocumentId("%2F")).toBe(false);
  });
});

describe("LIST_LIMIT_MAX", () => {
  it("caps list queries at 500", () => {
    expect(LIST_LIMIT_MAX).toBe(500);
  });
});

describe("clampListLimit", () => {
  it("returns fallback when value is undefined", () => {
    expect(clampListLimit(undefined, 25)).toBe(25);
  });

  it("clamps zero and negatives up to 1", () => {
    expect(clampListLimit(0, 25)).toBe(1);
    expect(clampListLimit(-5, 25)).toBe(1);
  });

  it("clamps values above 500 down to 500", () => {
    expect(clampListLimit(5000, 25)).toBe(500);
  });

  it("passes through values already in range", () => {
    expect(clampListLimit(250, 25)).toBe(250);
  });
});
