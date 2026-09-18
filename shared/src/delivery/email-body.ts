import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

/** Dedicated instance so we don't mutate marked's global defaults. */
const emailMarked = new Marked({
  gfm: true,
  breaks: false,
  pedantic: false,
});

/**
 * Email/RSS HTML allowlist: GFM structural tags plus safe link attrs.
 * Scripts, event handlers, images, and non-http(s)/mailto URL schemes are
 * stripped. Remote-content policy (S14): no `<img>` in any static channel;
 * every `<a>` is rewritten with `rel="nofollow noreferrer"` (and `rel` is
 * allowlisted so sanitize-html does not strip the transform).
 */
const EMAIL_HTML_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "br",
    "hr",
    "blockquote",
    "ul",
    "ol",
    "li",
    "a",
    "strong",
    "em",
    "b",
    "i",
    "del",
    "s",
    "code",
    "pre",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel"],
    th: ["align"],
    td: ["align"],
    code: ["class"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "nofollow noreferrer" }),
  },
};

/**
 * Convert draft markdown to an email-safe HTML fragment suitable as Nodemailer
 * `html`, RSS `htmlBody`, and HTML export.
 *
 * Parses GFM (headings, lists, links, emphasis, fenced code, tables), then
 * sanitizes with an email/RSS allowlist: strips scripts, event-handler
 * attributes, images, and dangerous URL schemes (`javascript:`, `data:`, etc.).
 * Only `http` / `https` / `mailto` links are kept; every emitted `<a>` carries
 * `rel="nofollow noreferrer"`. Remote images are dropped at render time so
 * subscriber devices never fetch attacker-chosen URLs.
 *
 * Callers (email, RSS snapshot, HTML export) must reuse this helper unchanged
 * so the three channels stay byte-equal for the same markdown.
 */
export function draftMarkdownToEmailHtml(markdown: string): string {
  const raw = emailMarked.parse(markdown, { async: false }) as string;
  return sanitizeHtml(raw, EMAIL_HTML_SANITIZE_OPTIONS);
}

/**
 * Plain-text email part: draft markdown as-is after normalizing `\r\n` → `\n`.
 */
export function draftMarkdownToEmailText(markdown: string): string {
  return markdown.replace(/\r\n/g, "\n");
}
