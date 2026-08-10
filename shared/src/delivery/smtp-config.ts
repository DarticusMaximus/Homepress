export type SmtpConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  secure: boolean;
};

export class SmtpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpConfigError";
  }
}

const TRUTHY_SECURE = new Set(["true", "1", "yes"]);

function readRequired(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new SmtpConfigError(`Missing required environment variable: ${name}`);
  }
  return raw.trim();
}

function parsePort(raw: string): number {
  const port = Number.parseInt(raw, 10);
  if (!Number.isFinite(port) || String(port) !== raw.trim() || port <= 0) {
    // Invalid port — treat as missing for a stable operator-facing message.
    // Never include the raw value (or password) in the message.
    throw new SmtpConfigError("Missing required environment variable: SMTP_PORT");
  }
  return port;
}

function parseSecure(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  return TRUTHY_SECURE.has(raw.trim().toLowerCase());
}

/**
 * Resolve SMTP settings from `process.env`.
 * Never includes the password in thrown messages.
 */
export function resolveSmtpConfig(): SmtpConfig {
  const host = readRequired("SMTP_HOST");
  const portRaw = readRequired("SMTP_PORT");
  const username = readRequired("SMTP_USERNAME");
  const password = readRequired("SMTP_PASSWORD");
  const port = parsePort(portRaw);

  const fromRaw = process.env.SMTP_FROM;
  const from =
    fromRaw !== undefined && fromRaw.trim() !== "" ? fromRaw.trim() : username;

  return {
    host,
    port,
    username,
    password,
    from,
    secure: parseSecure(process.env.SMTP_SECURE),
  };
}
