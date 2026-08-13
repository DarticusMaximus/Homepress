import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createIssueListenPlayer } from "@/lib/issue-listen-player";

/** Minimal SpeechSynthesisUtterance stand-in for jsdom (no real TTS). */
class FakeUtterance {
  text: string;
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: ((this: FakeUtterance, ev: Event) => void) | null = null;
  onend: ((this: FakeUtterance, ev: Event) => void) | null = null;
  onerror: ((this: FakeUtterance, ev: Event) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

type PlayerState = {
  status: "idle" | "playing" | "paused";
  chunkIndex: number;
  rate: number;
};

function createFakeSynth() {
  const queue: FakeUtterance[] = [];
  let cancelCount = 0;
  /** Utterances spoken in the same turn as cancel() — Chromium cancels those too. */
  let cancelTurn = false;
  const sameTurnSpoken: FakeUtterance[] = [];

  const speak = vi.fn((utterance: FakeUtterance) => {
    queue.push(utterance);
    if (cancelTurn) {
      sameTurnSpoken.push(utterance);
    }
  });

  const cancel = vi.fn(() => {
    cancelCount += 1;
    const captured = [...queue];
    queue.length = 0;
    cancelTurn = true;

    // Chromium: cancel events flush after the current turn, including utterances
    // queued by speak() in the same turn as cancel().
    queueMicrotask(() => {
      const victims = [...captured, ...sameTurnSpoken];
      sameTurnSpoken.length = 0;
      cancelTurn = false;

      for (const u of victims) {
        u.onerror?.call(u, { error: "interrupted" } as unknown as Event);
        u.onend?.call(u, new Event("end"));
      }
    });
  });

  return {
    queue,
    speak,
    cancel,
    get cancelCount() {
      return cancelCount;
    },
    spokenTexts: () => speak.mock.calls.map(([u]) => (u as FakeUtterance).text),
  };
}

function fireStart(u: FakeUtterance) {
  u.onstart?.call(u, new Event("start"));
}

function fireEnd(u: FakeUtterance) {
  u.onend?.call(u, new Event("end"));
}

function fireError(u: FakeUtterance, error?: string) {
  const ev =
    error !== undefined
      ? ({ error } as unknown as Event)
      : new Event("error");
  u.onerror?.call(u, ev);
}

describe("createIssueListenPlayer", () => {
  let synth: ReturnType<typeof createFakeSynth>;
  let onState: ReturnType<typeof vi.fn<(state: PlayerState) => void>>;
  let onError: ReturnType<typeof vi.fn<() => void>>;
  let lastState: PlayerState | undefined;

  beforeEach(() => {
    synth = createFakeSynth();
    lastState = undefined;
    onState = vi.fn((state: PlayerState) => {
      lastState = state;
    });
    onError = vi.fn();
  });

  function createPlayer() {
    return createIssueListenPlayer({
      synth: { speak: synth.speak, cancel: synth.cancel },
      utteranceCtor: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
      onState,
      onError,
    });
  }

  it("play enqueues current + next only", () => {
    const player = createPlayer();
    const chunks = ["chunk0", "chunk1", "chunk2"];

    player.play(chunks);

    expect(synth.spokenTexts()).toEqual(["chunk0", "chunk1"]);
    expect(synth.spokenTexts()).not.toContain("chunk2");
  });

  it("first speak runs synchronously before play returns", () => {
    const player = createPlayer();

    // Capture call count immediately after play returns — proves speak ran
    // synchronously inside play (no setTimeout / queueMicrotask / then).
    // Note: do not wrap mockImplementation with synth.speak itself (infinite recursion).
    player.play(["a", "b", "c"]);
    const speakCountWhenPlayReturned = synth.speak.mock.calls.length;

    expect(speakCountWhenPlayReturned).toBeGreaterThanOrEqual(1);
  });

  it("end of current chunk enqueues lookahead (i+2)", () => {
    const player = createPlayer();
    const chunks = ["chunk0", "chunk1", "chunk2"];

    player.play(chunks);
    expect(synth.spokenTexts()).toEqual(["chunk0", "chunk1"]);

    const first = synth.queue[0]!;
    fireStart(first);
    fireEnd(first);

    expect(synth.spokenTexts()).toEqual(["chunk0", "chunk1", "chunk2"]);
  });

  it("last chunk end reports idle at chunkIndex 0", () => {
    const player = createPlayer();

    player.play(["only"]);
    const u = synth.queue[0]!;
    fireStart(u);
    fireEnd(u);

    expect(lastState).toEqual(
      expect.objectContaining({
        status: "idle",
        chunkIndex: 0,
      }),
    );
  });

  it("pause cancels and resume speaks from the paused chunk", () => {
    const player = createPlayer();
    const chunks = ["chunk0", "chunk1", "chunk2"];

    player.play(chunks);
    fireStart(synth.queue[0]!);

    player.pause();
    expect(synth.cancel).toHaveBeenCalled();
    expect(lastState?.status).toBe("paused");
    expect(lastState?.chunkIndex).toBe(0);

    synth.speak.mockClear();
    player.play(chunks);

    expect(synth.spokenTexts()[0]).toBe("chunk0");
  });

  it("stop resets so next play speaks chunk0 first", () => {
    const player = createPlayer();
    const chunks = ["chunk0", "chunk1"];

    player.play(chunks);
    fireStart(synth.queue[0]!);
    player.stop();

    expect(lastState).toEqual(
      expect.objectContaining({
        status: "idle",
        chunkIndex: 0,
      }),
    );

    synth.speak.mockClear();
    player.play(chunks);

    expect(synth.spokenTexts()[0]).toBe("chunk0");
  });

  it("empty chunks is a no-op (no speak, stays idle)", () => {
    const player = createPlayer();

    player.play([]);

    expect(synth.speak).not.toHaveBeenCalled();
    const playing = onState.mock.calls.filter(([s]) => s.status === "playing");
    expect(playing).toHaveLength(0);
  });

  it("setRate applies to utterance rate and leaves voice unset", () => {
    const player = createPlayer();

    player.setRate(1.5);
    player.play(["hello"]);

    const u = synth.speak.mock.calls[0]![0] as FakeUtterance;
    expect(u.rate).toBe(1.5);
    expect(u.voice == null).toBe(true);
  });

  it("setRate while playing cancels and restarts from current chunk", async () => {
    const player = createPlayer();
    const chunks = ["chunk0", "chunk1", "chunk2"];

    player.play(chunks);
    const u0 = synth.queue[0]!;
    const u1 = synth.queue[1]!;
    fireStart(u0);
    fireEnd(u0);
    fireStart(u1);

    expect(lastState?.chunkIndex).toBe(1);

    synth.speak.mockClear();
    synth.cancel.mockClear();

    player.setRate(2);

    expect(synth.cancel).toHaveBeenCalled();
    // Rate restart must not speak in the cancel turn (Chromium would
    // interrupted/end the new utterances). Flush the deferred startFrom.
    expect(synth.speak).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(synth.spokenTexts()[0]).toBe("chunk1");
    const restarted = synth.speak.mock.calls[0]![0] as FakeUtterance;
    expect(restarted.rate).toBe(2);
  });

  it("dispose cancels and ignores later utterance events", () => {
    const player = createPlayer();

    player.play(["a", "b"]);
    const u = synth.queue[0]!;
    fireStart(u);

    onState.mockClear();
    player.dispose();
    expect(synth.cancel).toHaveBeenCalled();

    expect(() => fireEnd(u)).not.toThrow();
    expect(onState).not.toHaveBeenCalled();
  });

  it("utterance error goes idle; cancel-driven errors do not call onError", async () => {
    const player = createPlayer();

    player.play(["a", "b"]);
    const u = synth.queue[0]!;
    fireStart(u);
    fireError(u);

    expect(onError).toHaveBeenCalled();
    expect(lastState).toEqual(
      expect.objectContaining({
        status: "idle",
        chunkIndex: 0,
      }),
    );

    // Fresh play, then pause/stop/dispose — subsequent cancel-driven errors ignored.
    onError.mockClear();
    player.play(["x", "y"]);
    const speaking = synth.queue[0]!;
    fireStart(speaking);

    player.pause();
    fireError(speaking);
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();

    player.play(["x", "y"]);
    const again = synth.queue[0]!;
    fireStart(again);
    player.stop();
    fireError(again);
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();

    player.play(["x", "y"]);
    const last = synth.queue[0]!;
    fireStart(last);
    player.dispose();
    fireError(last);
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it("setRate while playing ignores interrupted + leftover onend (no skip, not idle)", async () => {
    const player = createPlayer();
    const chunks = ["chunk0", "chunk1", "chunk2", "chunk3"];

    player.play(chunks);
    const u0 = synth.queue[0]!;
    fireStart(u0);
    fireEnd(u0);
    const u1 = synth.queue[1]!;
    fireStart(u1);

    expect(lastState?.chunkIndex).toBe(1);

    synth.speak.mockClear();
    onError.mockClear();

    player.setRate(2);

    expect(synth.speak).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
    expect(lastState?.status).toBe("playing");
    expect(lastState?.status).not.toBe("idle");
    expect(synth.spokenTexts()[0]).toBe("chunk1");
    const restarted = synth.speak.mock.calls[0]![0] as FakeUtterance;
    expect(restarted.rate).toBe(2);
    expect(synth.spokenTexts()).toEqual(["chunk1", "chunk2"]);
    expect(synth.spokenTexts()).not.toContain("chunk3");
    expect(lastState?.chunkIndex).toBe(1);
  });

  it("canceled on a current utterance does not call onError or idle", () => {
    const player = createPlayer();

    player.play(["a", "b"]);
    fireStart(synth.queue[0]!);
    fireError(synth.queue[0]!, "canceled");

    expect(onError).not.toHaveBeenCalled();
    expect(lastState?.status).toBe("playing");
  });

  it("synthesis-failed is fatal: onError, idle, chunkIndex 0", () => {
    const player = createPlayer();

    player.play(["a", "b"]);
    fireStart(synth.queue[0]!);
    fireError(synth.queue[0]!, "synthesis-failed");

    expect(onError).toHaveBeenCalled();
    expect(lastState).toEqual(
      expect.objectContaining({
        status: "idle",
        chunkIndex: 0,
      }),
    );
  });

  it("player source does not call synth.pause or synth.resume", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../lib/issue-listen-player.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/synth\.pause/);
    expect(source).not.toMatch(/synth\.resume/);
  });
});
