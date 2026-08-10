"use client";

import { Button } from "@/components/ui/button";

const SAFE_ERROR_MESSAGE = "Something went wrong. Please try again.";

export default function ProtectedError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-4 py-2">
      <p className="text-sm text-muted-foreground">{SAFE_ERROR_MESSAGE}</p>
      <Button type="button" variant="outline" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}
