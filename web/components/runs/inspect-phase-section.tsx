import type { ReactNode } from "react";
import type {
  FetchCheckpoint,
  PhaseFailureSummaryJson,
  ScrapeCheckpoint,
  ScrapeSummaryJson,
  ScoreCheckpoint,
  TagCheckpoint,
} from "@newsletter/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  InspectBasicArticleList,
  InspectScoredArticleList,
  InspectTaggedArticleList,
  sortScoredDescending,
} from "@/components/runs/inspect-article-list";
import { InspectPhaseFailureBlock } from "@/components/runs/inspect-phase-failure";
import { PhaseSectionChrome } from "@/components/runs/inspect-phase-chrome";

/** Per-phase load outcome for Inspect section props (Feature 05). */
export type PhaseLoadResult<T> =
  | { status: "loaded"; data: T }
  | { status: "missing" }
  | { status: "error" };

/** Locked copy — Feature 05. */
export const PHASE_MISSING_COPY = "No checkpoint for this phase yet.";
export const PHASE_EMPTY_COPY = "No articles in this checkpoint.";
/** Locked error copy — curly apostrophe (U+2019). */
export const PHASE_ERROR_COPY = "Couldn\u2019t load this phase.";

export function formatScrapeSummaryLine(summary: ScrapeSummaryJson): string {
  return `Extracted ${summary.extracted} · Fallback ${summary.fallback} · Total ${summary.total}`;
}

function PhaseBody({
  result,
  emptyList,
  renderList,
}: {
  result: PhaseLoadResult<unknown>;
  emptyList: boolean;
  renderList: () => ReactNode;
}): React.JSX.Element {
  if (result.status === "missing") {
    return <p className="text-sm text-muted-foreground">{PHASE_MISSING_COPY}</p>;
  }
  if (result.status === "error") {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{PHASE_ERROR_COPY}</AlertDescription>
      </Alert>
    );
  }
  if (emptyList) {
    return <p className="text-sm text-muted-foreground">{PHASE_EMPTY_COPY}</p>;
  }
  return <>{renderList()}</>;
}

type FetchedSectionProps = {
  result: PhaseLoadResult<FetchCheckpoint>;
  /** Optional Failed feeds sub-line under the heading when non-empty. */
  failedFeedsSubline?: ReactNode;
};

export function InspectFetchedSection({
  result,
  failedFeedsSubline,
}: FetchedSectionProps): React.JSX.Element {
  const count = result.status === "loaded" ? result.data.articles.length : null;
  const emptyList = result.status === "loaded" && result.data.articles.length === 0;

  return (
    <PhaseSectionChrome
      label="Fetched"
      count={count}
      subline={result.status === "loaded" ? failedFeedsSubline : undefined}
    >
      <PhaseBody
        result={result}
        emptyList={emptyList}
        renderList={() => {
          if (result.status !== "loaded") return null;
          return <InspectBasicArticleList articles={result.data.articles} />;
        }}
      />
    </PhaseSectionChrome>
  );
}

type ScrapedSectionProps = {
  result: PhaseLoadResult<ScrapeCheckpoint>;
};

export function InspectScrapedSection({ result }: ScrapedSectionProps): React.JSX.Element {
  const count = result.status === "loaded" ? result.data.articles.length : null;
  const emptyList = result.status === "loaded" && result.data.articles.length === 0;
  const summaryLine =
    result.status === "loaded" ? formatScrapeSummaryLine(result.data.summary) : null;

  return (
    <PhaseSectionChrome
      label="Scraped"
      count={count}
      subline={
        summaryLine ? <p className="text-sm text-muted-foreground">{summaryLine}</p> : undefined
      }
    >
      <PhaseBody
        result={result}
        emptyList={emptyList}
        renderList={() => {
          if (result.status !== "loaded") return null;
          return <InspectBasicArticleList articles={result.data.articles} />;
        }}
      />
    </PhaseSectionChrome>
  );
}

/**
 * Tag/score body: when `phaseFailure` is present, always render the halt
 * summary + failure list first. Empty success lists still show PHASE_EMPTY_COPY
 * *in addition* — never replace the section with empty copy alone.
 */
function TagScorePhaseBody({
  result,
  emptyList,
  phaseFailure,
  renderList,
}: {
  result: PhaseLoadResult<unknown>;
  emptyList: boolean;
  phaseFailure: PhaseFailureSummaryJson | undefined;
  renderList: () => ReactNode;
}): React.JSX.Element {
  if (result.status === "missing") {
    return <p className="text-sm text-muted-foreground">{PHASE_MISSING_COPY}</p>;
  }
  if (result.status === "error") {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{PHASE_ERROR_COPY}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      {phaseFailure ? <InspectPhaseFailureBlock phaseFailure={phaseFailure} /> : null}
      {emptyList ? (
        <p className="text-sm text-muted-foreground">{PHASE_EMPTY_COPY}</p>
      ) : (
        renderList()
      )}
    </>
  );
}

type TaggedSectionProps = {
  result: PhaseLoadResult<TagCheckpoint>;
};

export function InspectTaggedSection({ result }: TaggedSectionProps): React.JSX.Element {
  const count = result.status === "loaded" ? result.data.taggedArticles.length : null;
  const emptyList = result.status === "loaded" && result.data.taggedArticles.length === 0;
  const phaseFailure =
    result.status === "loaded" ? result.data.phaseFailure : undefined;

  return (
    <PhaseSectionChrome label="Tagged" count={count}>
      <TagScorePhaseBody
        result={result}
        emptyList={emptyList}
        phaseFailure={phaseFailure}
        renderList={() => {
          if (result.status !== "loaded") return null;
          return <InspectTaggedArticleList articles={result.data.taggedArticles} />;
        }}
      />
    </PhaseSectionChrome>
  );
}

type ScoredSectionProps = {
  result: PhaseLoadResult<ScoreCheckpoint>;
};

export function InspectScoredSection({ result }: ScoredSectionProps): React.JSX.Element {
  const count = result.status === "loaded" ? result.data.scoredArticles.length : null;
  const emptyList = result.status === "loaded" && result.data.scoredArticles.length === 0;
  const phaseFailure =
    result.status === "loaded" ? result.data.phaseFailure : undefined;

  return (
    <PhaseSectionChrome label="Scored" count={count}>
      <TagScorePhaseBody
        result={result}
        emptyList={emptyList}
        phaseFailure={phaseFailure}
        renderList={() => {
          if (result.status !== "loaded") return null;
          const sorted = sortScoredDescending(result.data.scoredArticles);
          return <InspectScoredArticleList articles={sorted} />;
        }}
      />
    </PhaseSectionChrome>
  );
}
