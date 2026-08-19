"use client";

import { useState, useTransition } from "react";
import {
  checkPublicUrlAction,
  clearOpenRouterOverrideAction,
  clearSmtpOverrideAction,
  saveConnectionsSettingsAction,
  testOpenRouterConnectionAction,
  testSmtpConnectionAction,
} from "@/app/(protected)/admin/settings/actions";
import { ConnectionDiagnosticButton } from "@/components/settings/connection-diagnostic-button";
import { SettingsSourceLabel } from "@/components/settings/settings-source-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SettingsPanelData, SettingsSourceLabel as SettingsSource } from "@/lib/settings-panel";
import { toast } from "@/lib/toast";

const UNSET = "__unset__";

export type ConnectionsSettingsProps = {
  data: SettingsPanelData;
};

function secretStatusLabel(source: SettingsSource): string {
  if (source === "gui") return "set via GUI";
  if (source === "env") return "from .env";
  return "not set";
}

function parseOptionalPort(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Connections section — OpenRouter, SMTP bundle, public URL.
 * Secrets stay masked; Clear OpenRouter / Clear SMTP persist immediately.
 */
export function ConnectionsSettings({ data }: ConnectionsSettingsProps) {
  const [openRouterApiKey, setOpenRouterApiKey] = useState("");
  const [smtpHost, setSmtpHost] = useState(data.smtpHost);
  const [smtpPort, setSmtpPort] = useState(
    data.smtpPort === null ? "" : String(data.smtpPort),
  );
  const [smtpUsername, setSmtpUsername] = useState(data.smtpUsername);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFrom, setSmtpFrom] = useState(data.smtpFrom);
  const [smtpSecure, setSmtpSecure] = useState(data.smtpSecure);
  const [appPublicUrl, setAppPublicUrl] = useState(data.appPublicUrl);

  const [isSaving, startSaveTransition] = useTransition();
  const [isClearingOpenRouter, startClearOpenRouter] = useTransition();
  const [isClearingSmtp, startClearSmtp] = useTransition();

  const busy = isSaving || isClearingOpenRouter || isClearingSmtp;

  const smtpHostPlaceholder = data.resolved.smtp.host ?? undefined;
  const smtpPortPlaceholder =
    data.resolved.smtp.port !== null ? String(data.resolved.smtp.port) : undefined;
  const smtpUsernamePlaceholder = data.resolved.smtp.username ?? undefined;
  const smtpFromPlaceholder = data.resolved.smtp.from ?? undefined;
  const appPublicUrlPlaceholder = data.resolved.appPublicUrl.value ?? undefined;

  return (
    <section
      className="mb-6 rounded-lg border border-border bg-card p-4"
      aria-label="Connections"
      data-testid="connections-settings"
    >
      <h2 className="text-lg font-semibold">Connections</h2>

      <div className="mt-4 grid gap-4 max-w-2xl">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="settings-openrouter-api-key">OpenRouter API key</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                startClearOpenRouter(async () => {
                  const result = await clearOpenRouterOverrideAction();
                  if (result.ok) {
                    setOpenRouterApiKey("");
                    toast.success("OpenRouter override cleared");
                  } else {
                    toast.error(result.error);
                  }
                });
              }}
            >
              {isClearingOpenRouter ? "Clearing…" : "Clear OpenRouter"}
            </Button>
          </div>
          <Input
            id="settings-openrouter-api-key"
            type="password"
            autoComplete="off"
            className="font-mono w-full"
            value={openRouterApiKey}
            placeholder="Leave blank to keep current"
            disabled={busy}
            onChange={(e) => setOpenRouterApiKey(e.target.value)}
          />
          <span className="text-sm text-muted-foreground">
            {secretStatusLabel(data.resolved.openRouterApiKey.source)}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">SMTP</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                startClearSmtp(async () => {
                  const result = await clearSmtpOverrideAction();
                  if (result.ok) {
                    setSmtpHost("");
                    setSmtpPort("");
                    setSmtpUsername("");
                    setSmtpPassword("");
                    setSmtpFrom("");
                    setSmtpSecure("");
                    toast.success("SMTP override cleared");
                  } else {
                    toast.error(result.error);
                  }
                });
              }}
            >
              {isClearingSmtp ? "Clearing…" : "Clear SMTP"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-smtp-host">SMTP host</Label>
          <Input
            id="settings-smtp-host"
            type="text"
            className="w-full"
            value={smtpHost}
            placeholder={smtpHostPlaceholder}
            disabled={busy}
            onChange={(e) => setSmtpHost(e.target.value)}
          />
          <SettingsSourceLabel source={data.resolved.smtp.source} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-smtp-port">SMTP port</Label>
          <Input
            id="settings-smtp-port"
            type="number"
            inputMode="numeric"
            className="w-full max-w-40"
            value={smtpPort}
            placeholder={smtpPortPlaceholder}
            disabled={busy}
            onChange={(e) => setSmtpPort(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-smtp-username">SMTP username</Label>
          <Input
            id="settings-smtp-username"
            type="text"
            className="w-full"
            value={smtpUsername}
            placeholder={smtpUsernamePlaceholder}
            disabled={busy}
            onChange={(e) => setSmtpUsername(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-smtp-password">SMTP password</Label>
          <Input
            id="settings-smtp-password"
            type="password"
            autoComplete="new-password"
            className="font-mono w-full"
            value={smtpPassword}
            placeholder="Leave blank to keep current"
            disabled={busy}
            onChange={(e) => setSmtpPassword(e.target.value)}
          />
          <span className="text-sm text-muted-foreground">
            {secretStatusLabel(data.resolved.smtp.source)}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-smtp-from">SMTP from</Label>
          <Input
            id="settings-smtp-from"
            type="text"
            className="w-full"
            value={smtpFrom}
            placeholder={smtpFromPlaceholder}
            disabled={busy}
            onChange={(e) => setSmtpFrom(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-smtp-secure">SMTP secure</Label>
          <Select
            value={smtpSecure === "" ? UNSET : smtpSecure}
            disabled={busy}
            onValueChange={(value) => setSmtpSecure(value === UNSET ? "" : value)}
          >
            <SelectTrigger id="settings-smtp-secure" className="w-40">
              <SelectValue placeholder="Use fallback" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Use fallback</SelectItem>
              <SelectItem value="true">On</SelectItem>
              <SelectItem value="false">Off</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-app-public-url">Public URL</Label>
          <Input
            id="settings-app-public-url"
            type="url"
            className="w-full"
            value={appPublicUrl}
            placeholder={appPublicUrlPlaceholder}
            disabled={busy}
            onChange={(e) => setAppPublicUrl(e.target.value)}
          />
          <SettingsSourceLabel source={data.resolved.appPublicUrl.source} />
        </div>
      </div>

      <div className="mt-4">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => {
            startSaveTransition(async () => {
              const result = await saveConnectionsSettingsAction({
                openRouterApiKey,
                smtpHost,
                smtpPort: parseOptionalPort(smtpPort),
                smtpUsername,
                smtpPassword,
                smtpFrom,
                smtpSecure,
                appPublicUrl,
              });
              if (result.ok) {
                setOpenRouterApiKey("");
                setSmtpPassword("");
                toast.success("Connections saved");
              } else {
                toast.error(result.error);
              }
            });
          }}
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <h3 className="text-sm font-medium">Connection checks</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Uses saved settings — Save Connections first if you just changed them.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <ConnectionDiagnosticButton
            label="Test OpenRouter"
            pendingLabel="Testing…"
            disabled={busy}
            run={testOpenRouterConnectionAction}
          />
          <ConnectionDiagnosticButton
            label="Test SMTP"
            pendingLabel="Testing…"
            disabled={busy}
            run={testSmtpConnectionAction}
          />
          <ConnectionDiagnosticButton
            label="Check public URL"
            pendingLabel="Checking…"
            disabled={busy}
            run={checkPublicUrlAction}
          />
        </div>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Changes apply on the next run / send / request.
      </p>
    </section>
  );
}
