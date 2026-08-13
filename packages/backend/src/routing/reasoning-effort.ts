import {
  setProviderParamValue,
  type ProviderParamSpec,
  type RequestParamDefaults,
} from 'manifest-shared';

export interface ReasoningEffortParam {
  params: RequestParamDefaults;
  value: string;
}

export function reasoningEffortsFromSpecs(specs: readonly ProviderParamSpec[]): string[] {
  const efforts = new Set<string>();
  for (const spec of specs) {
    if (!isReasoningEffortSpec(spec)) continue;
    for (const value of spec.values ?? []) {
      if (typeof value === 'string') efforts.add(value);
    }
  }
  return [...efforts];
}

export function reasoningEffortParams(
  specs: readonly ProviderParamSpec[],
  effort: string,
): ReasoningEffortParam | null {
  const normalized = effort.trim().toLowerCase();
  if (!normalized) return null;
  const candidates = specs.filter(isReasoningEffortSpec);
  const spec = candidates.find(
    (candidate) =>
      !candidate.values ||
      candidate.values.some(
        (value) => typeof value === 'string' && value.toLowerCase() === normalized,
      ),
  );
  if (!spec) return null;
  const wireValue =
    spec.values?.find(
      (value): value is string => typeof value === 'string' && value.toLowerCase() === normalized,
    ) ?? normalized;
  return {
    params: setProviderParamValue({}, spec.path, wireValue),
    value: wireValue,
  };
}

export function extractReasoningEffort(
  params: Record<string, unknown> | null | undefined,
): string | null {
  if (!params) return null;
  if (typeof params.reasoning_effort === 'string') return params.reasoning_effort;
  if (isRecord(params.reasoning) && typeof params.reasoning.effort === 'string') {
    return params.reasoning.effort;
  }
  const thinking = isRecord(params.generationConfig)
    ? params.generationConfig.thinkingConfig
    : undefined;
  return isRecord(thinking) && typeof thinking.thinkingLevel === 'string'
    ? thinking.thinkingLevel
    : null;
}

export function isReasoningEffortSpec(spec: ProviderParamSpec): boolean {
  if (spec.group !== 'reasoning' || spec.type !== 'enum') return false;
  const path = spec.path.toLowerCase();
  return (
    path === 'reasoning_effort' ||
    path.endsWith('.effort') ||
    path.endsWith('thinkinglevel') ||
    spec.label.toLowerCase().includes('effort')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
