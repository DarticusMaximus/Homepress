import type { Client } from "node-appwrite";

import { loadIssueDraft } from "../runs/issues";
import { draftMarkdownToEmailHtml, draftMarkdownToEmailText } from "./email-body";

export type IssueExportFormat = "md" | "html";

export type IssueExportPayload = {
  body: string;
  contentType: string;
  filename: string;
};

const SLUG_MAX_LENGTH = 48;
const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

function slugifyNewsletterName(newsletterName: string): string {
  const slug = newsletterName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug === "") {
    return "newsletter";
  }

  return slug.slice(0, SLUG_MAX_LENGTH);
}

function utcCalendarDate(dateIso: string): string {
  const match = ISO_DATE_PREFIX.exec(dateIso);
  if (match) {
    return match[1]!;
  }

  const d = new Date(dateIso);
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Build a download filename from newsletter name + UTC calendar date + format.
 */
export function buildIssueExportFilename(opts: {
  newsletterName: string;
  dateIso: string;
  format: IssueExportFormat;
}): string {
  const slug = slugifyNewsletterName(opts.newsletterName);
  const date = utcCalendarDate(opts.dateIso);
  const ext = opts.format === "md" ? "md" : "html";
  return `${slug}-${date}.${ext}`;
}

/**
 * Load an issue draft and prepare a downloadable export payload (md or html).
 * Uses `run.newsletterName` for the filename — does not call getNewsletter.
 * No Appwrite writes, SMTP, or RSS.
 */
export async function prepareIssueExport(
  client: Client,
  runId: string,
  format: IssueExportFormat,
): Promise<IssueExportPayload> {
  const { run, markdown } = await loadIssueDraft(client, runId);

  if (markdown.trim() === "") {
    throw new Error("Issue draft is empty");
  }

  const dateIso = run.endedAt ?? run.startedAt;
  const filename = buildIssueExportFilename({
    newsletterName: run.newsletterName,
    dateIso,
    format,
  });

  if (format === "md") {
    return {
      body: draftMarkdownToEmailText(markdown),
      contentType: "text/markdown; charset=utf-8",
      filename,
    };
  }

  return {
    body: draftMarkdownToEmailHtml(markdown),
    contentType: "text/html; charset=utf-8",
    filename,
  };
}
