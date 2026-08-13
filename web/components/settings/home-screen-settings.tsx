"use client";

import { usePwaInstall } from "@/components/pwa-install-provider";
import { Button } from "@/components/ui/button";

/**
 * Home screen — Install Homepress when the PWA install provider can prompt.
 * Absent unless canInstall; no iOS A2HS copy or dismiss control.
 */
export function HomeScreenSettings() {
  const { canInstall, promptInstall } = usePwaInstall();

  if (!canInstall) {
    return null;
  }

  return (
    <section
      className="mb-6 rounded-lg border border-border bg-card p-4"
      aria-label="Home screen"
      data-testid="home-screen-settings"
    >
      <h2 className="text-lg font-semibold">Home screen</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Add Homepress to this device as an app.
      </p>
      <div className="mt-4">
        <Button
          type="button"
          size="sm"
          id="settings-install-homepress"
          onClick={() => void promptInstall()}
        >
          Install Homepress
        </Button>
      </div>
    </section>
  );
}
