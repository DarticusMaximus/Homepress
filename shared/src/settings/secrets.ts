import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readRuntimeEnv } from "../appwrite/config";
import { SettingsRepositoryError } from "./types";

export const SETTINGS_SECRET_KEY_ENV = "SETTINGS_SECRET_KEY";

export type SettingsCipherStatus = "off" | "on" | "invalid";

const CIPHER_MARKER = "enc1:";
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 350;
const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;
const ALGORITHM = "aes-256-gcm";

const INVALID_KEY_MESSAGE =
  "SETTINGS_SECRET_KEY is set but malformed. It must be exactly 64 hex characters. Secret writes are refused until the key is fixed.";
const OVERSIZE_MESSAGE =
  "Secret is too long to encrypt (350 UTF-8 bytes maximum). Clear and re-enter a shorter value, or store it in the environment instead.";
const UNREADABLE_LOG =
  "Stored settings secret is unreadable (missing/invalid key or tampered ciphertext)";

function readSecretKey(env?: NodeJS.ProcessEnv): string | undefined {
  if (env !== undefined) {
    const value = env[SETTINGS_SECRET_KEY_ENV];
    if (value == null) return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return readRuntimeEnv(SETTINGS_SECRET_KEY_ENV);
}

/**
 * Cipher availability from `SETTINGS_SECRET_KEY`: unset → `off`, 64 hex → `on`,
 * set-but-malformed → `invalid`.
 */
export function settingsCipherStatus(env?: NodeJS.ProcessEnv): SettingsCipherStatus {
  const raw = readSecretKey(env);
  if (raw === undefined) return "off";
  if (HEX_KEY_RE.test(raw)) return "on";
  return "invalid";
}

export function isEncryptedSecretValue(v: string): boolean {
  return v.startsWith(CIPHER_MARKER);
}

/**
 * Encrypt a secret for at-rest storage. Throws validation when the key is
 * malformed, or when plaintext exceeds 350 UTF-8 bytes under `on`. Under `off`
 * the value is returned unchanged (repository stores plaintext).
 */
export function encryptSecretValue(plain: string, env?: NodeJS.ProcessEnv): string {
  const status = settingsCipherStatus(env);
  if (status === "invalid") {
    throw new SettingsRepositoryError("validation", INVALID_KEY_MESSAGE);
  }
  if (status === "off") {
    return plain;
  }
  if (Buffer.byteLength(plain, "utf8") > MAX_PLAINTEXT_BYTES) {
    throw new SettingsRepositoryError("validation", OVERSIZE_MESSAGE);
  }

  const keyHex = readSecretKey(env);
  if (keyHex === undefined || !HEX_KEY_RE.test(keyHex)) {
    throw new SettingsRepositoryError("validation", INVALID_KEY_MESSAGE);
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, Buffer.from(keyHex, "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, ciphertext]);
  return CIPHER_MARKER + packed.toString("base64");
}

/**
 * Decrypt a stored secret. Legacy (no `enc1:` marker) values pass through.
 * Marked ciphertext with a wrong/missing key or tampering returns `""` and
 * logs a sanitized line — never throws.
 */
export function decryptSecretValue(stored: string, env?: NodeJS.ProcessEnv): string {
  if (!isEncryptedSecretValue(stored)) {
    return stored;
  }

  const status = settingsCipherStatus(env);
  const keyHex = status === "on" ? readSecretKey(env) : undefined;
  if (keyHex === undefined || !HEX_KEY_RE.test(keyHex)) {
    console.error(UNREADABLE_LOG);
    return "";
  }

  try {
    const packed = Buffer.from(stored.slice(CIPHER_MARKER.length), "base64");
    if (packed.length < IV_BYTES + GCM_TAG_BYTES) {
      console.error(UNREADABLE_LOG);
      return "";
    }
    const iv = packed.subarray(0, IV_BYTES);
    const tag = packed.subarray(IV_BYTES, IV_BYTES + GCM_TAG_BYTES);
    const ciphertext = packed.subarray(IV_BYTES + GCM_TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, Buffer.from(keyHex, "hex"), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    console.error(UNREADABLE_LOG);
    return "";
  }
}
