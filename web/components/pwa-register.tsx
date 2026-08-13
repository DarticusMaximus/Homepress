"use client";

import { useEffect } from "react";
import { PWA_UPDATE_CHECK_MS } from "@/lib/pwa-update";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let registration: ServiceWorkerRegistration | null = null;

    const requestUpdate = () => {
      if (!registration) return;
      void registration.update().catch(() => {
        // Swallow update check errors — bar uses build-id for deploy signal.
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestUpdate();
      }
    };

    void navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }).then((reg) => {
        if (cancelled) return;
        registration = reg;
        requestUpdate();
        document.addEventListener("visibilitychange", onVisibilityChange);
        intervalId = setInterval(requestUpdate, PWA_UPDATE_CHECK_MS);
      })
      .catch(() => {
        // Silent failure — no operator UI for registration errors.
      });

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
