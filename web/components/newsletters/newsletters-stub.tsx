import type { Newsletter } from "@newsletter/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";

export type NewslettersStubProps = {
  newsletters: Pick<Newsletter, "$id" | "name">[];
  loadError?: string | null;
};

/**
 * Reader Newsletters stub (Stage 14 Feature 01): names as text, no factory chrome.
 * Feature 03 replaces this with channel pages.
 */
export function NewslettersStub({ newsletters, loadError = null }: NewslettersStubProps) {
  return (
    <main>
      {loadError ? (
        <Alert variant="destructive" className="mb-6" role="alert">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      <h1>Newsletters</h1>

      {loadError ? null : newsletters.length === 0 ? (
        <p>No newsletters yet.</p>
      ) : (
        <ul>
          {newsletters.map((newsletter) => (
            <li key={newsletter.$id}>{newsletter.name}</li>
          ))}
        </ul>
      )}
    </main>
  );
}
