export const PWA_UPDATE_CHECK_MS = 60 * 60 * 1000;

export type PwaUpdateMonitorOptions = {
  bootId: string;
  fetchBuildId: () => Promise<string>;
  onUpdateAvailable: () => void;
  addVisibilityListener: (handler: () => void) => () => void;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

export type PwaUpdateMonitor = {
  start: () => void;
  stop: () => void;
  checkNow: () => Promise<void>;
};

/**
 * Plain (non-React) monitor that polls a build stamp and notifies when it
 * differs from the boot-time id. Development gating lives in the React host.
 */
export function createPwaUpdateMonitor(
  options: PwaUpdateMonitorOptions,
): PwaUpdateMonitor {
  const {
    bootId,
    fetchBuildId,
    onUpdateAvailable,
    addVisibilityListener,
    intervalMs = PWA_UPDATE_CHECK_MS,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = options;

  const trimmedBootId = bootId.trim();
  let active = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  async function checkNow(): Promise<void> {
    let fetched: string;
    try {
      fetched = (await fetchBuildId()).trim();
    } catch {
      return;
    }

    if (!fetched || fetched === trimmedBootId) {
      return;
    }

    onUpdateAvailable();
  }

  function start(): void {
    if (!trimmedBootId) {
      return;
    }

    active = true;
    void checkNow();

    unsubscribe = addVisibilityListener(() => {
      if (active) {
        void checkNow();
      }
    });

    intervalId = setIntervalFn(() => {
      if (active) {
        void checkNow();
      }
    }, intervalMs);
  }

  function stop(): void {
    active = false;

    if (intervalId !== null) {
      clearIntervalFn(intervalId);
      intervalId = null;
    }

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  return { start, stop, checkNow };
}
