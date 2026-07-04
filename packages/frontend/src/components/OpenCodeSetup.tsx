import { createSignal, Show, type Component } from 'solid-js';
import CopyButton from './CopyButton.jsx';
import CodeBlock from './CodeBlock.jsx';
import type { ModelAlias } from '../services/api.js';
import { exposedSetupModels } from '../services/exposed-models.js';

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
  modelAliases?: ModelAlias[];
}

export function getOpenCodeConfig(
  baseUrl: string,
  apiKey: string,
  modelAliases?: ModelAlias[],
): string {
  const models = openCodeModels(modelAliases);
  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        manifest: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Manifest',
          options: {
            baseURL: baseUrl,
            apiKey,
          },
          models,
        },
      },
      model: 'manifest/auto',
    },
    null,
    2,
  );
}

function openCodeModels(modelAliases?: ModelAlias[]): Record<string, unknown> {
  const entries = exposedSetupModels(modelAliases).map((model) => [
    model.id,
    { name: model.name } as Record<string, unknown>,
  ]);
  const models = Object.fromEntries(entries);
  const aliases = (modelAliases ?? []).filter((alias) => alias.enabled);
  const byId = new Map(aliases.map((alias) => [alias.model_id.toLowerCase(), alias]));
  const collapsed = new Set<string>();

  for (const alias of aliases) {
    if (alias.source_kind !== 'direct' || !alias.route) continue;
    const baseEntry = models[alias.model_id];
    if (!baseEntry) continue;

    const variants: Record<string, { reasoningEffort: string; reasoningSummary: 'auto' }> = {};
    const routeKey = directRouteKey(alias);
    for (const candidate of aliases) {
      if (candidate === alias || candidate.source_kind !== 'direct' || !candidate.route) {
        continue;
      }
      if (directRouteKey(candidate) !== routeKey) continue;
      const suffix = parseReasoningSuffix(candidate.model_id);
      if (!suffix || suffix.baseModelId.toLowerCase() !== alias.model_id.toLowerCase()) {
        continue;
      }
      const effort = extractReasoningEffort(candidate.request_params);
      if (effort !== suffix.effort) continue;
      if (byId.get(suffix.baseModelId.toLowerCase()) !== alias) continue;
      variants[effort] = { reasoningEffort: effort, reasoningSummary: 'auto' };
      collapsed.add(candidate.model_id);
    }

    if (Object.keys(variants).length > 0) baseEntry.variants = variants;
  }

  for (const id of collapsed) delete models[id];
  return models;
}

function directRouteKey(alias: ModelAlias): string {
  return [
    alias.route?.provider.toLowerCase() ?? '',
    alias.route?.authType ?? '',
    alias.route?.model ?? '',
    alias.route?.keyLabel?.toLowerCase() ?? '',
  ].join('\0');
}

function parseReasoningSuffix(modelId: string): { baseModelId: string; effort: string } | null {
  const lower = modelId.toLowerCase();
  for (const effort of REASONING_EFFORTS) {
    const suffix = `-${effort}`;
    if (!lower.endsWith(suffix)) continue;
    return { baseModelId: modelId.slice(0, -suffix.length), effort };
  }
  return null;
}

function extractReasoningEffort(params: Record<string, unknown> | null | undefined): string | null {
  if (!params) return null;
  if (typeof params.reasoning_effort === 'string') return params.reasoning_effort;
  const reasoning = params.reasoning;
  if (reasoning && typeof reasoning === 'object' && !Array.isArray(reasoning)) {
    const effort = (reasoning as Record<string, unknown>).effort;
    if (typeof effort === 'string') return effort;
  }
  return null;
}

const EyeIcon: Component<{ open: boolean }> = (props) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <Show
      when={props.open}
      fallback={
        <>
          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
          <circle cx="12" cy="12" r="3" />
        </>
      }
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </Show>
  </svg>
);

const OpenCodeSetup: Component<Props> = (props) => {
  const [keyRevealed, setKeyRevealed] = createSignal(false);

  const placeholderKey = 'mnfst_YOUR_KEY';
  const hasFullKey = () => !!props.apiKey;
  const masked = () => (props.keyPrefix ? `${props.keyPrefix}...` : placeholderKey);
  const copyKey = () => props.apiKey ?? placeholderKey;
  const visibleKey = () => {
    if (!props.apiKey) return placeholderKey;
    return keyRevealed() ? props.apiKey : masked();
  };

  const settingsCopy = () => getOpenCodeConfig(props.baseUrl, copyKey(), props.modelAliases);
  const settingsShown = () => getOpenCodeConfig(props.baseUrl, visibleKey(), props.modelAliases);

  return (
    <div class="setup-agents-card">
      <p class="setup-method__hint">
        Add this block to your global{' '}
        <code class="setup-model-hint__code">~/.config/opencode/opencode.json</code>.
      </p>

      <div class="setup-cli-block">
        <div class="setup-cli-block__actions">
          <Show when={hasFullKey()}>
            <button
              class="modal-terminal__copy"
              onClick={() => setKeyRevealed(!keyRevealed())}
              aria-label={keyRevealed() ? 'Hide API key' : 'Reveal API key'}
              title={keyRevealed() ? 'Hide key' : 'Reveal key'}
            >
              <EyeIcon open={keyRevealed()} />
            </button>
          </Show>
          <CopyButton text={settingsCopy()} />
        </div>
        <CodeBlock code={settingsShown()} language="json" />
      </div>
    </div>
  );
};

export default OpenCodeSetup;
