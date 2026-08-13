"use client";

import { Button } from "@/components/ui/button";
import { useIssueListen } from "@/hooks/use-issue-listen";
import {
  ISSUE_LISTEN_ERROR_COPY,
  ISSUE_LISTEN_RATES,
} from "@/lib/issue-listen-constants";

export const ISSUE_LISTEN_REGION_LABEL = "Listen to issue";
export const ISSUE_LISTEN_PLAY_LABEL = "Play";
export const ISSUE_LISTEN_PAUSE_LABEL = "Pause";
export const ISSUE_LISTEN_STOP_LABEL = "Stop";
export { ISSUE_LISTEN_ERROR_COPY, ISSUE_LISTEN_RATES };

type IssueListenBarProps = {
  markdown: string;
};

function rateLabel(rate: number): string {
  return `${rate}×`;
}

/**
 * Fixed bottom listen controls for the Issues reader — play / pause / stop + rate.
 * Hidden when SpeechSynthesis is unavailable. Spacer keeps markdown above the bar.
 */
export function IssueListenBar({ markdown }: IssueListenBarProps) {
  const { supported, status, rate, error, play, pause, stop, setRate } =
    useIssueListen(markdown);

  if (!supported) return null;

  const playPauseLabel =
    status === "playing" ? ISSUE_LISTEN_PAUSE_LABEL : ISSUE_LISTEN_PLAY_LABEL;

  return (
    <>
      {/* In-flow spacer so last markdown is not hidden under the fixed bar */}
      <div
        aria-hidden
        className="min-h-28 shrink-0"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      />
      <div
        role="region"
        aria-label={ISSUE_LISTEN_REGION_LABEL}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div className="mx-auto flex min-h-28 w-full max-w-prose flex-col justify-center gap-2 px-4 py-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (status === "playing") pause();
                else play();
              }}
            >
              {playPauseLabel}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={status === "idle"}
              onClick={() => stop()}
            >
              {ISSUE_LISTEN_STOP_LABEL}
            </Button>
          </div>
          <div className="flex w-full flex-wrap items-center gap-1">
            {ISSUE_LISTEN_RATES.map((r) => (
              <Button
                key={r}
                type="button"
                size="sm"
                variant="outline"
                aria-label={rateLabel(r)}
                aria-pressed={rate === r}
                onClick={() => setRate(r)}
              >
                {rateLabel(r)}
              </Button>
            ))}
          </div>
          {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
        </div>
      </div>
    </>
  );
}
