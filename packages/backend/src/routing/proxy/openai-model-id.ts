import type { ModelRoute } from 'manifest-shared';
import type { DiscoveredModel } from '../../model-discovery/model-fetcher';

export const OPENAI_MODEL_ID_AUTO = 'auto';
const SUBSCRIPTION_MODEL_SUFFIX = '-subscription';
const REASONING_EFFORT_SUFFIXES = [
  'minimal',
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
const REASONING_EFFORT_SUFFIX_SET = new Set<string>(REASONING_EFFORT_SUFFIXES);

export function parseReasoningSuffix(
  modelId: string,
): { baseModelId: string; effort: string } | null {
  const lower = modelId.toLowerCase();
  for (const effort of REASONING_EFFORT_SUFFIXES) {
    const suffix = `-${effort}`;
    if (!lower.endsWith(suffix)) continue;
    const baseModelId = modelId.slice(0, -suffix.length);
    if (!baseModelId) return null;
    return { baseModelId, effort };
  }
  return null;
}

export function isReasoningEffortSuffix(value: string): boolean {
  return REASONING_EFFORT_SUFFIX_SET.has(value.toLowerCase());
}

export function openAiModelId(model: DiscoveredModel): string {
  const provider = model.provider.toLowerCase();
  if (provider.startsWith('custom:')) return model.id;

  const prefix = `${provider}/`;
  const routeId = model.id.toLowerCase().startsWith(prefix) ? model.id : `${provider}/${model.id}`;
  if (model.authType !== 'subscription' || routeId.endsWith(SUBSCRIPTION_MODEL_SUFFIX)) {
    return routeId;
  }
  return `${routeId}${SUBSCRIPTION_MODEL_SUFFIX}`;
}

export function routeForOpenAiModelId(
  modelId: string,
  models: readonly DiscoveredModel[],
): ModelRoute | null {
  for (const model of models) {
    if (!model.authType) continue;
    if (openAiModelId(model) !== modelId) continue;
    return {
      provider: model.provider,
      authType: model.authType,
      model: model.id,
    };
  }
  return null;
}
