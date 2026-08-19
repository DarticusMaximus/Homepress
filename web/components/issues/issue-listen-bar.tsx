"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useIssueListen } from "@/hooks/use-issue-listen";
import {
  ISSUE_LISTEN_ERROR_COPY,
  ISSUE_LISTEN_RATES,
} from "@/lib/issue-listen-constants";
import { ISSUE_READER_COLUMN_CLASS } from "@/lib/issue-reader-layout";

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
 * Fixed bottom listen controls for the Issues reader.
 * Idle: Play only. Active: Play/Pause, Stop, current rate.
 * Hidden when SpeechSynthesis is unavailable. Spacer keeps markdown above the bar.
 */
export function IssueListenBar({ markdown }: IssueListenBarProps) {
  const { supported, status, rate, error, play, pause, stop, setRate } =
    useIssueListen(markdown);
  const [ratesOpen, setRatesOpen] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const currentRateButtonRef = useRef<HTMLButtonElement>(null);
  const prevStatusRef = useRef(status);

  // Reset on idle during render (not an effect) so the next Play does not reopen the panel.
  if (status === "idle" && ratesOpen) {
    setRatesOpen(false);
  }

  // Status-driven: Stop click, last-chunk onend, and TTS onerror all collapse to idle.
  // Unmount dumps focus to body; restore to Play unless the caret is in the issue body.
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status !== "idle" || prev === "idle") return;

    const activeEl = document.activeElement;
    const region = regionRef.current;
    const dumpedToBody = activeEl === document.body;
    const insideRegion =
      region != null && activeEl instanceof Node && region.contains(activeEl);

    if ((dumpedToBody || insideRegion) && playButtonRef.current) {
      playButtonRef.current.focus();
    }
  }, [status]);

  if (!supported) return null;

  const active = status === "playing" || status === "paused";
  const playPauseLabel =
    status === "playing" ? ISSUE_LISTEN_PAUSE_LABEL : ISSUE_LISTEN_PLAY_LABEL;

  return (
    <>
      {/* In-flow spacer so last markdown is not hidden under the fixed bar */}
      <div
        aria-hidden
        className="min-h-14 shrink-0"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      />
      <div
        ref={regionRef}
        role="region"
        aria-label={ISSUE_LISTEN_REGION_LABEL}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div
          className={`relative ${ISSUE_READER_COLUMN_CLASS} flex min-h-14 flex-row flex-wrap items-center gap-2 px-4 py-2`}
        >
          <Button
            ref={playButtonRef}
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
          {active ? (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => stop()}>
                {ISSUE_LISTEN_STOP_LABEL}
              </Button>
              <Button
                ref={currentRateButtonRef}
                type="button"
                size="sm"
                variant="outline"
                aria-label={rateLabel(rate)}
                aria-pressed="true"
                aria-expanded={ratesOpen}
                aria-controls="issue-listen-rates"
                onClick={() => setRatesOpen((open) => !open)}
              >
                {rateLabel(rate)}
              </Button>
            </>
          ) : null}
          {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
          {ratesOpen && active ? (
            <div
              id="issue-listen-rates"
              role="group"
              aria-label="Playback speed"
              className="absolute inset-x-0 bottom-full flex flex-row flex-wrap items-center gap-2 border-t bg-background px-4 py-2"
            >
              {ISSUE_LISTEN_RATES.filter((r) => r !== rate).map((r) => (
                <Button
                  key={r}
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={rateLabel(r)}
                  onClick={() => {
                    setRate(r);
                    setRatesOpen(false);
                    currentRateButtonRef.current?.focus();
                  }}
                >
                  {rateLabel(r)}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
