import type { Client } from "node-appwrite";
import nodemailer from "nodemailer";

import type { SmtpConfig } from "../delivery/smtp-config";
import { isLiteralMetadataOrLinkLocalHost } from "../feeds/ssrf";
import { redactMessageForStorage } from "../util/log-redact";
import {
  resolveOperatorSettings,
  type SettingsSource,
} from "./resolve-operator-settings";

/** Shared probe outcome — OpenRouter/SMTP use pass|fail; public URL may warn. */
export type ConnectionDiagnosticStatus = "pass" | "fail" | "warn";

export type ConnectionDiagnosticResult = {
  status: ConnectionDiagnosticStatus;
  /** Operator-facing; never contains API key or SMTP password. */
  message: string;
};

/** Midpoint of the PM-pinned ~10–15s probe window. */
export const CONNECTION_DIAGNOSTIC_TIMEOUT_MS = 12_000;

/** Same default base as {@link LLMClient} / OpenRouter REST. */
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

type ResolvedString = { value: string | null; source: SettingsSource };
type ResolvedSmtp = { value: SmtpConfig | null; source: SettingsSource };

type FetchLike = typeof fetch;

type DiagnosticTransport = {
  sendMail: (mail: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }) => Promise<unknown>;
};

type CreateTransportLike = (options: unknown) => DiagnosticTransport;

export type DiagnoseOpenRouterConnectionOptions = {
  /** Pre-resolved key from {@link resolveOperatorSettings}; skips Appwrite when set. */
  openRouterApiKey?: ResolvedString;
  /** Used when `openRouterApiKey` is omitted — loads via {@link resolveOperatorSettings}. */
  client?: Client;
  fetch?: FetchLike;
  /** OpenRouter REST base (default `https://openrouter.ai/api/v1`). */
  baseUrl?: string;
  timeoutMs?: number;
};

export type DiagnoseSmtpConnectionOptions = {
  smtp?: ResolvedSmtp;
  client?: Client;
  /** Injectable nodemailer factory for unit tests. */
  createTransport?: CreateTransportLike;
  timeoutMs?: number;
};

export type DiagnosePublicUrlOptions = {
  appPublicUrl?: ResolvedString;
  client?: Client;
  fetch?: FetchLike;
  timeoutMs?: number;
};

function result(
  status: ConnectionDiagnosticStatus,
  message: string,
): ConnectionDiagnosticResult {
  return { status, message };
}

/**
 * Strip known secret substrings then run the shared token redactor.
 * Never rely on regex alone when the probe already knows the secret values.
 */
function sanitizeOperatorMessage(
  raw: string,
  secrets: Array<string | null | undefined>,
): string {
  let message = raw;
  for (const secret of secrets) {
    if (secret == null || secret.length === 0) continue;
    message = message.split(secret).join("[redacted]");
  }
  return redactMessageForStorage(message, 500);
}

function isMissingResolvedString(resolved: ResolvedString): boolean {
  return (
    resolved.source === "none" ||
    resolved.value === null ||
    resolved.value.trim() === ""
  );
}

function isAbsoluteHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function loadResolved(
  client: Client | undefined,
): Promise<
  | { ok: true; settings: Awaited<ReturnType<typeof resolveOperatorSettings>> }
  | { ok: false; message: string }
> {
  if (client === undefined) {
    return {
      ok: false,
      message: "Settings client is required to resolve connection settings",
    };
  }
  try {
    const settings = await resolveOperatorSettings(client);
    return { ok: true, settings };
  } catch {
    return {
      ok: false,
      message: "Could not load saved settings for connection diagnostics",
    };
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Prove the resolved OpenRouter API key via `GET {baseUrl}/key` (no chat spend).
 */
export async function diagnoseOpenRouterConnection(
  options: DiagnoseOpenRouterConnectionOptions = {},
): Promise<ConnectionDiagnosticResult> {
  const timeoutMs = options.timeoutMs ?? CONNECTION_DIAGNOSTIC_TIMEOUT_MS;
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = (options.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL).replace(
    /\/+$/,
    "",
  );

  let keyResolved = options.openRouterApiKey;
  if (keyResolved === undefined) {
    const loaded = await loadResolved(options.client);
    if (!loaded.ok) return result("fail", loaded.message);
    keyResolved = loaded.settings.openRouterApiKey;
  }

  if (isMissingResolvedString(keyResolved)) {
    return result("fail", "OpenRouter API key is not set");
  }

  const apiKey = keyResolved.value!.trim();
  const url = `${baseUrl}/key`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const raw =
      name === "AbortError" || name === "TimeoutError"
        ? "OpenRouter key check timed out"
        : `OpenRouter connection failed: ${err instanceof Error ? err.message : String(err)}`;
    return result("fail", sanitizeOperatorMessage(raw, [apiKey]));
  }

  if (response.status >= 200 && response.status < 300) {
    return result("pass", "OpenRouter API key is valid");
  }

  if (response.status === 401) {
    return result(
      "fail",
      sanitizeOperatorMessage("OpenRouter rejected the API key (unauthorized)", [
        apiKey,
      ]),
    );
  }

  return result(
    "fail",
    sanitizeOperatorMessage(
      `OpenRouter key check failed with HTTP ${response.status}`,
      [apiKey],
    ),
  );
}

/**
 * Prove resolved SMTP by sending a short Homepress test mail with To = From.
 */
export async function diagnoseSmtpConnection(
  options: DiagnoseSmtpConnectionOptions = {},
): Promise<ConnectionDiagnosticResult> {
  const timeoutMs = options.timeoutMs ?? CONNECTION_DIAGNOSTIC_TIMEOUT_MS;
  const createTransport =
    options.createTransport ??
    (nodemailer.createTransport.bind(nodemailer) as CreateTransportLike);

  let smtpResolved = options.smtp;
  if (smtpResolved === undefined) {
    const loaded = await loadResolved(options.client);
    if (!loaded.ok) return result("fail", loaded.message);
    smtpResolved = loaded.settings.smtp;
  }

  if (smtpResolved.source === "none" || smtpResolved.value === null) {
    return result("fail", "SMTP is not configured");
  }

  const config = smtpResolved.value;
  const from = config.from.trim() !== "" ? config.from.trim() : config.username;

  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.username,
      pass: config.password,
    },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });

  try {
    await withTimeout(
      transport.sendMail({
        from,
        to: from,
        subject: "Homepress SMTP test",
        text: "Homepress SMTP connection test — you can ignore this message.",
      }),
      timeoutMs,
      "SMTP test",
    );
  } catch (err) {
    const raw = `SMTP test failed: ${err instanceof Error ? err.message : String(err)}`;
    return result(
      "fail",
      sanitizeOperatorMessage(raw, [config.password, config.username]),
    );
  }

  return result("pass", "SMTP test email sent successfully");
}

/** Cap redirect hops so unbounded cross-host chains cannot run. */
const MAX_PUBLIC_URL_REDIRECTS = 5;

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

function publicUrlUnreachableWarn(
  configuredUrl: string,
  detail?: string,
): ConnectionDiagnosticResult {
  const suffix = detail ? ` (${detail})` : "";
  return result(
    "warn",
    `The server could not reach ${configuredUrl}${suffix}. Browsers and RSS clients may still work from other networks.`,
  );
}

/**
 * Prove the resolved public base URL with a server-side GET.
 * Unreachable-from-server outcomes are **warn** (hairpin/NAT false alarms).
 *
 * Follows redirects manually (max {@link MAX_PUBLIC_URL_REDIRECTS}) and refuses
 * literal link-local / cloud-metadata hops. Does **not** apply full feed-style
 * public-routability to the configured base (LAN / APP_PUBLIC_URL self-host OK).
 */
export async function diagnosePublicUrl(
  options: DiagnosePublicUrlOptions = {},
): Promise<ConnectionDiagnosticResult> {
  const timeoutMs = options.timeoutMs ?? CONNECTION_DIAGNOSTIC_TIMEOUT_MS;
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  let urlResolved = options.appPublicUrl;
  if (urlResolved === undefined) {
    const loaded = await loadResolved(options.client);
    if (!loaded.ok) return result("fail", loaded.message);
    urlResolved = loaded.settings.appPublicUrl;
  }

  if (isMissingResolvedString(urlResolved)) {
    return result("fail", "Public URL is not set");
  }

  const configuredUrl = urlResolved.value!.trim();
  if (!isAbsoluteHttpUrl(configuredUrl)) {
    return result(
      "fail",
      "Public URL must be an absolute http:// or https:// URL",
    );
  }

  const signal = AbortSignal.timeout(timeoutMs);
  let currentUrl = configuredUrl;

  try {
    for (let redirectsFollowed = 0; ; redirectsFollowed++) {
      let hop: URL;
      try {
        hop = new URL(currentUrl);
      } catch {
        return publicUrlUnreachableWarn(configuredUrl);
      }

      if (hop.protocol !== "http:" && hop.protocol !== "https:") {
        return publicUrlUnreachableWarn(configuredUrl);
      }

      // Block literal metadata / link-local before every hop (initial + redirects).
      // Private LAN bases (e.g. 192.168.x) are intentionally allowed.
      if (isLiteralMetadataOrLinkLocalHost(hop.hostname)) {
        return publicUrlUnreachableWarn(configuredUrl);
      }

      const response = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal,
      });

      if (isRedirectStatus(response.status)) {
        if (redirectsFollowed >= MAX_PUBLIC_URL_REDIRECTS) {
          return publicUrlUnreachableWarn(configuredUrl);
        }
        const location = response.headers.get("location");
        if (location == null || location.trim() === "") {
          return publicUrlUnreachableWarn(
            configuredUrl,
            `HTTP ${response.status}`,
          );
        }
        let next: URL;
        try {
          next = new URL(location, currentUrl);
        } catch {
          return publicUrlUnreachableWarn(configuredUrl);
        }
        currentUrl = next.href;
        continue;
      }

      if (response.status >= 200 && response.status < 300) {
        return result("pass", `Public URL is reachable (${configuredUrl})`);
      }

      return publicUrlUnreachableWarn(configuredUrl, `HTTP ${response.status}`);
    }
  } catch {
    return publicUrlUnreachableWarn(configuredUrl);
  }
}
