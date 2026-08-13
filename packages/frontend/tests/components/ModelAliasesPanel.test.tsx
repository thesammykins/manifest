import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import ModelAliasesPanel, { suggestedModelId } from '../../src/components/ModelAliasesPanel';
import type {
  AvailableModel,
  CreateModelAliasInput,
  ModelAlias,
  ModelRoute,
  UpdateModelAliasInput,
} from '../../src/services/api.js';

function model(route: ModelRoute, displayName = route.model): AvailableModel {
  return {
    model_name: route.model,
    provider: route.provider,
    auth_type: route.authType,
    input_price_per_token: null,
    output_price_per_token: null,
    context_window: 128000,
    capability_reasoning: true,
    capability_code: true,
    quality_score: 100,
    display_name: displayName,
  };
}

describe('ModelAliasesPanel', () => {
  it('suggests provider/auth-scoped model ids', () => {
    expect(suggestedModelId({ provider: 'openai', authType: 'api_key', model: 'gpt-5' })).toBe(
      'openai-api/gpt-5',
    );
    expect(suggestedModelId({ provider: 'openai', authType: 'subscription', model: 'gpt-5' })).toBe(
      'openai-subscription/gpt-5',
    );
    expect(
      suggestedModelId({ provider: 'anthropic', authType: 'api_key', model: 'claude-opus-4' }),
    ).toBe('anthropic-api/claude-opus-4');
  });

  it('creates one public model without fixing a reasoning level', async () => {
    const onCreate = vi.fn<(_: CreateModelAliasInput) => Promise<void>>().mockResolvedValue();
    render(() => (
      <ModelAliasesPanel
        aliases={[]}
        models={[model({ provider: 'openai', authType: 'api_key', model: 'gpt-5' })]}
        onCreate={onCreate}
        onUpdate={vi.fn<(_: string, __: UpdateModelAliasInput) => Promise<void>>()}
        onToggle={vi.fn<(_: string, __: boolean) => Promise<void>>()}
        onDelete={vi.fn<(_: string) => Promise<void>>()}
        getParamSpecs={async () => [reasoningSpec(['low', 'medium', 'high'])]}
      />
    ));

    await screen.findByDisplayValue('openai-api/gpt-5');
    fireEvent.input(screen.getByLabelText('Display'), { target: { value: 'GPT 5' } });
    fireEvent.click(screen.getByText('Add model'));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        model_id: 'openai-api/gpt-5',
        display_name: 'GPT 5',
        source_kind: 'direct',
        route: { provider: 'openai', authType: 'api_key', model: 'gpt-5' },
        request_params: null,
        response_mode: 'buffered',
      });
    });
  });

  it('creates one optional fixed reasoning alias using the provider parameter path', async () => {
    const onCreate = vi.fn<(_: CreateModelAliasInput) => Promise<void>>().mockResolvedValue();
    render(() => (
      <ModelAliasesPanel
        aliases={[]}
        models={[model({ provider: 'openai', authType: 'subscription', model: 'gpt-5-codex' })]}
        onCreate={onCreate}
        onUpdate={vi.fn<(_: string, __: UpdateModelAliasInput) => Promise<void>>()}
        onToggle={vi.fn<(_: string, __: boolean) => Promise<void>>()}
        onDelete={vi.fn<(_: string) => Promise<void>>()}
        getParamSpecs={async () => [
          {
            ...reasoningSpec(['low', 'high']),
            authType: 'subscription',
            model: 'gpt-5-codex',
            path: 'reasoning.effort',
          },
        ]}
      />
    ));

    await screen.findByDisplayValue('openai-subscription/gpt-5-codex');
    await waitFor(() => {
      expect((screen.getByLabelText('Reasoning level') as HTMLSelectElement).options.length).toBe(
        3,
      );
    });
    fireEvent.input(screen.getByLabelText('Reasoning level'), { target: { value: 'high' } });
    fireEvent.click(screen.getByText('Add fixed alias'));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model_id: 'openai-subscription/gpt-5-codex-high',
          route: { provider: 'openai', authType: 'subscription', model: 'gpt-5-codex' },
          request_params: { reasoning: { effort: 'high' } },
        }),
      );
    });
  });

  it('updates, hides, and deletes configured aliases', async () => {
    const alias: ModelAlias = {
      id: 'alias-1',
      tenant_id: 'tenant-1',
      agent_id: 'agent-1',
      model_id: 'openai-api/gpt-5-low',
      display_name: 'GPT 5 low',
      enabled: true,
      source_kind: 'direct',
      source_key: null,
      route: { provider: 'openai', authType: 'api_key', model: 'gpt-5', keyLabel: 'Work' },
      fallback_routes: null,
      request_params: { reasoning_effort: 'low' },
      response_mode: 'buffered',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const onUpdate = vi
      .fn<(_: string, __: UpdateModelAliasInput) => Promise<void>>()
      .mockResolvedValue();
    const onToggle = vi.fn<(_: string, __: boolean) => Promise<void>>().mockResolvedValue();
    const onDelete = vi.fn<(_: string) => Promise<void>>().mockResolvedValue();

    render(() => (
      <ModelAliasesPanel
        aliases={[alias]}
        models={[]}
        onCreate={vi.fn<(_: CreateModelAliasInput) => Promise<void>>()}
        onUpdate={onUpdate}
        onToggle={onToggle}
        onDelete={onDelete}
      />
    ));

    expect(screen.getByText('openai API · Work · gpt-5 · low')).toBeDefined();

    fireEvent.input(screen.getByDisplayValue('openai-api/gpt-5-low'), {
      target: { value: 'openai-api/gpt-5-medium' },
    });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('alias-1', {
        model_id: 'openai-api/gpt-5-medium',
        display_name: 'GPT 5 low',
        credential_mode: 'pinned',
        request_params: { reasoning_effort: 'low' },
      });
    });

    fireEvent.click(screen.getByText('Hide'));
    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith('alias-1', false);
    });

    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('alias-1');
    });
  });

  it('updates direct alias reasoning effort', async () => {
    const alias: ModelAlias = {
      id: 'alias-1',
      tenant_id: 'tenant-1',
      agent_id: 'agent-1',
      model_id: 'openai-api/gpt-5-low',
      display_name: 'GPT 5 low',
      enabled: true,
      source_kind: 'direct',
      source_key: null,
      route: { provider: 'openai', authType: 'api_key', model: 'gpt-5' },
      fallback_routes: null,
      request_params: { reasoning_effort: 'low' },
      response_mode: 'buffered',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const onUpdate = vi
      .fn<(_: string, __: UpdateModelAliasInput) => Promise<void>>()
      .mockResolvedValue();

    render(() => (
      <ModelAliasesPanel
        aliases={[alias]}
        models={[]}
        onCreate={vi.fn<(_: CreateModelAliasInput) => Promise<void>>()}
        onUpdate={onUpdate}
        onToggle={vi.fn<(_: string, __: boolean) => Promise<void>>()}
        onDelete={vi.fn<(_: string) => Promise<void>>()}
        getParamSpecs={async () => [reasoningSpec(['low', 'medium', 'high'])]}
      />
    ));

    await waitFor(() => {
      expect(
        (screen.getByLabelText('Fixed reasoning level') as HTMLSelectElement).options.length,
      ).toBe(3);
    });
    fireEvent.input(screen.getByLabelText('Fixed reasoning level'), {
      target: { value: 'high' },
    });
    await waitFor(() => {
      expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('alias-1', {
        model_id: 'openai-api/gpt-5-low',
        display_name: 'GPT 5 low',
        credential_mode: 'same_provider_failover',
        request_params: { reasoning_effort: 'high' },
      });
    });
  });

  it('shows supported reasoning levels on a base model instead of duplicate rows', async () => {
    const alias = {
      id: 'alias-base',
      tenant_id: 'tenant-1',
      agent_id: 'agent-1',
      model_id: 'openai-api/gpt-5',
      display_name: 'GPT 5',
      enabled: true,
      source_kind: 'direct',
      source_key: null,
      route: { provider: 'openai', authType: 'api_key', model: 'gpt-5' },
      fallback_routes: null,
      request_params: null,
      response_mode: 'buffered',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    } as ModelAlias;
    render(() => (
      <ModelAliasesPanel
        aliases={[alias]}
        models={[model({ provider: 'openai', authType: 'api_key', model: 'gpt-5' })]}
        onCreate={vi.fn<(_: CreateModelAliasInput) => Promise<void>>()}
        onUpdate={vi.fn<(_: string, __: UpdateModelAliasInput) => Promise<void>>()}
        onToggle={vi.fn<(_: string, __: boolean) => Promise<void>>()}
        onDelete={vi.fn<(_: string) => Promise<void>>()}
        getParamSpecs={async () => [
          {
            provider: 'openai',
            authType: 'api_key',
            model: 'gpt-5',
            path: 'reasoning_effort',
            type: 'enum',
            label: 'Reasoning effort',
            description: '',
            group: 'reasoning',
            values: ['low', 'high'],
          },
        ]}
      />
    ));

    await waitFor(() => {
      expect(screen.getByText('low · high selectable')).toBeTruthy();
    });
    expect(screen.getAllByLabelText('Public model ID')).toHaveLength(1);
  });

  it('disables fixed aliases when a model has no selectable reasoning levels', async () => {
    render(() => (
      <ModelAliasesPanel
        aliases={[]}
        models={[model({ provider: 'openai', authType: 'api_key', model: 'gpt-5' })]}
        onCreate={vi.fn<(_: CreateModelAliasInput) => Promise<void>>()}
        onUpdate={vi.fn<(_: string, __: UpdateModelAliasInput) => Promise<void>>()}
        onToggle={vi.fn<(_: string, __: boolean) => Promise<void>>()}
        onDelete={vi.fn<(_: string) => Promise<void>>()}
        getParamSpecs={async () => []}
      />
    ));

    await screen.findByDisplayValue('openai-api/gpt-5');
    await waitFor(() => {
      expect((screen.getByText('Add fixed alias') as HTMLButtonElement).disabled).toBe(true);
    });
  });
});

function reasoningSpec(values: string[]) {
  return {
    provider: 'openai',
    authType: 'api_key' as const,
    model: 'gpt-5',
    path: 'reasoning_effort',
    type: 'enum' as const,
    label: 'Reasoning effort',
    description: '',
    group: 'reasoning' as const,
    values,
  };
}
