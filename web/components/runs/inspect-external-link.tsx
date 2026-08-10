/** Locked unavailable copy when a persisted link is not a safe HTTP(S) URL. */
const INSPECT_LINK_UNAVAILABLE = "Unavailable";

/**
 * Parse a candidate string and return a safe absolute URL only for `http:` /
 * `https:`. Empty, relative, malformed, or other-scheme values return null.
 */
export function toSafeHttpUrl(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (trimmed.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  return parsed.href;
}

/**
 * Inspect presentation boundary for untrusted external links.
 * Valid HTTP(S) → Open anchor (new tab, noopener noreferrer, title=URL).
 * Otherwise → plain unavailable text (no actionable href).
 */
export function InspectExternalLink({ href }: { href: string }): React.JSX.Element {
  const safe = toSafeHttpUrl(href);
  if (!safe) {
    return (
      <span className="text-muted-foreground">{INSPECT_LINK_UNAVAILABLE}</span>
    );
  }

  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      title={safe}
      className="text-primary underline-offset-4 hover:underline"
    >
      Open
    </a>
  );
}
