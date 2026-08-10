import type { EmailDeliveryStatus, RssDeliveryStatus } from "@newsletter/shared";
import { Badge } from "@/components/ui/badge";

type EmailBadgeProps = {
  channel: "email";
  status: EmailDeliveryStatus;
};

type RssBadgeProps = {
  channel: "rss";
  status: RssDeliveryStatus;
};

export type DeliveryStatusBadgeProps = EmailBadgeProps | RssBadgeProps;

/**
 * Compact email/RSS delivery status badge.
 * Locked labels: Email — / Sent / Failed; RSS — / Published / Failed.
 */
export function DeliveryStatusBadge(props: DeliveryStatusBadgeProps) {
  if (props.status === "none") {
    return <span className="text-muted-foreground">—</span>;
  }

  if (props.channel === "email") {
    if (props.status === "sent") {
      return <Badge variant="default">Sent</Badge>;
    }
    return <Badge variant="destructive">Failed</Badge>;
  }

  if (props.status === "published") {
    return <Badge variant="default">Published</Badge>;
  }
  return <Badge variant="destructive">Failed</Badge>;
}
