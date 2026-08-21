import {
  getOrCreateAppSettings,
  getServerAppwrite,
  listPromptTemplates,
  PromptRepositoryError,
  type PromptTemplate,
} from "@newsletter/shared";
import { GlobalModelDefaults } from "@/components/prompts/global-model-defaults";
import { PromptsEditor } from "@/components/prompts/prompts-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default async function PromptsPage() {
  let templates: PromptTemplate[] = [];
  let loadError: string | null = null;
  let models = {
    taggerModel: "",
    scorerModel: "",
    drafterModel: "",
    embedderModel: "",
    titleDekModel: "",
  };
  let modelsLoadError: string | null = null;

  try {
    templates = await listPromptTemplates(getServerAppwrite());
  } catch (err) {
    loadError =
      err instanceof PromptRepositoryError
        ? err.message
        : "Something went wrong while loading prompt templates. Please try again.";
    console.error("[prompts/page]", err);
  }

  try {
    const settings = await getOrCreateAppSettings(getServerAppwrite());
    models = {
      taggerModel: settings.taggerModel,
      scorerModel: settings.scorerModel,
      drafterModel: settings.drafterModel,
      embedderModel: settings.embedderModel,
      titleDekModel: settings.titleDekModel,
    };
  } catch (err) {
    modelsLoadError = "Something went wrong while loading default models. Please try again.";
    console.error("[prompts/page] getOrCreateAppSettings", err);
  }

  return (
    <main>
      <h1 className="mb-6 text-2xl font-semibold">Prompts</h1>

      {modelsLoadError && (
        <Alert variant="destructive" className="mb-6" role="alert">
          <AlertDescription>{modelsLoadError}</AlertDescription>
        </Alert>
      )}

      {!modelsLoadError && (
        <GlobalModelDefaults
          taggerModel={models.taggerModel}
          scorerModel={models.scorerModel}
          drafterModel={models.drafterModel}
          titleDekModel={models.titleDekModel}
          embedderModel={models.embedderModel}
        />
      )}

      {loadError && (
        <Alert variant="destructive" className="mb-6" role="alert">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {!loadError && <PromptsEditor templates={templates} />}
    </main>
  );
}
