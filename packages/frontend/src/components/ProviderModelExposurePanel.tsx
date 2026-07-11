import { createMemo, createSignal, For, Show, type Component } from 'solid-js';
import type { AuthType, ModelFilterRow } from '../services/api.js';

interface Props {
  rows: ModelFilterRow[];
  loading?: boolean;
  onToggle: (row: ModelFilterRow, enabled: boolean) => Promise<void>;
  onToggleAll: (rows: ModelFilterRow[], enabled: boolean) => Promise<void>;
}

interface ModelFilterGroup {
  key: string;
  provider: string;
  authType: AuthType;
  rows: ModelFilterRow[];
}

const ProviderModelExposurePanel: Component<Props> = (props) => {
  const [pendingKey, setPendingKey] = createSignal<string | null>(null);
  const groups = createMemo<ModelFilterGroup[]>(() => {
    const byGroup = new Map<string, ModelFilterGroup>();
    for (const row of props.rows) {
      const key = `${row.provider.toLowerCase()}::${row.auth_type}`;
      const existing =
        byGroup.get(key) ??
        ({
          key,
          provider: row.provider,
          authType: row.auth_type,
          rows: [],
        } satisfies ModelFilterGroup);
      existing.rows.push(row);
      byGroup.set(key, existing);
    }
    return [...byGroup.values()].map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => modelLabel(a).localeCompare(modelLabel(b))),
    }));
  });

  const toggle = async (row: ModelFilterRow) => {
    const key = modelKey(row);
    setPendingKey(key);
    try {
      await props.onToggle(row, !row.enabled);
    } finally {
      setPendingKey(null);
    }
  };

  const toggleAll = async (key: string, rows: ModelFilterRow[], enabled: boolean) => {
    setPendingKey(key);
    try {
      await props.onToggleAll(rows, enabled);
    } finally {
      setPendingKey(null);
    }
  };

  const visibleCount = () => props.rows.filter((row) => row.enabled).length;
  const allModelsAction = () => (visibleCount() > 0 ? 'Hide all models' : 'Show all models');

  return (
    <section class="provider-model-exposure-panel">
      <div class="provider-model-exposure-panel__header">
        <div>
          <h2 class="routing-section__title">Provider model exposure</h2>
          <p class="routing-section__subtitle">
            Hidden models are removed from `/v1/models`, pickers, and direct routes. Provider
            connections are managed separately.
          </p>
        </div>
        <Show when={props.rows.length > 0}>
          <button
            type="button"
            class="btn btn--outline btn--sm"
            disabled={pendingKey() !== null}
            onClick={() => void toggleAll('all', props.rows, visibleCount() === 0)}
          >
            {pendingKey() === 'all' ? 'Saving...' : allModelsAction()}
          </button>
        </Show>
      </div>

      <Show
        when={props.loading || groups().length > 0}
        fallback={<div class="provider-model-exposure-panel__empty">No provider models found.</div>}
      >
        <div class="provider-model-exposure-panel__groups">
          <Show when={props.loading}>
            <div class="provider-model-exposure-panel__empty">Loading models...</div>
          </Show>
          <For each={groups()}>
            {(group) => (
              <div class="provider-model-exposure-panel__group">
                <div class="provider-model-exposure-panel__group-header">
                  <div class="provider-model-exposure-panel__group-title">
                    <span>{displayProvider(group.provider)}</span>
                    <span>{authLabel(group.authType)}</span>
                  </div>
                  <span class="provider-model-exposure-panel__count">
                    {group.rows.filter((row) => row.enabled).length} of {group.rows.length} shown
                  </span>
                  <button
                    type="button"
                    class="btn btn--outline btn--sm"
                    disabled={pendingKey() !== null}
                    onClick={() =>
                      void toggleAll(
                        group.key,
                        group.rows,
                        group.rows.every((row) => !row.enabled),
                      )
                    }
                  >
                    {pendingKey() === group.key
                      ? 'Saving...'
                      : group.rows.some((row) => row.enabled)
                        ? 'Hide all'
                        : 'Show all'}
                  </button>
                </div>
                <div class="provider-model-exposure-panel__rows">
                  <For each={group.rows}>
                    {(row) => (
                      <div
                        classList={{
                          'provider-model-exposure-panel__row': true,
                          'provider-model-exposure-panel__row--hidden': !row.enabled,
                        }}
                      >
                        <div class="provider-model-exposure-panel__model">
                          <span class="provider-model-exposure-panel__model-name">
                            {modelLabel(row)}
                          </span>
                          <Show when={row.context_window}>
                            {(context) => (
                              <span class="provider-model-exposure-panel__context">
                                {formatContextWindow(context())}
                              </span>
                            )}
                          </Show>
                        </div>
                        <button
                          type="button"
                          class="btn btn--outline btn--sm"
                          disabled={pendingKey() !== null}
                          onClick={() => void toggle(row)}
                        >
                          {pendingKey() === modelKey(row)
                            ? 'Saving...'
                            : row.enabled
                              ? 'Hide'
                              : 'Show'}
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
};

function modelKey(row: ModelFilterRow): string {
  return `${row.provider.toLowerCase()}::${row.auth_type}::${row.model_name.toLowerCase()}`;
}

function modelLabel(row: ModelFilterRow): string {
  return row.display_name?.trim() || row.model_name;
}

function displayProvider(provider: string): string {
  if (provider.startsWith('custom:')) return 'Custom provider';
  return provider.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function authLabel(authType: AuthType): string {
  if (authType === 'api_key') return 'API key';
  if (authType === 'subscription') return 'Subscription';
  return 'Local';
}

function formatContextWindow(value: number): string {
  return `${new Intl.NumberFormat().format(value)} ctx`;
}

export default ProviderModelExposurePanel;
