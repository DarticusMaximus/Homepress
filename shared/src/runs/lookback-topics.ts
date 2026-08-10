import type { Client } from "node-appwrite";
import type { Run } from "./types";
import { listRuns } from "./repository";

export type LookbackTopic = {
  title: string;
  tags: string[];
  runId: string;
  runEndedAt: string | null;
  runStartedAt: string;
};

export type LookbackIssue = {
  runId: string;
  endedAt: string | null;
  startedAt: string;
  topics: { title: string; tags: string[] }[];
};

export type LookbackTopicLoadResult = {
  lookback: number;
  issues: LookbackIssue[];
  topics: LookbackTopic[];
};

export function parseRunTopicSummary(raw: string): { title: string; tags: string[] }[] {
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: { title: string; tags: string[] }[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.title !== "string") continue;
    if (!Array.isArray(obj.tags) || !obj.tags.every((t) => typeof t === "string")) {
      continue;
    }
    out.push({ title: obj.title, tags: obj.tags });
  }
  return out;
}

export function selectLookbackCompletedRuns(runs: Run[], lookback: number): Run[] {
  if (lookback <= 0) return [];
  const completed = runs.filter((r) => r.status === "completed");
  completed.sort((a, b) => {
    const aKey = a.endedAt || a.startedAt;
    const bKey = b.endedAt || b.startedAt;
    const cmp = bKey.localeCompare(aKey);
    if (cmp !== 0) return cmp;
    return b.$id.localeCompare(a.$id);
  });
  return completed.slice(0, lookback);
}

export async function loadLookbackTopics(
  client: Client,
  opts: { newsletterId: string; lookback: number },
): Promise<LookbackTopicLoadResult> {
  const { newsletterId, lookback } = opts;
  if (lookback <= 0) {
    return { lookback, issues: [], topics: [] };
  }

  const runs = await listRuns(client, {
    newsletterId,
    status: "completed",
    limit: Math.max(lookback, 100),
  });

  const selected = selectLookbackCompletedRuns(runs, lookback);

  const issues: LookbackIssue[] = selected.map((run) => ({
    runId: run.$id,
    endedAt: run.endedAt,
    startedAt: run.startedAt,
    topics: parseRunTopicSummary(run.topicSummary),
  }));

  const topics: LookbackTopic[] = [];
  for (const issue of issues) {
    for (const topic of issue.topics) {
      topics.push({
        title: topic.title,
        tags: topic.tags,
        runId: issue.runId,
        runEndedAt: issue.endedAt,
        runStartedAt: issue.startedAt,
      });
    }
  }

  return { lookback, issues, topics };
}
