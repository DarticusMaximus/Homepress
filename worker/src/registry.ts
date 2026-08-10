export type JobHandler = (input: unknown) => Promise<void>;

const registry = new Map<string, JobHandler>();

export function registerJob(name: string, handler: JobHandler): void {
  registry.set(name, handler);
}

export function getJob(name: string): JobHandler | undefined {
  return registry.get(name);
}

export function listJobs(): string[] {
  return [...registry.keys()];
}
