import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsRepositoryError } from "@newsletter/shared";

const OPENROUTER_KEY = "sk-or-action-secret-do-not-leak";
const SMTP_PASSWORD = "action-smtp-password-do-not-leak";

const mocks = vi.hoisted(() => ({
  getServerAppwrite: vi.fn(),
  diagnoseOpenRouterConnection: vi.fn(),
  diagnoseSmtpConnection: vi.fn(),
  diagnosePublicUrl: vi.fn(),
  client: { $id: "mock-client" },
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    getServerAppwrite: mocks.getServerAppwrite,
    diagnoseOpenRouterConnection: mocks.diagnoseOpenRouterConnection,
    diagnoseSmtpConnection: mocks.diagnoseSmtpConnection,
    diagnosePublicUrl: mocks.diagnosePublicUrl,
  };
});

import {
  checkPublicUrlAction,
  testOpenRouterConnectionAction,
  testSmtpConnectionAction,
} from "@/app/(protected)/settings/actions";

beforeEach(() => {
  mocks.getServerAppwrite.mockReset();
  mocks.diagnoseOpenRouterConnection.mockReset();
  mocks.diagnoseSmtpConnection.mockReset();
  mocks.diagnosePublicUrl.mockReset();
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
});

describe("testOpenRouterConnectionAction", () => {
  it("maps shared diagnostic pass/fail through without secrets", async () => {
    mocks.diagnoseOpenRouterConnection.mockResolvedValue({
      status: "pass",
      message: "OpenRouter key is valid",
    });

    const result = await testOpenRouterConnectionAction();

    expect(mocks.getServerAppwrite).toHaveBeenCalled();
    expect(mocks.diagnoseOpenRouterConnection).toHaveBeenCalledWith(
      expect.objectContaining({ client: mocks.client }),
    );
    expect(result).toEqual({
      status: "pass",
      message: "OpenRouter key is valid",
    });
    expect(JSON.stringify(result)).not.toContain(OPENROUTER_KEY);
  });

  it("maps Appwrite/resolve failures to an operator-safe error (no secrets)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.diagnoseOpenRouterConnection.mockRejectedValue(
      new SettingsRepositoryError(
        "appwrite",
        `Database blew up with key=${OPENROUTER_KEY}`,
      ),
    );

    const result = await testOpenRouterConnectionAction();

    expect(result.status).toBe("fail");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).not.toContain(OPENROUTER_KEY);
    expect(JSON.stringify(result)).not.toContain(OPENROUTER_KEY);
    consoleError.mockRestore();
  });
});

describe("testSmtpConnectionAction", () => {
  it("maps shared SMTP diagnostic result through", async () => {
    mocks.diagnoseSmtpConnection.mockResolvedValue({
      status: "fail",
      message: "SMTP is not configured",
    });

    const result = await testSmtpConnectionAction();

    expect(mocks.diagnoseSmtpConnection).toHaveBeenCalledWith(
      expect.objectContaining({ client: mocks.client }),
    );
    expect(result).toEqual({
      status: "fail",
      message: "SMTP is not configured",
    });
    expect(JSON.stringify(result)).not.toContain(SMTP_PASSWORD);
  });

  it("never returns SMTP password when shared helper throws a rich error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.diagnoseSmtpConnection.mockRejectedValue(
      new Error(`nodemailer auth failed password=${SMTP_PASSWORD}`),
    );

    const result = await testSmtpConnectionAction();

    expect(result.status).toBe("fail");
    expect(result.message).not.toContain(SMTP_PASSWORD);
    expect(JSON.stringify(result)).not.toContain(SMTP_PASSWORD);
    consoleError.mockRestore();
  });
});

describe("checkPublicUrlAction", () => {
  it("maps shared public-URL pass/warn/fail through", async () => {
    mocks.diagnosePublicUrl.mockResolvedValue({
      status: "warn",
      message:
        "Homepress could not reach https://app.example.com from this server; browsers and RSS clients may still work.",
    });

    const result = await checkPublicUrlAction();

    expect(mocks.diagnosePublicUrl).toHaveBeenCalledWith(
      expect.objectContaining({ client: mocks.client }),
    );
    expect(result.status).toBe("warn");
    expect(result.message).toContain("https://app.example.com");
  });

  it("maps unexpected infra errors to operator-safe fail without secrets", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getServerAppwrite.mockImplementation(() => {
      throw new Error(`appwrite init failed secret=${OPENROUTER_KEY}`);
    });

    const result = await checkPublicUrlAction();

    expect(result.status).toBe("fail");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).not.toContain(OPENROUTER_KEY);
    consoleError.mockRestore();
  });
});
