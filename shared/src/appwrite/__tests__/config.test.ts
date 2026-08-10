import { afterEach, describe, expect, it } from "vitest";
import {
  getAppwriteConfig,
  getAppwriteEndpoint,
  getAppwriteProjectId,
  readRuntimeEnv,
} from "../config";

const KEYS = [
  "NEXT_PUBLIC_APPWRITE_ENDPOINT",
  "NEXT_PUBLIC_APPWRITE_PROJECT_ID",
  "APPWRITE_API_KEY",
] as const;

const saved: Record<string, string | undefined> = {};

afterEach(() => {
  for (const key of KEYS) {
    if (key in saved) {
      const prev = saved[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
      delete saved[key];
    }
  }
});

function setEnv(key: string, value: string | undefined): void {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("readRuntimeEnv", () => {
  it("trims and treats blank as missing", () => {
    setEnv("NEXT_PUBLIC_APPWRITE_ENDPOINT", "  https://example.test/v1  ");
    expect(readRuntimeEnv("NEXT_PUBLIC_APPWRITE_ENDPOINT")).toBe(
      "https://example.test/v1",
    );

    setEnv("NEXT_PUBLIC_APPWRITE_ENDPOINT", "   ");
    expect(readRuntimeEnv("NEXT_PUBLIC_APPWRITE_ENDPOINT")).toBeUndefined();
  });
});

describe("getAppwriteConfig (runtime env)", () => {
  it("reads endpoint/project/apiKey from process.env at call time", () => {
    setEnv("NEXT_PUBLIC_APPWRITE_ENDPOINT", "https://appwrite.example/v1");
    setEnv("NEXT_PUBLIC_APPWRITE_PROJECT_ID", "proj-1");
    setEnv("APPWRITE_API_KEY", "secret-key");

    expect(getAppwriteEndpoint()).toBe("https://appwrite.example/v1");
    expect(getAppwriteProjectId()).toBe("proj-1");
    expect(getAppwriteConfig()).toEqual({
      endpoint: "https://appwrite.example/v1",
      projectId: "proj-1",
      apiKey: "secret-key",
    });
  });

  it("throws when required keys are missing", () => {
    setEnv("NEXT_PUBLIC_APPWRITE_ENDPOINT", undefined);
    setEnv("NEXT_PUBLIC_APPWRITE_PROJECT_ID", "proj-1");
    setEnv("APPWRITE_API_KEY", "secret-key");
    expect(() => getAppwriteConfig()).toThrow(
      /NEXT_PUBLIC_APPWRITE_ENDPOINT/,
    );
  });
});
