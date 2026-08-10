import {
  RECIPIENT_EMAIL_MAX_LENGTH,
  RECIPIENT_LIST_MAX,
} from "../schema/declarations";
import { NewsletterRepositoryError } from "./types";

export interface UpdateNewsletterDeliveryInput {
  recipientEmails: string[];
  autoEmail: boolean;
  autoRss: boolean;
}

export function normalizeEmailAddress(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Simple `local@domain` check after normalize — no MX lookup.
 * Requires length 1–254, at least one `@`, non-empty local/domain,
 * domain contains `.`, and no whitespace.
 */
export function isValidEmailAddress(email: string): boolean {
  const normalized = normalizeEmailAddress(email);

  if (normalized.length < 1 || normalized.length > RECIPIENT_EMAIL_MAX_LENGTH) {
    return false;
  }

  if (/\s/.test(normalized)) {
    return false;
  }

  const atIndex = normalized.indexOf("@");
  if (atIndex <= 0) {
    return false;
  }

  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  if (local.length === 0 || domain.length === 0) {
    return false;
  }

  if (!domain.includes(".")) {
    return false;
  }

  return true;
}

export function resolveDeliveryFields(
  input: UpdateNewsletterDeliveryInput,
): UpdateNewsletterDeliveryInput {
  const autoEmail = input.autoEmail;
  if (autoEmail !== true && autoEmail !== false) {
    throw new NewsletterRepositoryError("validation", "autoEmail must be a boolean");
  }

  const autoRss = input.autoRss;
  if (autoRss !== true && autoRss !== false) {
    throw new NewsletterRepositoryError("validation", "autoRss must be a boolean");
  }

  const raw = input.recipientEmails;
  if (!Array.isArray(raw)) {
    throw new NewsletterRepositoryError("validation", "recipientEmails must be an array");
  }

  const recipientEmails: string[] = [];
  const seen = new Set<string>();

  for (const element of raw) {
    if (typeof element !== "string") {
      throw new NewsletterRepositoryError(
        "validation",
        "recipientEmails must be an array of strings",
      );
    }

    const normalized = normalizeEmailAddress(element);
    if (normalized.length === 0) {
      continue;
    }

    if (!isValidEmailAddress(normalized)) {
      throw new NewsletterRepositoryError("validation", "Invalid recipient email");
    }

    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    recipientEmails.push(normalized);
  }

  if (recipientEmails.length > RECIPIENT_LIST_MAX) {
    throw new NewsletterRepositoryError(
      "validation",
      `Recipient list must have ${RECIPIENT_LIST_MAX} addresses or fewer`,
    );
  }

  if (autoEmail === true && recipientEmails.length === 0) {
    throw new NewsletterRepositoryError(
      "validation",
      "At least one recipient is required when auto-email is enabled",
    );
  }

  return {
    recipientEmails,
    autoEmail,
    autoRss,
  };
}
