import {
  getRun,
  getServerAppwrite,
  isEligibleIssue,
  IssueLoadError,
  loadIssueDraft,
  type Run,
} from "@newsletter/shared";
import {
  IssueReader,
  IssueReaderLoadErrorBare,
  IssueReaderNotAvailable,
} from "@/components/issues/issue-reader";

type IssueDetailViewProps = {
  runId: string;
  showOps: boolean;
};

type LoadResult =
  | { kind: "success"; run: Run; markdown: string }
  | { kind: "not_available" }
  | { kind: "load_error"; run: Run | null };

function logIssueLoadFailure(err: unknown): void {
  if (err instanceof IssueLoadError) {
    console.error({
      phase: "issues/[runId]",
      code: err.code,
      message: err.message,
    });
    return;
  }
  console.error({
    phase: "issues/[runId]",
    message: err instanceof Error ? err.message : String(err),
  });
}

/** Best-effort chrome for load-error when draft failed after eligibility. */
async function tryEligibleRunForChrome(
  client: ReturnType<typeof getServerAppwrite>,
  runId: string,
): Promise<Run | null> {
  try {
    const run = await getRun(client, runId);
    return isEligibleIssue(run) ? run : null;
  } catch {
    return null;
  }
}

async function loadIssuePage(runId: string): Promise<LoadResult> {
  const client = getServerAppwrite();

  try {
    const { run, markdown } = await loadIssueDraft(client, runId);
    return { kind: "success", run, markdown };
  } catch (err) {
    if (err instanceof IssueLoadError && (err.code === "not_found" || err.code === "not_eligible")) {
      return { kind: "not_available" };
    }

    // Eligible draft load failure (checkpoint_missing / appwrite) or unexpected.
    logIssueLoadFailure(err);
    const run = await tryEligibleRunForChrome(client, runId);
    return { kind: "load_error", run };
  }
}

export async function IssueDetailView({ runId, showOps }: IssueDetailViewProps) {
  const result = await loadIssuePage(runId);

  if (result.kind === "not_available") {
    return (
      <main>
        <IssueReaderNotAvailable showOps={showOps} />
      </main>
    );
  }

  if (result.kind === "load_error") {
    return (
      <main>
        {result.run ? (
          <IssueReader run={result.run} runId={result.run.$id} loadError showOps={showOps} />
        ) : (
          <IssueReaderLoadErrorBare showOps={showOps} />
        )}
      </main>
    );
  }

  return (
    <main>
      <IssueReader
        run={result.run}
        runId={result.run.$id}
        markdown={result.markdown}
        showOps={showOps}
      />
    </main>
  );
}
