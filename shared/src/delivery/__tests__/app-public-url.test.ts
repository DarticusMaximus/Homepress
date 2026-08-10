import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Intentionally imports a module that does not exist yet (Task 3).
// Cases 5–6 fail red for missing module / unimplemented API.
import { resolveAppPublicUrl, AppPublicUrlError } from "../app-public-url";

function clearAppPublicUrlEnv(): void {
  delete process.env.APP_PUBLIC_URL;
}

function expectAppPublicUrlError(fn: () => unknown): AppPublicUrlError {
  try {
    fn();
    throw new Error("Expected AppPublicUrlError to be thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(AppPublicUrlError);
    return err as AppPublicUrlError;
  }
}

beforeEach(() => {
  clearAppPublicUrlEnv();
});

afterEach(() => {
  clearAppPublicUrlEnv();
  vi.unstubAllEnvs();
});

describe("resolveAppPublicUrl — happy path", () => {
  it("returns env value without trailing slash; strips a trailing slash when present", () => {
    process.env.APP_PUBLIC_URL = "https://news.example.com";
    expect(resolveAppPublicUrl()).toBe("https://news.example.com");

    process.env.APP_PUBLIC_URL = "https://news.example.com/";
    expect(resolveAppPublicUrl()).toBe("https://news.example.com");
  });
});

describe("resolveAppPublicUrl — missing", () => {
  it("throws a config error with a stable message when unset or blank (never invents localhost)", () => {
    const unsetErr = expectAppPublicUrlError(() => resolveAppPublicUrl());
    expect(unsetErr.message).toBe(
      "Missing required environment variable: APP_PUBLIC_URL",
    );
    expect(unsetErr.message.toLowerCase()).not.toContain("localhost");

    process.env.APP_PUBLIC_URL = "   ";
    const blankErr = expectAppPublicUrlError(() => resolveAppPublicUrl());
    expect(blankErr.message).toBe(
      "Missing required environment variable: APP_PUBLIC_URL",
    );
    expect(blankErr.message.toLowerCase()).not.toContain("localhost");
  });
});
