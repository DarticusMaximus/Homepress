"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { toast } from "@/lib/toast";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<{ outcome: "accepted" | "dismissed" }>;
};

type PwaInstallContextValue = {
  canInstall: boolean;
  promptInstall: () => Promise<void>;
};

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

export function usePwaInstall(): PwaInstallContextValue {
  const value = useContext(PwaInstallContext);
  if (!value) {
    throw new Error("usePwaInstall must be used within PwaInstallProvider");
  }
  return value;
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  );

  useEffect(() => {
    const alreadyInstalled =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
    };

    if (!alreadyInstalled) {
      window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    }
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      if (!alreadyInstalled) {
        window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      }
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) {
      return;
    }

    const event = deferredPrompt;
    // Clear immediately so a second tap cannot leave a dead button.
    setDeferredPrompt(null);

    try {
      await event.prompt();
    } catch {
      toast.error(
        "Couldn't open the install dialog. Try Install app in the browser menu.",
      );
    }
  }, [deferredPrompt]);

  return (
    <PwaInstallContext.Provider
      value={{
        canInstall: deferredPrompt !== null,
        promptInstall,
      }}
    >
      {children}
    </PwaInstallContext.Provider>
  );
}
