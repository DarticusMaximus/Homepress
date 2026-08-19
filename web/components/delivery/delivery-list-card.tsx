import Link from "next/link";
import { formatIssueFallbackTitle, type Run } from "@newsletter/shared";
import { DomainListCard, DomainListField } from "@/components/domain-list";
import { Button } from "@/components/ui/button";
import { DeliveryStatusBadge } from "@/components/delivery/delivery-status-badge";
import {
  formatDeliveryFailureText,
  formatDeliveryIssueDate,
} from "@/components/delivery/delivery-display";
import { buildAdminIssueHref } from "@/components/issues/issue-url";

type DeliveryListCardProps = {
  issue: Run;
  /** Resolved display title; falls back to Feature 01 format when omitted. */
  title?: string;
};

export function DeliveryListCard({ issue, title: titleProp }: DeliveryListCardProps) {
  const dateIso = issue.endedAt ?? issue.startedAt;
  const title = titleProp ?? formatIssueFallbackTitle(issue.newsletterName, dateIso);
  const href = buildAdminIssueHref(issue.$id);
  const failure = formatDeliveryFailureText(issue);

  return (
    <DomainListCard
      title={
        <Link href={href} className="hover:underline" title={title}>
          {title}
        </Link>
      }
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link href={href}>Open</Link>
        </Button>
      }
    >
      <DomainListField label="Newsletter">
        <span>{issue.newsletterName}</span>
      </DomainListField>
      <DomainListField label="Date">
        <span>{formatDeliveryIssueDate(dateIso)}</span>
      </DomainListField>
      <DomainListField label="Email" className="flex flex-wrap items-center gap-2">
        <DeliveryStatusBadge channel="email" status={issue.emailDeliveryStatus} />
      </DomainListField>
      <DomainListField label="RSS" className="flex flex-wrap items-center gap-2">
        <DeliveryStatusBadge channel="rss" status={issue.rssDeliveryStatus} />
      </DomainListField>
      <DomainListField label="Failure">
        {failure ? (
          <span className="break-words" title={failure}>
            {failure}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </DomainListField>
    </DomainListCard>
  );
}
