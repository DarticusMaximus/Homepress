import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { resolveSmtpConfig, SmtpConfigError } from "../smtp-config";

const SMTP_ENV_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "SMTP_SECURE",
] as const;

/** Distinctive value used only to assert it never leaks into error messages. */
const SMTP_PASSWORD_VALUE = "unit-test-smtp-password-do-not-leak";

function clearSmtpEnv(): void {
  for (const key of SMTP_ENV_KEYS) {
    delete process.env[key];
  }
}

function setRequiredSmtpEnv(
  overrides: Partial<Record<(typeof SMTP_ENV_KEYS)[number], string>> = {},
): void {
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USERNAME = "sender@example.com";
  process.env.SMTP_PASSWORD = SMTP_PASSWORD_VALUE;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    process.env[key] = value;
  }
}

function expectSmtpConfigError(fn: () => unknown): SmtpConfigError {
  try {
    fn();
    throw new Error("Expected SmtpConfigError to be thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(SmtpConfigError);
    return err as SmtpConfigError;
  }
}

beforeEach(() => {
  clearSmtpEnv();
});

afterEach(() => {
  clearSmtpEnv();
  vi.unstubAllEnvs();
});

describe("resolveSmtpConfig — happy path", () => {
  it("resolves host/port/user/pass/from/secure; From falls back to username when SMTP_FROM unset", () => {
    setRequiredSmtpEnv();

    const config = resolveSmtpConfig();

    expect(config.host).toBe("smtp.example.com");
    expect(config.port).toBe(587);
    expect(config.username).toBe("sender@example.com");
    expect(config.password).toBe(SMTP_PASSWORD_VALUE);
    expect(config.from).toBe("sender@example.com");
    expect(config.secure).toBe(false);

    process.env.SMTP_FROM = "Tech Digest <news@example.com>";
    const withFrom = resolveSmtpConfig();
    expect(withFrom.from).toBe("Tech Digest <news@example.com>");
  });
});

describe("resolveSmtpConfig — SMTP_SECURE parsing", () => {
  it("treats true/1/yes (case-insensitive) as secure true; unset/false as false", () => {
    setRequiredSmtpEnv();
    expect(resolveSmtpConfig().secure).toBe(false);

    process.env.SMTP_SECURE = "false";
    expect(resolveSmtpConfig().secure).toBe(false);

    for (const truthy of ["true", "TRUE", "1", "yes", "YES", "Yes"] as const) {
      process.env.SMTP_SECURE = truthy;
      expect(resolveSmtpConfig().secure).toBe(true);
    }
  });
});

describe("resolveSmtpConfig — missing required", () => {
  it("errors for each missing host/port/user/pass with a stable message that never includes the password", () => {
    const cases: Array<{
      clear: (typeof SMTP_ENV_KEYS)[number];
      expectedMessage: string;
    }> = [
      {
        clear: "SMTP_HOST",
        expectedMessage: "Missing required environment variable: SMTP_HOST",
      },
      {
        clear: "SMTP_PORT",
        expectedMessage: "Missing required environment variable: SMTP_PORT",
      },
      {
        clear: "SMTP_USERNAME",
        expectedMessage: "Missing required environment variable: SMTP_USERNAME",
      },
      {
        clear: "SMTP_PASSWORD",
        expectedMessage: "Missing required environment variable: SMTP_PASSWORD",
      },
    ];

    for (const { clear, expectedMessage } of cases) {
      clearSmtpEnv();
      setRequiredSmtpEnv();
      delete process.env[clear];

      const err = expectSmtpConfigError(() => resolveSmtpConfig());
      expect(err.message).toBe(expectedMessage);
      expect(err.message).not.toContain(SMTP_PASSWORD_VALUE);
    }

    // Blank counts as missing (host example); password value still must not leak.
    clearSmtpEnv();
    setRequiredSmtpEnv({ SMTP_HOST: "   " });
    const blankHostErr = expectSmtpConfigError(() => resolveSmtpConfig());
    expect(blankHostErr.message).toBe(
      "Missing required environment variable: SMTP_HOST",
    );
    expect(blankHostErr.message).not.toContain(SMTP_PASSWORD_VALUE);
  });
});
