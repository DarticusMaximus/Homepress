"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ISSUE_LISTEN_ERROR_COPY,
  ISSUE_LISTEN_RATES,
} from "@/lib/issue-listen-constants";
import {
  createIssueListenPlayer,
  type IssueListenPlayer,
  type IssueListenPlayerStatus,
} from "@/lib/issue-listen-player";
import { packUtterances, toSpeakableText } from "@/lib/issue-listen-text";

const RATE_KEY = "homepress.issue-listen.rate";

export type UseIssueListenResult = {
  supported: boolean;
  status: IssueListenPlayerStatus;
  rate: number;
  error: string | null;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setRate: (rate: number) => void;
};

function isAllowedRate(value: number): value is (typeof ISSUE_LISTEN_RATES)[number] {
  return (ISSUE_LISTEN_RATES as readonly number[]).includes(value);
}

function coerceRate(raw: string | null): number {
  if (raw == null || raw === "") return 1;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "number" && isAllowedRate(parsed)) return parsed;
    if (typeof parsed === "string") {
      const n = Number(parsed);
      if (isAllowedRate(n)) return n;
    }
  } catch {
    // Not JSON — fall through to Number(raw).
  }

  const n = Number(raw);
  return isAllowedRate(n) ? n : 1;
}

function readStoredRate(): number {
  if (typeof window === "undefined") return 1;
  try {
    if (!window.localStorage) return 1;
    return coerceRate(window.localStorage.getItem(RATE_KEY));
  } catch {
    return 1;
  }
}

function writeStoredRate(rate: number): void {
  if (typeof window === "undefined") return;
  try {
    if (!window.localStorage) return;
    window.localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function detectSpeechSupport(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance === "function"
  );
}

/**
 * Issue TTS listen controls — device preferred SpeechSynthesis, cancel-based pause.
 * Support is detected after mount only (no SSR flash / hydration mismatch).
 */
export function useIssueListen(markdown: string): UseIssueListenResult {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<IssueListenPlayerStatus>("idle");
  const [rate, setRateState] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const playerRef = useRef<IssueListenPlayer | null>(null);

  useEffect(() => {
    if (!detectSpeechSupport()) return;

    const initialRate = readStoredRate();
    const player = createIssueListenPlayer({
      synth: window.speechSynthesis,
      utteranceCtor: SpeechSynthesisUtterance,
      onState: (state) => {
        setStatus(state.status);
        setRateState(state.rate);
      },
      onError: () => {
        setError(ISSUE_LISTEN_ERROR_COPY);
      },
    });
    // Applies rate + emits onState (updates rate without direct setState here).
    player.setRate(initialRate);
    playerRef.current = player;
    // Post-mount support flip — avoids SSR/hydration mismatch (no speechSynthesis on server).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional client-only detect
    setSupported(true);

    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, []);

  const play = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    // Clear error before speak so a retry after failure is clean; first speak
    // must run synchronously inside this click handler (player.play → synth.speak).
    setError(null);
    const chunks = packUtterances(toSpeakableText(markdown));
    player.play(chunks);
  }, [markdown]);

  const pause = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  const stop = useCallback(() => {
    setError(null);
    playerRef.current?.stop();
  }, []);

  const setRate = useCallback((nextRate: number) => {
    if (!isAllowedRate(nextRate)) return;
    writeStoredRate(nextRate);
    setRateState(nextRate);
    playerRef.current?.setRate(nextRate);
  }, []);

  return {
    supported,
    status,
    rate,
    error,
    play,
    pause,
    stop,
    setRate,
  };
}
