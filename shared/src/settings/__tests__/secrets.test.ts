import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsRepositoryError } from "../types";
import {
  SETTINGS_SECRET_KEY_ENV,
  decryptSecretValue,
  encryptSecretValue,
  isEncryptedSecretValue,
  settingsCipherStatus,
} from "../secrets";

const MARKER = "enc1:";
const MAX_PLAINTEXT_BYTES = 350;
const MAX_CIPHERTEXT_CHARS = 509;

function validKey(): string {
  return randomBytes(32).toString("hex");
}

function expectValidation(fn: () => unknown): SettingsRepositoryError {
  try {
    fn();
    throw new Error("Expected SettingsRepositoryError with code validation");
  } catch (err) {
    expect(err).toBeInstanceOf(SettingsRepositoryError);
    const repoErr = err as SettingsRepositoryError;
    expect(repoErr.code).toBe("validation");
    expect(repoErr.message.length).toBeGreaterThan(0);
    return repoErr;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("SETTINGS_SECRET_KEY_ENV", () => {
  it("is SETTINGS_SECRET_KEY", () => {
    expect(SETTINGS_SECRET_KEY_ENV).toBe("SETTINGS_SECRET_KEY");
  });
});

describe("settingsCipherStatus", () => {
  it("returns off for unset, blank, and whitespace-only keys", () => {
    expect(settingsCipherStatus({})).toBe("off");
    expect(settingsCipherStatus({ [SETTINGS_SECRET_KEY_ENV]: "" })).toBe("off");
    expect(settingsCipherStatus({ [SETTINGS_SECRET_KEY_ENV]: "   " })).toBe("off");
  });

  it("returns on for a 64-hex key (via opts.env and process.env)", () => {
    const key = validKey();
    expect(key).toHaveLength(64);
    expect(settingsCipherStatus({ [SETTINGS_SECRET_KEY_ENV]: key })).toBe("on");
    expect(settingsCipherStatus({ [SETTINGS_SECRET_KEY_ENV]: `  ${key}  ` })).toBe(
      "on",
    );

    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, key);
    expect(settingsCipherStatus()).toBe("on");
  });

  it("returns invalid for set-but-malformed keys", () => {
    expect(settingsCipherStatus({ [SETTINGS_SECRET_KEY_ENV]: "not-a-key" })).toBe(
      "invalid",
    );
    expect(settingsCipherStatus({ [SETTINGS_SECRET_KEY_ENV]: "aa".repeat(31) })).toBe(
      "invalid",
    );
    expect(settingsCipherStatus({ [SETTINGS_SECRET_KEY_ENV]: "aa".repeat(33) })).toBe(
      "invalid",
    );
    expect(settingsCipherStatus({ [SETTINGS_SECRET_KEY_ENV]: "g".repeat(64) })).toBe(
      "invalid",
    );

    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, "short");
    expect(settingsCipherStatus()).toBe("invalid");
  });
});

describe("encryptSecretValue / decryptSecretValue", () => {
  it("round-trips plaintext, differs from it, and marks enc1:", () => {
    const key = validKey();
    const env = { [SETTINGS_SECRET_KEY_ENV]: key };
    const plain = "sk-or-unit-test-secret";

    const encrypted = encryptSecretValue(plain, env);
    expect(encrypted).not.toBe(plain);
    expect(encrypted.startsWith(MARKER)).toBe(true);
    expect(isEncryptedSecretValue(encrypted)).toBe(true);
    expect(decryptSecretValue(encrypted, env)).toBe(plain);
  });

  it("round-trips via vi.stubEnv / readRuntimeEnv", () => {
    const key = validKey();
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, key);
    const plain = "smtp-unit-test-password";

    const encrypted = encryptSecretValue(plain);
    expect(encrypted).not.toBe(plain);
    expect(isEncryptedSecretValue(encrypted)).toBe(true);
    expect(decryptSecretValue(encrypted)).toBe(plain);
  });

  it("emits enc1: ciphertext ≤ 509 chars for a 350-byte input", () => {
    const env = { [SETTINGS_SECRET_KEY_ENV]: validKey() };
    const plain = "a".repeat(MAX_PLAINTEXT_BYTES);
    expect(Buffer.byteLength(plain, "utf8")).toBe(MAX_PLAINTEXT_BYTES);

    const encrypted = encryptSecretValue(plain, env);
    expect(encrypted.startsWith(MARKER)).toBe(true);
    expect(encrypted.length).toBeLessThanOrEqual(MAX_CIPHERTEXT_CHARS);
    expect(decryptSecretValue(encrypted, env)).toBe(plain);
  });

  it("throws validation for a 200-char multibyte (emoji) password over the 350-byte cap", () => {
    const env = { [SETTINGS_SECRET_KEY_ENV]: validKey() };
    const plain = "😀".repeat(200);
    expect([...plain].length).toBe(200);
    expect(Buffer.byteLength(plain, "utf8")).toBeGreaterThan(MAX_PLAINTEXT_BYTES);

    const err = expectValidation(() => encryptSecretValue(plain, env));
    expect(err.message).toMatch(/350/);
  });

  it("throws validation when plaintext is > 350 bytes under on", () => {
    const env = { [SETTINGS_SECRET_KEY_ENV]: validKey() };
    const plain = "a".repeat(MAX_PLAINTEXT_BYTES + 1);
    expect(Buffer.byteLength(plain, "utf8")).toBe(MAX_PLAINTEXT_BYTES + 1);

    const err = expectValidation(() => encryptSecretValue(plain, env));
    expect(err.message).toMatch(/350/);
  });

  it("passes legacy no-marker values through on decrypt", () => {
    const env = { [SETTINGS_SECRET_KEY_ENV]: validKey() };
    expect(decryptSecretValue("legacy-plaintext-smtp-password", env)).toBe(
      "legacy-plaintext-smtp-password",
    );
    expect(decryptSecretValue("legacy-plaintext-smtp-password")).toBe(
      "legacy-plaintext-smtp-password",
    );
    expect(isEncryptedSecretValue("legacy-plaintext-smtp-password")).toBe(false);
  });

  it("returns empty string for wrong key and logs a sanitized line", () => {
    const keyA = validKey();
    const keyB = validKey();
    expect(keyA).not.toBe(keyB);
    const plain = "sk-or-must-not-appear-in-logs";
    const encrypted = encryptSecretValue(plain, { [SETTINGS_SECRET_KEY_ENV]: keyA });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(decryptSecretValue(encrypted, { [SETTINGS_SECRET_KEY_ENV]: keyB })).toBe(
      "",
    );
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).not.toContain(plain);
    expect(logged).not.toContain(keyA);
    expect(logged).not.toContain(keyB);
    expect(logged).not.toContain(encrypted);
  });

  it("returns empty string for tampered ciphertext and logs a sanitized line", () => {
    const env = { [SETTINGS_SECRET_KEY_ENV]: validKey() };
    const plain = "smtp-must-not-appear-in-logs";
    const encrypted = encryptSecretValue(plain, env);
    const packed = Buffer.from(encrypted.slice(MARKER.length), "base64");
    packed[packed.length - 1] ^= 0xff;
    const tampered = MARKER + packed.toString("base64");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => decryptSecretValue(tampered, env)).not.toThrow();
    expect(decryptSecretValue(tampered, env)).toBe("");
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).not.toContain(plain);
    expect(logged).not.toContain(env[SETTINGS_SECRET_KEY_ENV]);
    expect(logged).not.toContain(tampered);
  });

  it("returns empty string when marked ciphertext is read with a missing key", () => {
    const key = validKey();
    const encrypted = encryptSecretValue("kept-secret", {
      [SETTINGS_SECRET_KEY_ENV]: key,
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(decryptSecretValue(encrypted, {})).toBe("");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("refuses writes when cipher status is invalid", () => {
    const env = { [SETTINGS_SECRET_KEY_ENV]: "malformed-not-64-hex" };
    expect(settingsCipherStatus(env)).toBe("invalid");

    const err = expectValidation(() => encryptSecretValue("sk-or-new-secret", env));
    expect(err.message).toMatch(/SETTINGS_SECRET_KEY/);
    expect(err.message).toMatch(/malformed/i);
  });
});

describe("isEncryptedSecretValue", () => {
  it("is true only for the enc1: marker", () => {
    expect(isEncryptedSecretValue("enc1:abc")).toBe(true);
    expect(isEncryptedSecretValue("enc1:")).toBe(true);
    expect(isEncryptedSecretValue("enc1")).toBe(false);
    expect(isEncryptedSecretValue("")).toBe(false);
    expect(isEncryptedSecretValue("plaintext")).toBe(false);
  });
});
