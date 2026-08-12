import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SmtpConfig } from "../../delivery/smtp-config";
import type { SettingsSource } from "../resolve-operator-settings";
import {
  diagnoseOpenRouterConnection,
  diagnosePublicUrl,
  diagnoseSmtpConnection,
} from "../connection-diagnostics";

const OPENROUTER_KEY = "sk-or-unit-test-secret-do-not-leak";
const SMTP_PASSWORD = "unit-test-smtp-password-do-not-leak";
const DEFAULT_OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const PUBLIC_URL = "https://app.example.com";

function smtpBundle(overrides: Partial<SmtpConfig> = {}): SmtpConfig {
  return {
    host: "smtp.example.com",
    port: 587,
    username: "ops@example.com",
    password: SMTP_PASSWORD,
    from: "news@example.com",
    secure: true,
    ...overrides,
  };
}

function keyResolved(
  value: string | null,
  source: SettingsSource = value === null ? "none" : "gui",
) {
  return { value, source };
}

function smtpResolved(
  value: SmtpConfig | null,
  source: SettingsSource = value === null ? "none" : "gui",
) {
  return { value, source };
}

function urlResolved(
  value: string | null,
  source: SettingsSource = value === null ? "none" : "gui",
) {
  return { value, source };
}

describe("diagnoseOpenRouterConnection", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails immediately when API key source is none — no fetch", async () => {
    const result = await diagnoseOpenRouterConnection({
      openRouterApiKey: keyResolved(null, "none"),
      fetch: fetchMock,
    });

    expect(result.status).toBe("fail");
    expect(result.message).toMatch(/OpenRouter API key is not set/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GETs {baseUrl}/key with Bearer auth and passes on 2xx", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await diagnoseOpenRouterConnection({
      openRouterApiKey: keyResolved(OPENROUTER_KEY, "gui"),
      fetch: fetchMock,
    });

    expect(result.status).toBe("pass");
    expect(result.message.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(OPENROUTER_KEY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${DEFAULT_OPENROUTER_BASE}/key`);
    expect(String(url)).not.toContain("/chat/completions");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${OPENROUTER_KEY}`);
  });

  it("fails on 401 with a sanitized operator-readable message (no key leak)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: `bad ${OPENROUTER_KEY}` } }), {
        status: 401,
      }),
    );

    const result = await diagnoseOpenRouterConnection({
      openRouterApiKey: keyResolved(OPENROUTER_KEY, "env"),
      fetch: fetchMock,
    });

    expect(result.status).toBe("fail");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).not.toContain(OPENROUTER_KEY);
    expect(JSON.stringify(result)).not.toContain(OPENROUTER_KEY);
  });

  it("fails on network/timeout errors without calling chat completions", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const result = await diagnoseOpenRouterConnection({
      openRouterApiKey: keyResolved(OPENROUTER_KEY),
      fetch: fetchMock,
    });

    expect(result.status).toBe("fail");
    expect(result.message.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(OPENROUTER_KEY);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/chat/completions");
    }
  });
});

describe("diagnoseSmtpConnection", () => {
  it("fails when SMTP source is none — no sendMail", async () => {
    const sendMail = vi.fn();
    const createTransport = vi.fn(() => ({ sendMail }));

    const result = await diagnoseSmtpConnection({
      smtp: smtpResolved(null, "none"),
      createTransport,
    });

    expect(result.status).toBe("fail");
    expect(result.message).toMatch(/SMTP is not configured/i);
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends a real test email with to === from and passes on sendMail success", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "test-1" });
    const createTransport = vi.fn(() => ({ sendMail }));
    const config = smtpBundle();

    const result = await diagnoseSmtpConnection({
      smtp: smtpResolved(config, "gui"),
      createTransport,
    });

    expect(result.status).toBe("pass");
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0]![0] as {
      to: string;
      from: string;
      subject?: string;
    };
    expect(mail.to).toBe(config.from);
    expect(mail.from).toBe(config.from);
    expect(mail.to).toBe(mail.from);
    expect(JSON.stringify(result)).not.toContain(SMTP_PASSWORD);
  });

  it("fails on sendMail error and never includes the password in the message", async () => {
    const sendMail = vi.fn().mockRejectedValue(
      new Error(`Auth failed for password=${SMTP_PASSWORD}`),
    );
    const createTransport = vi.fn(() => ({ sendMail }));

    const result = await diagnoseSmtpConnection({
      smtp: smtpResolved(smtpBundle(), "env"),
      createTransport,
    });

    expect(result.status).toBe("fail");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).not.toContain(SMTP_PASSWORD);
    expect(JSON.stringify(result)).not.toContain(SMTP_PASSWORD);
  });
});

describe("diagnosePublicUrl", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("fails when public URL is unset / source none — no fetch", async () => {
    const result = await diagnosePublicUrl({
      appPublicUrl: urlResolved(null, "none"),
      fetch: fetchMock,
    });

    expect(result.status).toBe("fail");
    expect(result.message).toMatch(/Public URL is not set/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails when URL is not absolute http(s)", async () => {
    const result = await diagnosePublicUrl({
      appPublicUrl: urlResolved("ftp://not-http.example", "gui"),
      fetch: fetchMock,
    });

    expect(result.status).toBe("fail");
    expect(result.message.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes on 2xx GET of the resolved base URL", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const result = await diagnosePublicUrl({
      appPublicUrl: urlResolved(PUBLIC_URL, "gui"),
      fetch: fetchMock,
    });

    expect(result.status).toBe("pass");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(PUBLIC_URL);
  });

  it("warns (not fails) on network/timeout/non-2xx and includes the resolved URL", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const network = await diagnosePublicUrl({
      appPublicUrl: urlResolved(PUBLIC_URL, "env"),
      fetch: fetchMock,
    });
    expect(network.status).toBe("warn");
    expect(network.message).toMatch(/could not reach/i);
    expect(network.message).toMatch(/browsers|RSS/i);
    expect(network.message).toContain(PUBLIC_URL);

    fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));
    const non2xx = await diagnosePublicUrl({
      appPublicUrl: urlResolved(PUBLIC_URL, "gui"),
      fetch: fetchMock,
    });
    expect(non2xx.status).toBe("warn");
    expect(non2xx.message).toContain(PUBLIC_URL);
    expect(non2xx.status).not.toBe("fail");
  });

  it("still checks private LAN base URLs (no full public-routability gate on configured base)", async () => {
    const lanUrl = "http://192.168.1.50:3000";
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const result = await diagnosePublicUrl({
      appPublicUrl: urlResolved(lanUrl, "env"),
      fetch: fetchMock,
    });

    expect(result.status).toBe("pass");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(lanUrl);
  });

  it("warns without fetching when configured URL is literal cloud metadata / link-local", async () => {
    for (const blocked of [
      "http://169.254.169.254/",
      "http://metadata.google.internal/",
      "http://[fe80::1]/",
    ]) {
      fetchMock.mockReset();
      const result = await diagnosePublicUrl({
        appPublicUrl: urlResolved(blocked, "gui"),
        fetch: fetchMock,
      });
      expect(result.status).toBe("warn");
      expect(result.message).toContain(blocked);
      expect(result.message).toMatch(/could not reach|browsers|RSS/i);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("warns on cross-host redirect to metadata without requesting the blocked hop", async () => {
    const metadataUrl = "http://169.254.169.254/";
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: metadataUrl },
      }),
    );

    const result = await diagnosePublicUrl({
      appPublicUrl: urlResolved(PUBLIC_URL, "gui"),
      fetch: fetchMock,
    });

    expect(result.status).toBe("warn");
    expect(result.message).toContain(PUBLIC_URL);
    expect(result.status).not.toBe("pass");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(PUBLIC_URL);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("169.254.169.254");
    }
  });

  it("warns on cross-host redirect to metadata.google.internal without fetching it", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "http://metadata.google.internal/latest" },
      }),
    );

    const result = await diagnosePublicUrl({
      appPublicUrl: urlResolved(PUBLIC_URL, "env"),
      fetch: fetchMock,
    });

    expect(result.status).toBe("warn");
    expect(result.message).toContain(PUBLIC_URL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("metadata.google.internal");
    }
  });

  it("allows same-host redirects and still passes on final 2xx", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: `${PUBLIC_URL}/health` },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const result = await diagnosePublicUrl({
      appPublicUrl: urlResolved(PUBLIC_URL, "gui"),
      fetch: fetchMock,
    });

    expect(result.status).toBe("pass");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(PUBLIC_URL);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(`${PUBLIC_URL}/health`);
  });

  it("caps redirects and warns instead of following unbounded chains", async () => {
    for (let i = 0; i < 8; i++) {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: `${PUBLIC_URL}/hop-${i + 1}` },
        }),
      );
    }

    const result = await diagnosePublicUrl({
      appPublicUrl: urlResolved(PUBLIC_URL, "gui"),
      fetch: fetchMock,
    });

    expect(result.status).toBe("warn");
    expect(result.message).toContain(PUBLIC_URL);
    // initial + at most 5 redirect hops followed
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("connection diagnostics — secrets never leak", () => {
  it("OpenRouter and SMTP result messages never contain key or password strings", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`upstream rejected ${OPENROUTER_KEY}`));
    const openRouter = await diagnoseOpenRouterConnection({
      openRouterApiKey: keyResolved(OPENROUTER_KEY),
      fetch: fetchMock,
    });
    expect(JSON.stringify(openRouter)).not.toContain(OPENROUTER_KEY);

    const sendMail = vi
      .fn()
      .mockRejectedValue(new Error(`SMTP auth failed: ${SMTP_PASSWORD}`));
    const smtp = await diagnoseSmtpConnection({
      smtp: smtpResolved(smtpBundle()),
      createTransport: () => ({ sendMail }),
    });
    expect(JSON.stringify(smtp)).not.toContain(SMTP_PASSWORD);
  });
});
