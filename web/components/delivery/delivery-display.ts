import type { Run } from "@newsletter/shared";

/**
 * Combined operator-facing failure text for the Delivery Failure column.
 * Both channels failed → `Email: … · RSS: …`; neither → empty string (caller shows —).
 */
export function formatDeliveryFailureText(run: Run): string {
  const emailFailed = run.emailDeliveryStatus === "failed";
  const rssFailed = run.rssDeliveryStatus === "failed";

  if (!emailFailed && !rssFailed) {
    return "";
  }

  if (emailFailed && rssFailed) {
    return `Email: ${run.emailDeliveryError || "Failed"} · RSS: ${run.rssDeliveryError || "Failed"}`;
  }

  if (emailFailed) {
    return run.emailDeliveryError || "Failed";
  }

  return run.rssDeliveryError || "Failed";
}

export { formatOperatorDate as formatDeliveryIssueDate } from "@/lib/format-operator-datetime";
