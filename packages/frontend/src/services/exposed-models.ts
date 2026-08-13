import type { AvailableModel, ModelAlias } from './api.js';

export interface ExposedSetupModel {
  id: string;
  name: string;
  reasoningEfforts?: string[];
  fixedReasoningEffort?: string;
}

export function exposedSetupModels(
  aliases: readonly ModelAlias[] | undefined,
  availableModels?: readonly AvailableModel[],
): ExposedSetupModel[] {
  const seen = new Set<string>();
  const models: ExposedSetupModel[] = [];
  const add = (id: string, name: string) => {
    const key = id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    models.push({ id, name });
  };

  add('manifest/auto', 'Manifest Auto');
  for (const alias of aliases ?? []) {
    if (!alias.enabled) continue;
    add(alias.model_id, alias.display_name ?? alias.model_id);
  }

  if (!aliases || !availableModels) return models;
  const aliasById = new Map(aliases.map((alias) => [alias.model_id.toLowerCase(), alias]));
  for (const model of models) {
    const alias = aliasById.get(model.id.toLowerCase());
    if (!alias?.enabled || alias.source_kind !== 'direct' || !alias.route) continue;
    const fixedEffort = reasoningEffort(alias.request_params);
    if (fixedEffort) {
      model.fixedReasoningEffort = fixedEffort;
      continue;
    }
    const routeModel = availableModels.find(
      (candidate) =>
        candidate.provider.toLowerCase() === alias.route?.provider.toLowerCase() &&
        candidate.auth_type === alias.route?.authType &&
        candidate.model_name === alias.route?.model,
    );
    if (routeModel?.reasoning_efforts?.length) {
      model.reasoningEfforts = [...routeModel.reasoning_efforts];
    }
  }
  return models;
}

function reasoningEffort(params: Record<string, unknown> | null | undefined): string | null {
  if (!params) return null;
  if (typeof params.reasoning_effort === 'string') return params.reasoning_effort;
  const reasoning = params.reasoning;
  if (reasoning && typeof reasoning === 'object' && !Array.isArray(reasoning)) {
    const effort = (reasoning as Record<string, unknown>).effort;
    if (typeof effort === 'string') return effort;
  }
  const generationConfig = params.generationConfig;
  if (
    generationConfig &&
    typeof generationConfig === 'object' &&
    !Array.isArray(generationConfig)
  ) {
    const thinkingConfig = (generationConfig as Record<string, unknown>).thinkingConfig;
    if (thinkingConfig && typeof thinkingConfig === 'object' && !Array.isArray(thinkingConfig)) {
      const level = (thinkingConfig as Record<string, unknown>).thinkingLevel;
      if (typeof level === 'string') return level;
    }
  }
  return null;
}
