"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createPwaUpdateMonitor } from "@/lib/pwa-update";

type PwaUpdateBarProps = {
  bootId: string;
};

export function PwaUpdateBar({ bootId }: PwaUpdateBarProps) {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      return;
    }

    const trimmed = bootId.trim();
    if (!trimmed) {
      return;
    }

    const monitor = createPwaUpdateMonitor({
      bootId: trimmed,
      fetchBuildId: async () => {
        const response = await fetch("/build-id", {
          cache: "no-store",
          redirect: "error",
        });
        if (!response.ok) {
          throw new Error(`build-id fetch failed: ${response.status}`);
        }
        const contentType = response.headers.get("Content-Type");
        if (!contentType) {
          throw new Error("build-id fetch missing Content-Type");
        }
        const mediaType = contentType.split(";", 1)[0]!.trim().toLowerCase();
        if (!mediaType.startsWith("text/plain")) {
          throw new Error(`build-id fetch unexpected Content-Type: ${contentType}`);
        }
        return response.text();
      },
      onUpdateAvailable: () => {
        setUpdateAvailable(true);
      },
      addVisibilityListener: (handler) => {
        const onVisibilityChange = () => {
          if (document.visibilityState === "visible") {
            handler();
          }
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
          document.removeEventListener("visibilitychange", onVisibilityChange);
        };
      },
    });

    monitor.start();
    return () => {
      monitor.stop();
    };
  }, [bootId]);

  if (process.env.NODE_ENV === "development" || !bootId.trim()) {
    return null;
  }

  if (!updateAvailable) {
    return null;
  }

  return (
    <div
      data-testid="pwa-update-bar"
      role="status"
      aria-label="App update"
      className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2 text-sm"
    >
      <span>A new version is ready.</span>
      <Button
        type="button"
        size="sm"
        id="pwa-update-reload"
        onClick={() => {
          window.location.reload();
        }}
      >
        Reload
      </Button>
    </div>
  );
}
