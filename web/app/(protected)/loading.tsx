export default function ProtectedLoading() {
  return (
    <div data-testid="protected-loading" className="flex flex-col gap-3 py-2">
      <p className="text-sm text-muted-foreground">Loading…</p>
      <div className="h-4 w-48 animate-pulse rounded bg-muted" aria-hidden />
    </div>
  );
}
