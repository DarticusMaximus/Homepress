export type IssueListenPlayerStatus = "idle" | "playing" | "paused";

export type IssueListenPlayerState = {
  status: IssueListenPlayerStatus;
  chunkIndex: number;
  rate: number;
};

/** Minimal SpeechSynthesis surface — tests inject a fake; production uses window.speechSynthesis. */
export type IssueListenSynth = {
  // Injectable: real SpeechSynthesis or a FakeUtterance vitest mock (strictFunctionTypes).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM fake injection
  speak: (utterance: any) => void;
  cancel: () => void;
};

export type CreateIssueListenPlayerOptions = {
  synth: IssueListenSynth;
  /** Real SpeechSynthesisUtterance or a test stand-in with the same construct + rate/event surface. */
  utteranceCtor: new (text: string) => SpeechSynthesisUtterance;
  onState: (state: IssueListenPlayerState) => void;
  onError: () => void;
};

export type IssueListenPlayer = {
  play: (chunks: string[]) => void;
  pause: () => void;
  stop: () => void;
  setRate: (rate: number) => void;
  dispose: () => void;
};

function speechSynthesisErrorCode(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  if (!("error" in event)) return undefined;
  const { error } = event as { error: unknown };
  return typeof error === "string" ? error : undefined;
}

/**
 * Cancel-based TTS player: one chunk ahead; silence via cancel, never native pause/resume APIs.
 * Voice is left unset so the device preferred engine speaks.
 */
export function createIssueListenPlayer(
  options: CreateIssueListenPlayerOptions,
): IssueListenPlayer {
  const { synth, utteranceCtor, onState, onError } = options;

  let status: IssueListenPlayerStatus = "idle";
  let chunkIndex = 0;
  let rate = 1;
  let chunks: string[] = [];
  let disposed = false;
  /** Bumped on cancel so stale utterance events (incl. cancel-driven errors) are ignored. */
  let generation = 0;

  function emitState(): void {
    if (disposed) return;
    onState({ status, chunkIndex, rate });
  }

  function bumpGenerationAndCancel(): void {
    generation += 1;
    synth.cancel();
  }

  function speakChunk(index: number, gen: number): void {
    const text = chunks[index];
    if (text === undefined) return;

    const utterance = new utteranceCtor(text);
    utterance.rate = rate;
    // voice intentionally unset — system preferred TTS

    utterance.onstart = () => {
      if (disposed || gen !== generation) return;
      chunkIndex = index;
      emitState();
    };

    utterance.onend = () => {
      if (disposed || gen !== generation) return;

      const lookahead = index + 2;
      if (lookahead < chunks.length) {
        speakChunk(lookahead, gen);
        return;
      }

      // Last chunk finished and nothing left to enqueue → idle at start.
      if (index === chunks.length - 1) {
        status = "idle";
        chunkIndex = 0;
        emitState();
      }
    };

    utterance.onerror = (event) => {
      if (disposed || gen !== generation) return;

      const code = speechSynthesisErrorCode(event);
      if (code === "canceled" || code === "interrupted") {
        return;
      }

      bumpGenerationAndCancel();
      status = "idle";
      chunkIndex = 0;
      onError();
      emitState();
    };

    synth.speak(utterance);
  }

  function startFrom(index: number): void {
    const gen = generation;
    speakChunk(index, gen);
    if (index + 1 < chunks.length) {
      speakChunk(index + 1, gen);
    }
  }

  function play(nextChunks: string[]): void {
    if (disposed) return;
    if (nextChunks.length === 0) return;

    if (status === "paused") {
      chunks = nextChunks;
      status = "playing";
      emitState();
      startFrom(chunkIndex);
      return;
    }

    chunks = nextChunks;
    chunkIndex = 0;
    status = "playing";
    emitState();
    startFrom(0);
  }

  function pause(): void {
    if (disposed) return;
    bumpGenerationAndCancel();
    status = "paused";
    emitState();
  }

  function stop(): void {
    if (disposed) return;
    bumpGenerationAndCancel();
    status = "idle";
    chunkIndex = 0;
    emitState();
  }

  function setRate(nextRate: number): void {
    if (disposed) return;
    rate = nextRate;

    if (status === "playing") {
      bumpGenerationAndCancel();
      emitState();
      const restartGeneration = generation;
      // Yield so Chromium can flush canceled/interrupted + leftover onend
      // on the cancelled generation before we enqueue the restarted chunk.
      queueMicrotask(() => {
        if (disposed || status !== "playing" || restartGeneration !== generation) {
          return;
        }
        startFrom(chunkIndex);
      });
      return;
    }

    emitState();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    bumpGenerationAndCancel();
  }

  return { play, pause, stop, setRate, dispose };
}
