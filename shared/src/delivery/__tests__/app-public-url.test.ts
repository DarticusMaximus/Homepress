import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Client } from "node-appwrite";

import type { ResolvedOperatorSettings } from "../../settings/resolve-operator-settings";
import {
  appPublicUrlFromResolved,
  resolveAppPublicUrl,
  resolveEffectiveAppPublicUrl,
  AppPublicUrlError,
} from "../app-public-url";

const mocks = vi.hoisted(() => ({
  resolveOperatorSettings: vi.fn(),
}));

vi.mock("../../settings/resolve-operator-settings", () => ({
  resolveOperatorSettings: mocks.resolveOperatorSettings,
}));

const client = {} as Client;

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

async function expectAppPublicUrlErrorAsync(
  fn: () => Promise<unknown>,
): Promise<AppPublicUrlError> {
  try {
    await fn();
    throw new Error("Expected AppPublicUrlError to be thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(AppPublicUrlError);
    return err as AppPublicUrlError;
  }
}

function baseResolved(
  overrides: Partial<ResolvedOperatorSettings> = {},
): ResolvedOperatorSettings {
  return {
    openRouterApiKey: { value: null, source: "none" },
    smtp: { value: null, source: "none" },
    appPublicUrl: { value: null, source: "none" },
    scoreThreshold: { value: 5, source: "default" },
    crossRunSimilarityThreshold: { value: 0.85, source: "default" },
    rssFeedMaxItems: { value: 10, source: "default" },
    drafterReasoningEffort: { value: "high", source: "default" },
    drafterMaxCompletionTokens: { value: 32000, source: "default" },
    ...overrides,
  };
}

beforeEach(() => {
  clearAppPublicUrlEnv();
  vi.clearAllMocks();
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

describe("appPublicUrlFromResolved — sync snapshot helper", () => {
  it("returns value and strips trailing slash", () => {
    expect(
      appPublicUrlFromResolved({ value: "https://gui.example.com", source: "gui" }),
    ).toBe("https://gui.example.com");
    expect(
      appPublicUrlFromResolved({ value: "https://env.example.com/", source: "env" }),
    ).toBe("https://env.example.com");
  });

  it("throws AppPublicUrlError when source is none / value null or blank", () => {
    const noneErr = expectAppPublicUrlError(() =>
      appPublicUrlFromResolved({ value: null, source: "none" }),
    );
    expect(noneErr.message.toLowerCase()).not.toContain("localhost");
    expect(noneErr.message.toLowerCase()).toMatch(/public.?url|app_public_url/i);

    const blankErr = expectAppPublicUrlError(() =>
      appPublicUrlFromResolved({ value: "   ", source: "env" }),
    );
    expect(blankErr.message.toLowerCase()).toMatch(/public.?url|app_public_url/i);
  });
});

describe("resolveEffectiveAppPublicUrl — Stage 12 cascade", () => {
  it("returns GUI-resolved public URL", async () => {
    mocks.resolveOperatorSettings.mockResolvedValue(
      baseResolved({
        appPublicUrl: { value: "https://gui.example.com", source: "gui" },
      }),
    );

    await expect(resolveEffectiveAppPublicUrl(client)).resolves.toBe(
      "https://gui.example.com",
    );
    expect(mocks.resolveOperatorSettings).toHaveBeenCalledWith(client);
  });

  it("returns env-resolved public URL when GUI is unset", async () => {
    mocks.resolveOperatorSettings.mockResolvedValue(
      baseResolved({
        appPublicUrl: { value: "https://env.example.com", source: "env" },
      }),
    );

    await expect(resolveEffectiveAppPublicUrl(client)).resolves.toBe(
      "https://env.example.com",
    );
  });

  it("throws AppPublicUrlError when source is none / value null (never invents localhost)", async () => {
    mocks.resolveOperatorSettings.mockResolvedValue(
      baseResolved({
        appPublicUrl: { value: null, source: "none" },
      }),
    );

    const err = await expectAppPublicUrlErrorAsync(() =>
      resolveEffectiveAppPublicUrl(client),
    );
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.message.toLowerCase()).not.toContain("localhost");
    expect(err.message.toLowerCase()).toMatch(/public.?url|app_public_url/i);
  });
});
