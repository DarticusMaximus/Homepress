import {
  getRun,
  getServerAppwrite,
  parseRunFailedFeeds,
  parseSuppressSummary,
  RunRepositoryError,
  sanitizeAppwriteMessageForLog,
  type Run,
} from "@newsletter/shared";
import {
  InspectShell,
  InspectShellLoadError,
  InspectShellNotAvailable,
  INSPECT_LOAD_ERROR_COPY,
} from "@/components/runs/inspect-shell";
import {
  loadInspectDraft,
  loadInspectPhases,
  loadInspectSelection,
  loadPriorRunLookupForSuppress,
} from "@/components/runs/load-inspect-phases";

type InspectPageProps = {
  params: Promise<{ runId: string }>;
};

type LoadResult =
  | { kind: "success"; run: Run }
  | { kind: "not_available" }
  | { kind: "load_error"; message: string };

function logInspectLoadFailure(err: unknown): void {
  if (err instanceof RunRepositoryError) {
    console.error({
      phase: "runs/[runId]/inspect",
      code: err.code,
      message: sanitizeAppwriteMessageForLog(err.message),
    });
    return;
  }
  console.error({
    phase: "runs/[runId]/inspect",
    message: sanitizeAppwriteMessageForLog(
      err instanceof Error ? err.message : String(err),
    ),
  });
}

async function loadInspectPage(runId: string): Promise<LoadResult> {
  try {
    const run = await getRun(getServerAppwrite(), runId);
    return { kind: "success", run };
  } catch (err) {
    if (err instanceof RunRepositoryError && err.code === "not_found") {
      return { kind: "not_available" };
    }

    logInspectLoadFailure(err);
    const message =
      err instanceof RunRepositoryError ? err.message : INSPECT_LOAD_ERROR_COPY;
    return { kind: "load_error", message };
  }
}

function failedFeedsSublineFor(run: Run) {
  const failures = parseRunFailedFeeds(run.failedFeeds);
  if (failures.length === 0) return undefined;

  const urls = failures.map((f) => f.feedUrl).filter((url) => url.length > 0);
  if (urls.length === 0) return undefined;

  const label =
    urls.length === 1 ? urls[0] : `${urls.length} feeds failed (${urls.join(", ")})`;

  return (
    <p className="text-sm text-muted-foreground" title={urls.join(", ")}>
      Failed feeds: {label}
    </p>
  );
}

export default async function InspectPage({ params }: InspectPageProps) {
  const { runId } = await params;
  const result = await loadInspectPage(runId);

  if (result.kind === "not_available") {
    return (
      <main>
        <InspectShellNotAvailable />
      </main>
    );
  }

  if (result.kind === "load_error") {
    return (
      <main>
        <InspectShellLoadError message={result.message} />
      </main>
    );
  }

  const client = getServerAppwrite();
  const suppressSummary = parseSuppressSummary(result.run.suppressSummary);
  // Selection loaded once and shared with Feature 06 audit + Feature 07 Draft.
  const [phases, selectionResult, draftResult, runLookup] = await Promise.all([
    loadInspectPhases(client, result.run),
    loadInspectSelection(client, result.run),
    loadInspectDraft(client, result.run),
    loadPriorRunLookupForSuppress(client, suppressSummary),
  ]);

  return (
    <main>
      <InspectShell
        run={result.run}
        fetchResult={phases.fetch}
        scrapeResult={phases.scrape}
        tagResult={phases.tag}
        scoreResult={phases.score}
        selectionResult={selectionResult}
        draftResult={draftResult}
        suppressSummary={suppressSummary}
        runLookup={runLookup}
        failedFeedsSubline={failedFeedsSublineFor(result.run)}
      />
    </main>
  );
}
