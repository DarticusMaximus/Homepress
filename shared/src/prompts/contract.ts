import {
  PROMPT_ALLOWED_PLACEHOLDERS,
  PROMPT_REQUIRED_PLACEHOLDERS,
  type PromptRole,
  type PromptValidationResult,
} from "./types";

const PLACEHOLDER_RE = /\{([a-z][a-z0-9_]*)\}/g;

function extractPlaceholders(body: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER_RE)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

export function validatePromptTemplate(role: PromptRole, body: string): PromptValidationResult {
  if (body.trim().length === 0) {
    return {
      ok: false,
      missing: [...PROMPT_REQUIRED_PLACEHOLDERS[role]],
      warnings: [],
    };
  }

  const found = new Set(extractPlaceholders(body));
  const required = PROMPT_REQUIRED_PLACEHOLDERS[role];
  const allowed = new Set(PROMPT_ALLOWED_PLACEHOLDERS[role]);

  const missing = required.filter((name) => !found.has(name));
  const warnings = [...found].filter((name) => !allowed.has(name));

  return {
    ok: missing.length === 0,
    missing,
    warnings,
  };
}

export function renderPromptTemplate(body: string, values: Record<string, string>): string {
  return body.replace(PLACEHOLDER_RE, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      return values[name];
    }
    return match;
  });
}
