import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FeedsHealthCard({
  unhealthyCount,
  error,
}: {
  unhealthyCount: number;
  error?: string;
}) {
  const hasError = Boolean(error);
  const isUnhealthy = !hasError && unhealthyCount > 0;
  // Healthy (count 0, no error) → compact: badge/label + View feeds link only.
  const isCompact = !hasError && unhealthyCount === 0;
  const href = isUnhealthy ? "/feeds?health=unhealthy" : "/feeds";
  const linkLabel = isUnhealthy ? "Review unhealthy feeds" : "View feeds";

  return (
    <Card
      data-testid="feeds-health-card"
      data-density={isCompact ? "compact" : "expanded"}
    >
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Feeds health</CardTitle>
        <Badge
          variant={!hasError && unhealthyCount === 0 ? "default" : "destructive"}
          data-testid="feeds-health-badge"
        >
          {hasError ? "Error" : unhealthyCount === 0 ? "Healthy" : "Unhealthy"}
        </Badge>
      </CardHeader>
      {!isCompact && (
        <CardContent className="space-y-4">
          {hasError ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to load feed health</AlertTitle>
              <AlertDescription>
                <p>{error}</p>
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle
                role="img"
                aria-label="unhealthy"
                className={cn("size-4", "text-red-600")}
              />
              <span>
                <span className="font-medium" data-testid="feeds-unhealthy-count">
                  {unhealthyCount}
                </span>{" "}
                unhealthy feed{unhealthyCount === 1 ? " needs" : "s need"} attention.
              </span>
            </div>
          )}
        </CardContent>
      )}
      <CardFooter>
        <Button variant={isUnhealthy ? "default" : "outline"} size="sm" asChild>
          <Link href={href} data-testid="feeds-health-link">
            {linkLabel}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
