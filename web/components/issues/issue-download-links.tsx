type IssueDownloadLinksProps = {
  runId: string;
};

const quietLinkClassName =
  "text-sm text-muted-foreground hover:text-foreground hover:underline";

/**
 * Native download anchors for a completed issue (Markdown + HTML).
 * Success-path chrome only — Content-Disposition handles the download.
 */
export function IssueDownloadLinks({ runId }: IssueDownloadLinksProps) {
  return (
    <>
      <a
        href={`/api/issues/${runId}/export?format=md`}
        aria-label="Download Markdown"
        className={quietLinkClassName}
      >
        Markdown
      </a>
      <a
        href={`/api/issues/${runId}/export?format=html`}
        aria-label="Download HTML"
        className={quietLinkClassName}
      >
        HTML
      </a>
    </>
  );
}
