"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const [mounted, setIsMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  // next-themes hydration guard: theme resolves only on the client, so we render
  // a same-shaped placeholder until mounted to avoid hydration mismatch warnings.
  // The setState-in-effect is intentional and matches the documented next-themes
  // pattern; the new react-hooks/set-state-in-effect rule is overly broad here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setIsMounted(true), []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon">
        <Sun className="size-5 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
        <Moon className="absolute size-5 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
        <span className="sr-only">Toggle theme</span>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <Sun className="size-5 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute size-5 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
