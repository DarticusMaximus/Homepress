"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";

export const PWA_THEME_COLOR_LIGHT = "#ffffff";
export const PWA_THEME_COLOR_DARK = "#0a0a0a";

export function PwaThemeColor() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") {
      return;
    }

    const color =
      resolvedTheme === "dark" ? PWA_THEME_COLOR_DARK : PWA_THEME_COLOR_LIGHT;

    let meta = document.head.querySelector(
      'meta[name="theme-color"]:not([media])',
    ) as HTMLMetaElement | null;

    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }

    meta.setAttribute("content", color);
  }, [resolvedTheme]);

  return null;
}
