"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { revalidateHealthCheck } from "./actions";

export function ReRunButton() {
  return (
    <form action={revalidateHealthCheck}>
      <Button type="submit" variant="outline" size="sm">
        <RotateCw />
        Re-run
      </Button>
    </form>
  );
}
