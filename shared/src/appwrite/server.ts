import { Client } from "node-appwrite";
import { getAppwriteConfig } from "./config";

let cachedClient: Client | null = null;

export function getServerAppwrite(): Client {
  if (cachedClient) {
    return cachedClient;
  }
  const { endpoint, projectId, apiKey } = getAppwriteConfig();
  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  cachedClient = client;
  return client;
}
