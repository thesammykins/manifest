import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
  type Component,
} from 'solid-js';
import { setProviderParamValue, type ProviderParamSpec } from 'manifest-shared';
import type {
  AvailableModel,
  AuthType,
  CredentialSelectionMode,
  CreateModelAliasInput,
  ModelAlias,
  ModelRoute,
  RequestParamDefaults,
  UpdateModelAliasInput,
} from '../services/api.js';

interface DirectRouteOption {
  key: string;
  route: ModelRoute;
  label: string;
  suggestedId: string;
}

interface Props {
  aliases: ModelAlias[];
  models: AvailableModel[];
  onCreate: (input: CreateModelAliasInput) => Promise<void>;
  onUpdate: (id: string, patch: UpdateModelAliasInput) => Promise<void>;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  getParamSpecs?: (route: ModelRoute) => Promise<readonly ProviderParamSpec[]>;
}

const ModelAliasesPanel: Component<Props> = (props) => {
  const [selectedKey, setSelectedKey] = createSignal('');
  const [modelId, setModelId] = createSignal('');
  const [displayName, setDisplayName] = createSignal('');
  const [reasoningEffort, setReasoningEffort] = createSignal('');
  const [creating, setCreating] = createSignal(false);

  const routeOptions = createMemo<DirectRouteOption[]>(() =>
    props.models
      .filter((model): model is AvailableModel & { auth_type: AuthType } => !!model.auth_type)
      .map((model, index) => {
        const route = {
          provider: model.provider,
          authType: model.auth_type,
          model: model.model_name,
        };
        return {
          key: `${index}:${route.provider}:${route.authType}:${route.model}`,
          route,
          label: `${displayProvider(route.provider)} ${authLabel(route.authType)} / ${
            model.display_name ?? route.model
          }`,
          suggestedId: suggestedModelId(route),
        };
      }),
  );

  const selectedOption = () => routeOptions().find((option) => option.key === selectedKey());
  const [selectedSpecs] = createResource(
    () => selectedOption()?.route ?? null,
    (route) =>
      props.getParamSpecs ? props.getParamSpecs(route).catch(() => [] as ProviderParamSpec[]) : [],
  );
  const reasoningEfforts = createMemo(() =>
    reasoningEffortOptions(selectedSpecs() ?? [], reasoningEffort()),
  );
  const baseAliases = createMemo(() =>
    props.aliases.filter(
      (alias) => alias.source_kind === 'direct' && !reasoningEffortFromParams(alias.request_params),
    ),
  );
  const fixedAliases = createMemo(() =>
    props.aliases.filter(
      (alias) =>
        alias.source_kind === 'direct' && !!reasoningEffortFromParams(alias.request_params),
    ),
  );
  const routingAliases = createMemo(() =>
    props.aliases.filter((alias) => alias.source_kind !== 'direct'),
  );

  createEffect(() => {
    const first = routeOptions()[0];
    if (!selectedKey() && first) {
      setSelectedKey(first.key);
      setModelId(first.suggestedId);
    }
  });

  const handleSelect = (key: string) => {
    setSelectedKey(key);
    const next = routeOptions().find((option) => option.key === key);
    if (next) setModelId(next.suggestedId);
  };

  const createAlias = async () => {
    const option = selectedOption();
    const id = modelId().trim();
    if (!option || !id) return;
    setCreating(true);
    try {
      await props.onCreate({
        model_id: id,
        display_name: displayName().trim() || null,
        source_kind: 'direct',
        route: option.route,
        request_params: null,
        response_mode: 'buffered',
      });
      setDisplayName('');
      setModelId(option.suggestedId);
    } finally {
      setCreating(false);
    }
  };

  const createFixedReasoningAlias = async () => {
    const option = selectedOption();
    const baseId = modelId().trim();
    const effort = reasoningEffort();
    if (!option || !baseId || !effort) return;
    setCreating(true);
    try {
      await props.onCreate({
        model_id: `${baseId}-${effort}`,
        display_name: `${displayName().trim() || option.route.model} ${effort}`,
        source_kind: 'direct',
        route: option.route,
        request_params: reasoningParams(option.route, effort, selectedSpecs() ?? []),
        response_mode: 'buffered',
      });
      setReasoningEffort('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <section class="model-aliases-panel">
      <div class="model-aliases-panel__header">
        <div>
          <h2 class="routing-section__title">Harness model catalog</h2>
          <p class="routing-section__subtitle">
            Add one public model ID per route. Compatible harnesses receive its reasoning levels as
            a selector, not as duplicate models.
          </p>
        </div>
      </div>

      <div class="model-aliases-panel__create">
        <label class="model-aliases-panel__field">
          <span>Route</span>
          <select value={selectedKey()} onInput={(e) => handleSelect(e.currentTarget.value)}>
            <For each={routeOptions()}>
              {(option) => <option value={option.key}>{option.label}</option>}
            </For>
          </select>
        </label>
        <label class="model-aliases-panel__field">
          <span>Model ID</span>
          <input
            value={modelId()}
            onInput={(e) => setModelId(e.currentTarget.value)}
            placeholder="openai-api/gpt-5"
          />
        </label>
        <label class="model-aliases-panel__field">
          <span>Display</span>
          <input
            value={displayName()}
            onInput={(e) => setDisplayName(e.currentTarget.value)}
            placeholder="Optional"
          />
        </label>
        <button
          type="button"
          class="btn btn--primary btn--sm"
          disabled={creating() || !selectedOption() || !modelId().trim()}
          onClick={createAlias}
        >
          {creating() ? 'Adding...' : 'Add model'}
        </button>
      </div>

      <div class="model-aliases-panel__fixed-alias">
        <div>
          <strong>Optional fixed reasoning alias</strong>
          <span>Create a separate ID only when a workflow must always use one effort.</span>
        </div>
        <label class="model-aliases-panel__field model-aliases-panel__field--short">
          <span>Reasoning level</span>
          <select
            value={reasoningEffort()}
            onInput={(e) => setReasoningEffort(e.currentTarget.value)}
          >
            <For each={reasoningEfforts()}>
              {(effort) => <option value={effort}>{effort || 'Choose a level'}</option>}
            </For>
          </select>
        </label>
        <button
          type="button"
          class="btn btn--outline btn--sm"
          disabled={
            creating() ||
            selectedSpecs.loading ||
            !selectedOption() ||
            !modelId().trim() ||
            !reasoningEffort()
          }
          onClick={createFixedReasoningAlias}
        >
          Add fixed alias
        </button>
      </div>

      <Show
        when={props.aliases.length > 0}
        fallback={
          <div class="model-aliases-panel__empty">
            No provider models are advertised yet. Manifest Auto remains available.
          </div>
        }
      >
        <div class="model-aliases-panel__list">
          <AliasGroup
            title="Models"
            aliases={baseAliases()}
            onUpdate={props.onUpdate}
            onToggle={props.onToggle}
            onDelete={props.onDelete}
            getParamSpecs={props.getParamSpecs}
          />
          <AliasGroup
            title="Fixed reasoning aliases"
            aliases={fixedAliases()}
            onUpdate={props.onUpdate}
            onToggle={props.onToggle}
            onDelete={props.onDelete}
            getParamSpecs={props.getParamSpecs}
          />
          <AliasGroup
            title="Routing aliases"
            aliases={routingAliases()}
            onUpdate={props.onUpdate}
            onToggle={props.onToggle}
            onDelete={props.onDelete}
            getParamSpecs={props.getParamSpecs}
          />
        </div>
      </Show>
    </section>
  );
};

const AliasGroup: Component<{
  title: string;
  aliases: ModelAlias[];
  onUpdate: Props['onUpdate'];
  onToggle: Props['onToggle'];
  onDelete: Props['onDelete'];
  getParamSpecs?: Props['getParamSpecs'];
}> = (props) => (
  <Show when={props.aliases.length > 0}>
    <section class="model-aliases-panel__group">
      <h3>{props.title}</h3>
      <For each={props.aliases}>
        {(alias) => (
          <ModelAliasRow
            alias={alias}
            onUpdate={props.onUpdate}
            onToggle={props.onToggle}
            onDelete={props.onDelete}
            getParamSpecs={props.getParamSpecs}
          />
        )}
      </For>
    </section>
  </Show>
);

const ModelAliasRow: Component<{
  alias: ModelAlias;
  onUpdate: (id: string, patch: UpdateModelAliasInput) => Promise<void>;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  getParamSpecs?: (route: ModelRoute) => Promise<readonly ProviderParamSpec[]>;
}> = (props) => {
  const [modelId, setModelId] = createSignal(props.alias.model_id);
  const [displayName, setDisplayName] = createSignal(props.alias.display_name ?? '');
  const [reasoningEffortDraft, setReasoningEffortDraft] = createSignal(
    reasoningEffortFromParams(props.alias.request_params) ?? '',
  );
  const [credentialModeDraft, setCredentialModeDraft] = createSignal<CredentialSelectionMode>(
    directCredentialMode(props.alias),
  );
  const [saving, setSaving] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [aliasSpecs] = createResource(
    () => (props.alias.source_kind === 'direct' && props.alias.route ? props.alias.route : null),
    (route) =>
      props.getParamSpecs ? props.getParamSpecs(route).catch(() => [] as ProviderParamSpec[]) : [],
  );
  const reasoningEfforts = createMemo(() =>
    reasoningEffortOptions(aliasSpecs() ?? [], reasoningEffortDraft()),
  );
  const isFixedReasoningAlias = () =>
    props.alias.source_kind === 'direct' && !!reasoningEffortFromParams(props.alias.request_params);

  createEffect(() => {
    setModelId(props.alias.model_id);
    setDisplayName(props.alias.display_name ?? '');
    setReasoningEffortDraft(reasoningEffortFromParams(props.alias.request_params) ?? '');
    setCredentialModeDraft(directCredentialMode(props.alias));
  });

  const changed = () =>
    modelId().trim() !== props.alias.model_id ||
    (displayName().trim() || null) !== props.alias.display_name ||
    (isFixedReasoningAlias() &&
      reasoningEffortDraft() !== (reasoningEffortFromParams(props.alias.request_params) ?? '')) ||
    (props.alias.source_kind === 'direct' &&
      credentialModeDraft() !== directCredentialMode(props.alias));

  const save = async () => {
    if (!changed()) return;
    setSaving(true);
    try {
      await props.onUpdate(props.alias.id, {
        model_id: modelId().trim(),
        display_name: displayName().trim() || null,
        ...(props.alias.source_kind === 'direct' && props.alias.route
          ? {
              ...(isFixedReasoningAlias()
                ? {
                    request_params: reasoningParams(
                      props.alias.route,
                      reasoningEffortDraft(),
                      aliasSpecs() ?? [],
                    ),
                  }
                : {}),
              credential_mode: credentialModeDraft(),
            }
          : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await props.onDelete(props.alias.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div class="model-alias-row">
      <div class="model-alias-row__main">
        <input
          class="model-alias-row__id"
          aria-label="Public model ID"
          value={modelId()}
          onInput={(e) => setModelId(e.currentTarget.value)}
        />
        <input
          class="model-alias-row__display"
          aria-label="Display name"
          value={displayName()}
          onInput={(e) => setDisplayName(e.currentTarget.value)}
          placeholder="Display name"
        />
        <Show when={props.alias.source_kind === 'direct' && props.alias.route}>
          <Show
            when={isFixedReasoningAlias()}
            fallback={
              <span class="model-alias-row__reasoning-summary">
                {reasoningEfforts().filter(Boolean).length > 0
                  ? `${reasoningEfforts().filter(Boolean).join(' · ')} selectable`
                  : 'Provider default'}
              </span>
            }
          >
            <select
              class="model-alias-row__reasoning"
              aria-label="Fixed reasoning level"
              value={reasoningEffortDraft()}
              onInput={(e) => setReasoningEffortDraft(e.currentTarget.value)}
            >
              <For each={reasoningEfforts().filter(Boolean)}>
                {(effort) => <option value={effort}>{effort}</option>}
              </For>
            </select>
          </Show>
          <select
            class="model-alias-row__reasoning"
            aria-label="Credential selection mode"
            value={credentialModeDraft()}
            onInput={(e) =>
              setCredentialModeDraft(e.currentTarget.value as CredentialSelectionMode)
            }
          >
            <option value="pinned">Pinned account</option>
            <option value="same_provider_failover">Same-provider failover</option>
          </select>
        </Show>
        <span class="model-alias-row__meta">{describeAlias(props.alias)}</span>
      </div>
      <div class="model-alias-row__actions">
        <button
          type="button"
          class="btn btn--outline btn--sm"
          disabled={saving() || !changed()}
          onClick={save}
        >
          {saving() ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          class="btn btn--outline btn--sm"
          onClick={() => props.onToggle(props.alias.id, !props.alias.enabled)}
        >
          {props.alias.enabled ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          class="btn btn--outline btn--sm"
          disabled={deleting()}
          onClick={remove}
        >
          {deleting() ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  );
};

export function suggestedModelId(route: ModelRoute): string {
  const provider = route.provider.toLowerCase();
  const model = route.model.toLowerCase();
  if (model.startsWith(`${provider}/`)) return model;
  return `${provider}-${authSlug(route.authType)}/${model}`;
}

function reasoningParams(
  route: ModelRoute,
  effort: string,
  specs: readonly ProviderParamSpec[] = [],
): RequestParamDefaults | null {
  if (!effort) return null;
  const spec = reasoningEffortSpec(specs, effort);
  if (spec) return setProviderParamValue({}, spec.path, effort);
  if (route.authType === 'subscription') return { reasoning: { effort } };
  return { reasoning_effort: effort };
}

function describeAlias(alias: ModelAlias): string {
  if (alias.source_kind === 'direct' && alias.route) {
    const route = alias.route;
    const key = route.keyLabel ? ` · ${route.keyLabel}` : '';
    const mode = directCredentialMode(alias) === 'same_provider_failover' ? ' · failover' : '';
    const effort = reasoningEffortFromParams(alias.request_params);
    return `${displayProvider(route.provider)} ${authLabel(route.authType)}${key} · ${
      route.model
    }${mode}${effort ? ` · ${effort}` : ''}`;
  }
  if (alias.source_kind === 'tier') return `Tier · ${alias.source_key}`;
  if (alias.source_kind === 'specificity') return `Task · ${alias.source_key}`;
  return `Header tier · ${alias.source_key}`;
}

function directCredentialMode(alias: ModelAlias): CredentialSelectionMode {
  if (alias.credential_mode) return alias.credential_mode;
  return alias.route?.keyLabel ? 'pinned' : 'same_provider_failover';
}

function reasoningEffortFromParams(params: RequestParamDefaults | null): string | null {
  const flat = params?.reasoning_effort;
  if (typeof flat === 'string') return flat;
  const nested = params?.reasoning;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const effort = (nested as { effort?: unknown }).effort;
    return typeof effort === 'string' ? effort : null;
  }
  const generationConfig = params?.generationConfig;
  if (
    generationConfig &&
    typeof generationConfig === 'object' &&
    !Array.isArray(generationConfig)
  ) {
    const thinkingConfig = (generationConfig as { thinkingConfig?: unknown }).thinkingConfig;
    if (thinkingConfig && typeof thinkingConfig === 'object' && !Array.isArray(thinkingConfig)) {
      const thinkingLevel = (thinkingConfig as { thinkingLevel?: unknown }).thinkingLevel;
      return typeof thinkingLevel === 'string' ? thinkingLevel : null;
    }
  }
  return null;
}

function reasoningEffortOptions(specs: readonly ProviderParamSpec[], current: string): string[] {
  const values = new Set<string>();
  for (const spec of specs) {
    if (!isReasoningEffortSpec(spec)) continue;
    for (const value of spec.values ?? []) {
      if (typeof value === 'string') values.add(value);
    }
  }
  if (current) values.add(current);
  return ['', ...values];
}

function reasoningEffortSpec(
  specs: readonly ProviderParamSpec[],
  effort: string,
): ProviderParamSpec | null {
  return (
    specs.find(
      (spec) =>
        isReasoningEffortSpec(spec) &&
        (!spec.values ||
          spec.values.some((value) => typeof value === 'string' && value === effort)),
    ) ?? null
  );
}

function isReasoningEffortSpec(spec: ProviderParamSpec): boolean {
  if (spec.group !== 'reasoning') return false;
  const path = spec.path.toLowerCase();
  if (path === 'reasoning_effort') return true;
  if (path.endsWith('.effort')) return true;
  if (path.endsWith('thinkinglevel')) return true;
  return false;
}

function authLabel(authType: AuthType): string {
  if (authType === 'api_key') return 'API';
  if (authType === 'subscription') return 'Subscription';
  return 'Local';
}

function authSlug(authType: AuthType): string {
  if (authType === 'api_key') return 'api';
  return authType;
}

function displayProvider(provider: string): string {
  if (provider.startsWith('custom:')) return 'Custom';
  return provider;
}

export default ModelAliasesPanel;
