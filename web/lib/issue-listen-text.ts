/** Default utterance packing budget — Chromium stalls on huge SpeechSynthesis chunks. */
export const ISSUE_LISTEN_WORD_BUDGET = 200;

/**
 * Strip issue-draft markdown down to plain prose suitable for TTS.
 * No markdown-to-text dependency — small regex transforms only.
 */
export function toSpeakableText(markdown: string): string {
  let text = markdown;

  // Fenced code blocks → inner text (drop the language tag line).
  text = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1");

  // Images removed entirely (do not speak alt).
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  text = text.replace(/!\[[^\]]*\]\[[^\]]*\]/g, "");

  // Links → label only (never the URL).
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");

  // Autolinks <http…> and bare http(s) URLs.
  text = text.replace(/<https?:\/\/[^>\s]+>/gi, "");
  text = text.replace(/https?:\/\/[^\s<>\]]+/gi, "");

  // ATX headings → heading text only.
  text = text.replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, "$1");

  // Setext headings → heading text; drop underline.
  text = text.replace(/^(.+)\n(?:=+|-+)[ \t]*$/gm, "$1");

  // Blockquote markers.
  text = text.replace(/^>[ \t]?/gm, "");

  // List markers (`-`, `*`, `1.`); keep item text.
  text = text.replace(/^([ \t]*)[-*][ \t]+/gm, "$1");
  text = text.replace(/^([ \t]*)\d+\.[ \t]+/gm, "$1");

  // Table separator rows.
  text = text.replace(/^[ \t]*\|?[:\-| \t]+\|[ \t]*$/gm, "");
  // Table rows: keep cell text with spaces between cells.
  text = text.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_match, cells: string) =>
    cells
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean)
      .join(" "),
  );
  text = text.replace(/\|/g, " ");

  // HTML tags.
  text = text.replace(/<\/?[^>]+>/g, "");

  // Inline code → code text.
  text = text.replace(/`([^`]+)`/g, "$1");

  // Emphasis / strikethrough markers; keep inner text.
  text = text.replace(/\*\*(.+?)\*\*/g, "$1");
  text = text.replace(/__(.+?)__/g, "$1");
  text = text.replace(/~~(.+?)~~/g, "$1");
  text = text.replace(/\*(.+?)\*/g, "$1");
  text = text.replace(/_(.+?)_/g, "$1");

  return text.replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Split on sentence endings (`.` `?` `!` before whitespace/end) or newline boundaries.
 */
function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const sentences: string[] = [];
  let buf = "";

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;

    if (ch === "\n") {
      if (buf.trim()) sentences.push(buf.trim());
      buf = "";
      continue;
    }

    buf += ch;

    if (
      (ch === "." || ch === "?" || ch === "!") &&
      (i === trimmed.length - 1 || /\s/.test(trimmed[i + 1]!))
    ) {
      sentences.push(buf.trim());
      buf = "";
      while (i + 1 < trimmed.length && /\s/.test(trimmed[i + 1]!)) {
        i++;
      }
    }
  }

  if (buf.trim()) sentences.push(buf.trim());
  return sentences;
}

/**
 * Pack consecutive sentences into chunks while wordCount(chunk + next) ≤ wordBudget.
 * An oversized single sentence is one chunk. Empty text → [].
 */
export function packUtterances(
  text: string,
  wordBudget: number = ISSUE_LISTEN_WORD_BUDGET,
): string[] {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }

    const candidate = `${current} ${sentence}`;
    if (wordCount(candidate) <= wordBudget) {
      current = candidate;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
