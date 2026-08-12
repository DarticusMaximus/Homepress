import type { SettingsSourceLabel as SettingsSource } from "@/lib/settings-panel";

const SOURCE_LABELS: Record<SettingsSource, string> = {
  gui: "GUI override",
  env: "from .env",
  default: "built-in default",
  none: "not set",
};

export type SettingsSourceLabelProps = {
  source: SettingsSource;
};

/** Muted effective-source line for Settings cascade visibility. */
export function SettingsSourceLabel({ source }: SettingsSourceLabelProps) {
  return <span className="text-sm text-muted-foreground">{SOURCE_LABELS[source]}</span>;
}
