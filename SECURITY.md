# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Preferred path: use [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security Advisories) on this repository if it is enabled.

If private reporting is unavailable, open a GitHub Security Advisory draft or email the maintainer privately. Do not post secrets, API keys, or exploit details in public issues or pull requests.

## Secrets and local config

Never commit:

- `.env` (or any file with live credentials)
- API keys (`APPWRITE_API_KEY`, `OPENROUTER_API_KEY`, SMTP passwords, etc.)
- MCP configs that embed secrets (for example `opencode.json`, local `.cursor/mcp.json`)
- Local editor/agent folders (`.cursor/`, `.opencode/`, `.grok/`, `.codegraph/`)

Use `.env.example` and `opencode.json.example` as templates only. Fill real values in local, gitignored files.

## If secrets were exposed

Rotate immediately:

1. **Appwrite** — revoke/regenerate the project API key and update `.env` / deploy env.
2. **OpenRouter** — revoke/regenerate `OPENROUTER_API_KEY` and update env.
3. Any other leaked credentials (SMTP, tokens) — rotate those too.

Then redeploy or restart services so they pick up the new values.

## Public health endpoint

`GET /health` is intentionally **minimal**. Success returns `{ "status": "ok" }`; failure returns HTTP 503 with `{ "status": "degraded", "message": "Appwrite handshake failed" }`. It must **not** expose Appwrite endpoint, project IDs, API keys, or other infrastructure details.

## Remote content policy

No channel renders remote images: email HTML, RSS `htmlBody`, HTML export, and the reader/Inspect markdown view all drop `<img>`. Emitted links carry `rel="nofollow noreferrer"` (the reader/Inspect view also keeps `noopener` because those anchors open in a new tab).

Policy is enforced at **render time**. Stored drafts keep their source markdown; we do not rewrite persisted issues. The operator-authenticated raw `.md` export is unchanged. Listen (TTS) and the plain-text email part do not fetch images.

Rationale: no hot-linking scraped assets, no tracking pixels / device fingerprinting, and phishing hardening on outbound links.
