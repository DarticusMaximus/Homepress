/**
 * Cross-run topic suppression (feature: avoid repeating themes across recent
 * newsletter issues).
 *
 * Embeds the title+tags of every candidate and every lookback topic via the
 * embedding model, then drops any candidate whose max cosine similarity to a
 * lookback topic meets or exceeds the cross-run similarity threshold. Both
 * sides use `buildTopicEmbedText` (title + tags) so the comparison is apples to
 * apples. Embeddings failure (throw, shape mismatch, non-finite element)
 * degrades to a no-op: candidates are returned unchanged and nothing is
 * suppressed — suppression is advisory, never fatal.
 */

import { LLMClient } from "./llm-client";
import { getModelName, getCrossRunSimilarityThreshold } from "./config";
import { cosine } from "./vectors";
import type { ScoredArticle } from "./types";
import type { LookbackTopic } from "../runs/lookback-topics";

/**
 * Build the text embedded for a topic (candidate or lookback):
 * `${title} ${tags.join(" ")}` then trimmed. Empty tags → just the title
 * (no trailing space after trim).
 */
export function buildTopicEmbedText(input: { title: string; tags: string[] }): string {
  return `${input.title} ${input.tags.join(" ")}`.trim();
}

export type SuppressItem = {
  title: string;
  link: string;
  matchedRunId: string;
  matchedTitle: string;
  similarity: number;
};

export type SuppressSummary = {
  /** ALWAYS equal to `items.length`. */
  count: number;
  items: SuppressItem[];
};

export type SuppressResult = {
  remaining: ScoredArticle[];
  summary: SuppressSummary;
};

/** Suppress options. `client` defaults to a new `LLMClient`; `threshold`
 *  defaults to `getCrossRunSimilarityThreshold()`. */
export interface SuppressOptions {
  client?: LLMClient;
  threshold?: number;
  /** Override embeddings model id; when unset, uses {@link getModelName}("embedder"). */
  model?: string;
}

function noOp(candidates: ScoredArticle[]): SuppressResult {
  return { remaining: candidates, summary: { count: 0, items: [] } };
}

/**
 * Validate an embeddings response matrix for both expected length and
 * element-wise finiteness. Throws on any defect — the caller wraps the whole
 * embed/score pipeline in try/catch so this degrades to a no-op suppress
 * rather than throwing into the run loop. Mirrors MMR's atomic finiteness guard.
 */
function assertEmbeddings(label: string, vecs: unknown, expected: number): number[][] {
  if (!Array.isArray(vecs) || vecs.length !== expected) {
    throw new Error(
      `${label} embedding shape mismatch: expected ${expected}, got ${
        Array.isArray(vecs) ? vecs.length : "non-array"
      }`,
    );
  }
  for (let i = 0; i < vecs.length; i++) {
    const vec = vecs[i];
    if (!Array.isArray(vec)) {
      throw new Error(
        `${label} embedding[${i}]: expected number[], got ${
          Array.isArray(vec) ? "array" : typeof vec
        }`,
      );
    }
    for (let j = 0; j < vec.length; j++) {
      const el = vec[j] as unknown;
      if (typeof el !== "number" || !Number.isFinite(el)) {
        const desc =
          typeof el === "number"
            ? Number.isNaN(el)
              ? "NaN"
              : el > 0
                ? "Infinity"
                : "-Infinity"
            : `non-number (${typeof el})`;
        throw new Error(`${label} embedding[${i}][${j}]: non-finite element (${desc})`);
      }
    }
  }
  return vecs as number[][];
}

/**
 * Drop candidates whose title+tags embedding is at least `threshold`-similar
 * to any lookback topic's title+tags embedding (cosine, max over lookback;
 * first lookback wins on a tie).
 *
 * - Empty `lookbackTopics` → short-circuit: returns candidates unchanged with
 *   an empty summary WITHOUT calling embeddings.
 * - Any embeddings call throwing or returning malformed (wrong-length /
 *   non-array / non-finite) data → log + no-op (return candidates unchanged,
 *   empty summary). Never throws.
 * - `summary.count` always equals `summary.items.length`.
 * - `remaining` preserves the original candidate order.
 */
export async function suppressCrossRunTopics(
  candidates: ScoredArticle[],
  lookbackTopics: LookbackTopic[],
  options?: SuppressOptions,
): Promise<SuppressResult> {
  // 1. Empty lookback short-circuits BEFORE any embed call.
  if (lookbackTopics.length === 0) {
    return noOp(candidates);
  }
  // 1b. Symmetric empty-candidates short-circuit — skip ALL embed work when
  //     there is nothing to score.
  if (candidates.length === 0) {
    return noOp(candidates);
  }

  const threshold = options?.threshold ?? getCrossRunSimilarityThreshold();
  const client = options?.client ?? new LLMClient();
  const model = options?.model ?? getModelName("embedder");

  try {
    const lookbackTexts = lookbackTopics.map((t) =>
      buildTopicEmbedText({ title: t.title, tags: t.tags }),
    );
    const candidateTexts = candidates.map((c) =>
      buildTopicEmbedText({ title: c.title, tags: c.tags }),
    );

    // 2. Embed lookback (always non-empty here) and candidates (if any).
    const lookbackResp = await client.embeddings({
      model,
      input: lookbackTexts,
    });
    const lookbackEmbeddings = assertEmbeddings(
      "lookback",
      lookbackResp.embeddings,
      lookbackTopics.length,
    );

    let candidateEmbeddings: number[][] = [];
    if (candidateTexts.length > 0) {
      const candidateResp = await client.embeddings({
        model,
        input: candidateTexts,
      });
      candidateEmbeddings = assertEmbeddings(
        "candidate",
        candidateResp.embeddings,
        candidates.length,
      );
    }

    // 3. Score each candidate against all lookback topics; max cosine wins
    //    (strict >, so the first flattened lookback topic wins on a tie).
    const items: SuppressItem[] = [];
    const remaining: ScoredArticle[] = [];

    for (let ci = 0; ci < candidates.length; ci++) {
      const candidate = candidates[ci];
      const cVec = candidateEmbeddings[ci];

      let maxSim = -Infinity;
      let bestLookbackIdx = -1;
      for (let li = 0; li < lookbackTopics.length; li++) {
        const sim = cosine(cVec, lookbackEmbeddings[li]);
        if (sim > maxSim) {
          maxSim = sim;
          bestLookbackIdx = li;
        }
      }

      if (bestLookbackIdx >= 0 && maxSim >= threshold) {
        const matched = lookbackTopics[bestLookbackIdx];
        items.push({
          title: candidate.title,
          link: candidate.link,
          matchedRunId: matched.runId,
          matchedTitle: matched.title,
          similarity: maxSim,
        });
      } else {
        remaining.push(candidate);
      }
    }

    return {
      remaining,
      summary: { count: items.length, items },
    };
  } catch (error) {
    console.error({
      phase: "cross-run-suppress",
      message: "Suppress failed (embedding/shape/finiteness); returning candidates unchanged",
      error: error instanceof Error ? error.message : String(error),
    });
    return noOp(candidates);
  }
}
