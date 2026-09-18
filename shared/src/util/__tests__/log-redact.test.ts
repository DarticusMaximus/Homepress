import { describe, it, expect } from "vitest";
import { describeError, sanitizeAppwriteMessageForLog } from "../log-redact";

describe("sanitizeAppwriteMessageForLog", () => {
  it("returns short messages unchanged", () => {
    expect(sanitizeAppwriteMessageForLog("not found")).toBe("not found");
  });

  it("returns a message exactly maxLen long unchanged", () => {
    const exact = "a b ".repeat(40);
    expect(exact.length).toBe(160);
    expect(sanitizeAppwriteMessageForLog(exact)).toBe(exact);
  });

  it("truncates messages longer than maxLen and appends an ellipsis marker", () => {
    const long = "word ".repeat(60);
    const result = sanitizeAppwriteMessageForLog(long, 160);
    expect(result).toBe(`${long.slice(0, 160)}...`);
    expect(result.endsWith("...")).toBe(true);
  });

  it("honors a custom maxLen", () => {
    const long = "the quick brown fox ".repeat(10);
    const result = sanitizeAppwriteMessageForLog(long, 10);
    expect(result).toBe(`${long.slice(0, 10)}...`);
  });

  it("redacts sk- prefixed tokens", () => {
    expect(sanitizeAppwriteMessageForLog("Request failed with key sk-leak")).toBe(
      "Request failed with key [redacted]",
    );
    expect(sanitizeAppwriteMessageForLog(`Unauthorized: sk-secret-do-not-leak-1234567890`)).toBe(
      "Unauthorized: [redacted]",
    );
  });

  it("redacts sk_ prefixed tokens", () => {
    expect(sanitizeAppwriteMessageForLog("key=sk_live_abcd1234EFGH5678ijkl")).toBe(
      "key=[redacted]",
    );
  });

  it("redacts Bearer tokens (case-insensitive)", () => {
    expect(sanitizeAppwriteMessageForLog("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9")).toBe(
      "Authorization: [redacted]",
    );
    expect(sanitizeAppwriteMessageForLog("auth bearer abcdefghijklmnop1234567890")).toBe(
      "auth [redacted]",
    );
  });

  it("redacts long high-entropy alphanumeric runs (24+ chars)", () => {
    const key = "z".repeat(40);
    expect(sanitizeAppwriteMessageForLog(`doc ${key} missing`)).toBe("doc [redacted] missing");
  });

  it("leaves short alphanumeric runs alone", () => {
    expect(sanitizeAppwriteMessageForLog("feed doc shortid123")).toBe("feed doc shortid123");
  });

  it("redacts secrets before truncating so no partial key tail leaks", () => {
    const prefix = "word ".repeat(31);
    const payload = `${prefix}${"Z".repeat(40)}`;
    const result = sanitizeAppwriteMessageForLog(payload, 160);
    expect(result).not.toContain("Z");
    expect(result.endsWith("...")).toBe(true);
  });

  it("redacts multiple secrets in one message", () => {
    const result = sanitizeAppwriteMessageForLog(
      `sk-one1234567890 and Bearer token${"A".repeat(20)} plus ${"z".repeat(24)}`,
    );
    expect(result).not.toContain("sk-one");
    expect(result).not.toContain("token");
    expect(result).not.toContain("zzzz");
    expect(result).toContain("[redacted]");
  });
});

describe("describeError", () => {
  it("extracts message and numeric code from AppwriteException-shaped objects", () => {
    expect(describeError({ code: 404, message: "Document not found" })).toEqual({
      message: "Document not found",
      code: 404,
    });
  });

  it("omits code when it is not a number", () => {
    expect(describeError({ code: "404", message: "not found" })).toEqual({
      message: "not found",
    });
  });

  it("falls back to String(err) when message is empty or not a string", () => {
    expect(describeError({ code: 500, message: "" })).toEqual({
      message: "[object Object]",
      code: 500,
    });
    expect(describeError({ message: 42 })).toEqual({ message: "[object Object]" });
  });

  it("uses Error.message and does not dump the stack", () => {
    const err = new Error("boom");
    expect(describeError(err)).toEqual({ message: "boom" });
  });

  it("stringifies primitives", () => {
    expect(describeError("plain")).toEqual({ message: "plain" });
    expect(describeError(7)).toEqual({ message: "7" });
    expect(describeError(null)).toEqual({ message: "null" });
  });
});
