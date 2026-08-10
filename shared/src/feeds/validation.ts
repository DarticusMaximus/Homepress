import { FeedRepositoryError } from "./types";
import { isPubliclyRoutableUrl, type DnsResolver } from "./ssrf";

const NAME_MAX_LENGTH = 255;
const URL_MAX_LENGTH = 2048;
const NOTES_MAX_LENGTH = 2000;

export function validateFeedName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new FeedRepositoryError("validation", "Name is required");
  }
  if (trimmed.length > NAME_MAX_LENGTH) {
    throw new FeedRepositoryError("validation", "Name must be 255 characters or less");
  }
  return trimmed;
}

export async function validateFeedUrl(
  url: string,
  opts?: { resolver?: DnsResolver },
): Promise<string> {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw new FeedRepositoryError("validation", "URL is required");
  }
  if (trimmed.length > URL_MAX_LENGTH) {
    throw new FeedRepositoryError("validation", "URL must be 2048 characters or less");
  }
  const routability = await isPubliclyRoutableUrl(trimmed, opts?.resolver);
  if (!routability.ok) {
    throw new FeedRepositoryError("validation", routability.reason);
  }
  return trimmed;
}

export function validateFeedNotes(notes: string | undefined): string {
  if (notes === undefined) {
    return "";
  }
  const trimmed = notes.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.length > NOTES_MAX_LENGTH) {
    throw new FeedRepositoryError("validation", "Notes must be 2000 characters or less");
  }
  return trimmed;
}
