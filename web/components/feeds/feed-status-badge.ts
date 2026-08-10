import type { FeedStatus } from "@newsletter/shared";

export const STATUS_BADGE: Record<FeedStatus, "default" | "secondary" | "destructive"> = {
  untested: "secondary",
  ok: "default",
  failed: "destructive",
};
