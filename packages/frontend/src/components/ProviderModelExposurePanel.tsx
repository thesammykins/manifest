import { createMemo, createSignal, For, Show, type Component } from 'solid-js';
import type { AuthType, ModelFilterRow } from '../services/api.js';

interface Props {
  rows: ModelFilterRow[];
  loading?: boolean;
  onToggle: (row: ModelFilterRow, enabled: boolean) => Promise<void>;
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

  return (
    <section class="provider-model-exposure-panel">
      <div class="provider-model-exposure-panel__header">
        <div>
          <h2 class="routing-section__title">Provider model exposure</h2>
          <p class="routing-section__subtitle">Controls `/v1/models` and routing model pickers.</p>
        </div>
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
                  <span>{displayProvider(group.provider)}</span>
                  <span>{authLabel(group.authType)}</span>
                  <span>
                    {group.rows.filter((row) => row.enabled).length}/{group.rows.length}
                  </span>
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
                          disabled={pendingKey() === modelKey(row)}
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
