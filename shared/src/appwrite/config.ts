export type AppwriteConfig = {
  endpoint: string;
  projectId: string;
  apiKey: string;
};

export function getAppwriteConfig(): AppwriteConfig {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT?.trim();
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID?.trim();
  const apiKey = process.env.APPWRITE_API_KEY?.trim();

  if (!endpoint) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_APPWRITE_ENDPOINT");
  }
  if (!projectId) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_APPWRITE_PROJECT_ID");
  }
  if (!apiKey) {
    throw new Error("Missing required environment variable: APPWRITE_API_KEY");
  }

  return { endpoint, projectId, apiKey };
}
