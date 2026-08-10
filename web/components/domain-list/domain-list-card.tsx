import type { ReactNode } from "react";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type DomainListCardProps = {
  title: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function DomainListCard({
  title,
  badges,
  description,
  children,
  actions,
  className,
}: DomainListCardProps): React.JSX.Element {
  return (
    <Card className={className}>
      <CardHeader className="gap-3">
        {badges != null ? (
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-base">{title}</CardTitle>
            <div className="flex items-center gap-2">{badges}</div>
          </div>
        ) : (
          <CardTitle className="text-base">{title}</CardTitle>
        )}
        {description != null ? (
          <p className="text-sm break-all text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">{children}</CardContent>
      {actions != null ? (
        <CardFooter className="flex flex-wrap gap-2">{actions}</CardFooter>
      ) : null}
    </Card>
  );
}
