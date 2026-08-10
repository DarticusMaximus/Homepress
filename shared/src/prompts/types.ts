export const PROMPT_ROLES = ["tagger", "scorer", "drafter"] as const;

export type PromptRole = (typeof PROMPT_ROLES)[number];

export const PROMPT_REQUIRED_PLACEHOLDERS: Record<PromptRole, readonly string[]> = {
  tagger: ["title", "truncated_content"],
  scorer: ["topics", "disliked_topics", "tags", "title"],
  drafter: ["newsletter_name", "topics", "articles_json", "count"],
};

export const PROMPT_ALLOWED_PLACEHOLDERS: Record<PromptRole, readonly string[]> = {
  tagger: ["title", "truncated_content"],
  scorer: ["topics", "disliked_topics", "tags", "title"],
  drafter: ["newsletter_name", "topics", "articles_json", "count", "audience"],
};

export const PROMPT_PLACEHOLDERS = PROMPT_ALLOWED_PLACEHOLDERS;

export interface PromptValidationResult {
  ok: boolean;
  missing: string[];
  warnings: string[];
}

export type PromptRepositoryErrorCode = "validation" | "appwrite";

export class PromptRepositoryError extends Error {
  readonly code: PromptRepositoryErrorCode;

  constructor(code: PromptRepositoryErrorCode, message: string) {
    super(message);
    this.name = "PromptRepositoryError";
    this.code = code;
  }
}

export interface PromptTemplate {
  role: PromptRole;
  body: string;
  updatedAt: string;
}

export interface UpdatePromptTemplateResult {
  template: PromptTemplate;
  warnings: string[];
}
