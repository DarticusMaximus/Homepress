/**
 * MMR (Maximal Marginal Relevance) diversity selection (feature 06).
 *
 * Embeds the title+content snippet of every score-passing article via the
 * embedding model, then selects the top-N using Maximal Marginal Relevance
 * (λ=0.5 default) so the final set handed to the drafter is both relevant AND
 * topically diverse. Uses cosine similarity (textbook-correct MMR, independent
 * of embedding normalization) instead of the legacy raw dot product. The MMR
 * formula `(1-λ)·score − λ·maxSim` and greedy selection order (highest-score
 * first, then argmax MMR) are otherwise ported verbatim from the legacy Python
 * `select_diverse`.
 */

import { LLMClient } from "./llm-client";
import { DEFAULT_SCORE_THRESHOLD, getModelName } from "./config";
import { argMax, cosine } from "./vectors";
import type { ScoredArticle, SelectedArticle, SelectionFailure, SelectionResult } from "./types";

export const DEFAULT_LAMBDA = 0.5;
export const EMBED_SNIPPET_LENGTH = 1000;
export const EMBED_MAX_CONTENT_LENGTH = 8000;

/** Options shared by {@link MMRSelector} and the standalone {@link selectDiverse}. */
export interface MMRSelectorOptions {
  client?: LLMClient;
  lambda?: number;
  minScore?: number;
  /** Override embeddings model id; when unset, uses {@link getModelName}("embedder"). */
  model?: string;
}

/**
 * Build the text embedded for a candidate: `${title} ${content[:1000]}` then
 * capped at `EMBED_MAX_CONTENT_LENGTH` (8000). Byte-identical port of the
 * legacy `f"{candidate.title} {candidate.content[:1000]}"` plus the legacy's
 * `EMBED_MAX_CONTENT_LENGTH = 8000` truncation.
 */
export function buildEmbedText(article: ScoredArticle): string {
  return `${article.title} ${article.content.slice(0, EMBED_SNIPPET_LENGTH)}`.slice(
    0,
    EMBED_MAX_CONTENT_LENGTH,
  );
}

export class MMRSelector {
  private readonly client: LLMClient;
  private readonly lambda: number;
  private readonly minScore: number;
  private readonly model: string | undefined;

  constructor(options?: MMRSelectorOptions) {
    this.client = options?.client ?? new LLMClient();
    this.lambda = options?.lambda ?? DEFAULT_LAMBDA;
    this.minScore = options?.minScore ?? DEFAULT_SCORE_THRESHOLD;
    this.model = options?.model;
  }

  /**
   * Run the full selection phase:
   * 1. Threshold filter (`score >= minScore`), candidates sorted by score desc
   *    (stable); below-threshold → `SelectionFailure{ reason: 'below-threshold' }`.
   * 2. Batch embed all candidate texts in ONE `client.embeddings` call. A thrown
   *    error, shape mismatch, or any non-finite embedding element fails the
   *    batch atomically (every candidate → `reason: 'embedding-failed'`,
   *    `selectedArticles: []`).
   * 3. Greedy MMR with cosine similarity: first pick = highest score, then pick
   *    `argMax((1-λ)·score − λ·maxSim)` until `target` reached or pool exhausted.
   */
  async selectDiverse(articles: ScoredArticle[], target: number): Promise<SelectionResult> {
    const lambda = this.lambda;
    const minScore = this.minScore;
    const totalArticles = articles.length;

    // 1. Threshold filter — preserve input order for the below-threshold failures.
    const failures: SelectionFailure[] = [];
    const passing: ScoredArticle[] = [];
    for (const article of articles) {
      if (article.score >= minScore) {
        passing.push(article);
      } else {
        failures.push({
          articleTitle: article.title,
          articleLink: article.link,
          reason: "below-threshold",
        });
      }
    }

    // Stable sort by score descending (index as tiebreaker for determinism).
    const candidates = passing
      .map((article, index) => ({ article, index }))
      .sort((x, y) => y.article.score - x.article.score || x.index - y.index)
      .map((entry) => entry.article);

    const candidateCount = candidates.length;

    // Empty candidate pool → skip the embeddings call entirely.
    if (candidates.length === 0) {
      return {
        selectedArticles: [],
        failures,
        totalArticles,
        candidateCount,
        targetCount: target,
        lambda,
        minScore,
      };
    }

    // 2. Batch embed (single call for all candidates).
    const texts = candidates.map(buildEmbedText);
    let embeddings: number[][];
    try {
      const result = await this.client.embeddings({
        model: this.model ?? getModelName("embedder"),
        input: texts,
      });
      if (!Array.isArray(result.embeddings) || result.embeddings.length !== candidates.length) {
        throw new Error(
          `embedding shape mismatch: expected ${candidates.length}, got ${
            Array.isArray(result.embeddings) ? result.embeddings.length : "non-array"
          }`,
        );
      }
      // Element-wise finiteness validation (feature 08, C2): reject any vector
      // that contains a non-number or non-finite element. Throwing here lands
      // in the catch below, which records every candidate as
      // `reason: 'embedding-failed'` — atomic failure preserving the invariant
      // that no NaN/Infinity ever reaches the cosine/MMR scoring loop.
      for (let i = 0; i < result.embeddings.length; i++) {
        const vec = result.embeddings[i];
        if (!Array.isArray(vec)) {
          throw new Error(
            `embedding[${i}]: expected number[], got ${Array.isArray(vec) ? "array" : typeof vec}`,
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
            throw new Error(`embedding[${i}][${j}]: non-finite element (${desc})`);
          }
        }
      }
      embeddings = result.embeddings;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      for (const candidate of candidates) {
        failures.push({
          articleTitle: candidate.title,
          articleLink: candidate.link,
          reason: "embedding-failed",
          error: errorMessage,
        });
      }
      return {
        selectedArticles: [],
        failures,
        totalArticles,
        candidateCount,
        targetCount: target,
        lambda,
        minScore,
      };
    }

    // Zip embeddings onto candidates.
    const pool = candidates.map((article, i) => ({
      article,
      embedding: embeddings[i],
    }));

    // 3. Greedy MMR selection.
    const selectedIdx: number[] = [];
    const remainingIdx = pool.map((_, i) => i);

    // First pick = candidates[0] (highest score after the stable sort).
    const firstIdx = remainingIdx.shift();
    if (firstIdx !== undefined) {
      selectedIdx.push(firstIdx);
    }

    while (selectedIdx.length < target && remainingIdx.length > 0) {
      const mmrScores = remainingIdx.map((idx) => {
        const candidate = pool[idx];
        let maxSim = -Infinity;
        for (const sIdx of selectedIdx) {
          const sim = cosine(candidate.embedding, pool[sIdx].embedding);
          if (sim > maxSim) {
            maxSim = sim;
          }
        }
        return (1 - lambda) * candidate.article.score - lambda * maxSim;
      });
      const pickLocal = argMax(mmrScores);
      const pickGlobal = remainingIdx[pickLocal];
      selectedIdx.push(pickGlobal);
      remainingIdx.splice(pickLocal, 1);
    }

    const selectedArticles: SelectedArticle[] = selectedIdx.map((idx) => {
      const { article, embedding } = pool[idx];
      return { ...article, embedding };
    });

    // 4. Record candidates that passed the threshold and embedded successfully
    //    but were NOT chosen by MMR (target < candidateCount). This closes the
    //    accounting so the universal invariant
    //    `selectedArticles.length + failures.length === totalArticles` holds:
    //    every input article ends up in exactly one of selectedArticles or
    //    failures (below-threshold | embedding-failed | not-selected).
    const selectedIdxSet = new Set(selectedIdx);
    for (let i = 0; i < pool.length; i++) {
      if (selectedIdxSet.has(i)) continue;
      const { article } = pool[i];
      failures.push({
        articleTitle: article.title,
        articleLink: article.link,
        reason: "not-selected",
        error: `not selected by MMR (target=${target}, candidates=${candidateCount})`,
      });
    }

    return {
      selectedArticles,
      failures,
      totalArticles,
      candidateCount,
      targetCount: target,
      lambda,
      minScore,
    };
  }
}

/**
 * Standalone helper wrapping `new MMRSelector(options).selectDiverse(...)`.
 */
export async function selectDiverse(
  articles: ScoredArticle[],
  target: number,
  options?: MMRSelectorOptions,
): Promise<SelectionResult> {
  return new MMRSelector(options).selectDiverse(articles, target);
}
