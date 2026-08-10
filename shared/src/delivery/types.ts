/**
 * Result of {@link sendIssueEmail} (implemented in Task 4).
 * Business failures resolve to `{ ok: false }` — they do not throw.
 */
export type SendIssueEmailResult =
  | { ok: true; recipientCount: number }
  | { ok: false; error: string };

/**
 * Result of {@link publishIssueToRss}.
 * Business failures resolve to `{ ok: false }` — they do not throw.
 */
export type PublishIssueToRssResult =
  | { ok: true; newsletterId: string; runId: string }
  | { ok: false; error: string };
