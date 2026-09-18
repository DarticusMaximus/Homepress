import {
  getOrCreateAppSettings,
  getServerAppwrite,
  getSettingsSecretsHealth,
  resolveOperatorSettings,
} from "@newsletter/shared";
import { ConnectionsSettings } from "@/components/settings/connections-settings";
import { HomeScreenSettings } from "@/components/settings/home-screen-settings";
import { PipelineKnobsSettings } from "@/components/settings/pipeline-knobs-settings";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toSettingsPanelData, type SettingsPanelData } from "@/lib/settings-panel";

export default async function SettingsPage() {
  let data: SettingsPanelData | null = null;
  let loadError: string | null = null;

  try {
    const client = getServerAppwrite();
    const settings = await getOrCreateAppSettings(client);
    const [resolved, secretsHealth] = await Promise.all([
      resolveOperatorSettings(client, { settings }),
      getSettingsSecretsHealth(client),
    ]);
    data = toSettingsPanelData(settings, resolved, secretsHealth);
  } catch (err) {
    loadError = "Something went wrong while loading settings. Please try again.";
    console.error("[settings/page]", err);
  }

  return (
    <main>
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>

      {loadError && (
        <Alert variant="destructive" className="mb-6" role="alert">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {!loadError && data && (
        <>
          <ConnectionsSettings data={data} />
          <PipelineKnobsSettings data={data} />
        </>
      )
      }

      <HomeScreenSettings />
    </main>
  );
}
