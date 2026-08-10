import { Check, X } from "lucide-react";
import type { HealthCheckResult } from "@newsletter/shared";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { ReRunButton } from "./re-run-button";

export function HealthCard({ result }: { result: HealthCheckResult & { error?: string } }) {
  const firstFailed = result.steps.find((step) => step.status === "failed");
  const hasFailure = Boolean(firstFailed) || Boolean(result.error);
  // Healthy + no page-level error → compact: badge + Re-run only (hide step list bulk).
  const isCompact = result.status === "ok" && !result.error;

  return (
    <Card data-testid="health-card" data-density={isCompact ? "compact" : "expanded"}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Database health</CardTitle>
        <Badge
          variant={result.status === "ok" ? "default" : "destructive"}
          data-testid="health-badge"
        >
          {result.status === "ok" ? "Healthy" : "Unhealthy"}
        </Badge>
      </CardHeader>
      {!isCompact && (
        <CardContent className="space-y-4">
          <ul className="space-y-2">
            {result.steps.map((step) => {
              const isOk = step.status === "ok";
              return (
                <li
                  key={step.step}
                  data-testid={`health-step-${step.step}`}
                  className="flex items-center gap-2 text-sm"
                >
                  {isOk ? (
                    <Check role="img" aria-label="ok" className={cn("size-4", "text-green-600")} />
                  ) : (
                    <X role="img" aria-label="failed" className={cn("size-4", "text-red-600")} />
                  )}
                  <span className="font-medium capitalize">{step.step}</span>
                  <span className="text-muted-foreground">({Math.round(step.durationMs)} ms)</span>
                  {!isOk && step.errorCode !== undefined && step.errorMessage && (
                    <span className="text-destructive">
                      {step.errorCode} {step.errorMessage}
                    </span>
                  )}
                  {!isOk && step.errorCode === undefined && step.errorMessage && (
                    <span className="text-destructive">{step.errorMessage}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {hasFailure && (
            <Alert variant="destructive">
              <AlertTitle>One or more steps failed</AlertTitle>
              <AlertDescription>
                <p>
                  {firstFailed
                    ? firstFailed.errorCode !== undefined
                      ? `${firstFailed.errorCode} ${firstFailed.errorMessage ?? ""}`.trim()
                      : (firstFailed.errorMessage ?? "Unknown error.")
                    : (result.error ?? "Unknown error.")}
                </p>
                <p>
                  If this is a 404, the worker has not provisioned the database yet — start the worker
                  to fix it.
                </p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      )}
      <CardFooter>
        <ReRunButton />
      </CardFooter>
    </Card>
  );
}
