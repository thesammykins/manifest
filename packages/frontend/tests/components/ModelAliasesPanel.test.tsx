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

const successfulVariantCreate = vi.fn().mockResolvedValue({ createdIds: [], failedIds: [] });

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

  it('creates a direct API-key alias with reasoning_effort params', async () => {
    const onCreate = vi.fn<(_: CreateModelAliasInput) => Promise<void>>().mockResolvedValue();
    render(() => (
      <ModelAliasesPanel
        aliases={[]}
        models={[model({ provider: 'openai', authType: 'api_key', model: 'gpt-5' })]}
        onCreate={onCreate}
        onUpdate={vi.fn<(_: string, __: UpdateModelAliasInput) => Promise<void>>()}
        onToggle={vi.fn<(_: string, __: boolean) => Promise<void>>()}
        onDelete={vi.fn<(_: string) => Promise<void>>()}
        onCreateVariants={successfulVariantCreate}
      />
    ));

    await screen.findByDisplayValue('openai-api/gpt-5');
    fireEvent.input(screen.getByLabelText('Display'), { target: { value: 'GPT 5 low' } });
    fireEvent.input(screen.getByLabelText('Reasoning'), { target: { value: 'low' } });
    fireEvent.click(screen.getByText('Add alias'));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        model_id: 'openai-api/gpt-5',
        display_name: 'GPT 5 low',
        source_kind: 'direct',
        route: { provider: 'openai', authType: 'api_key', model: 'gpt-5' },
        request_params: { reasoning_effort: 'low' },
        response_mode: 'buffered',
      });
    });
  });

  it('creates a subscription alias with nested reasoning params', async () => {
    const onCreate = vi.fn<(_: CreateModelAliasInput) => Promise<void>>().mockResolvedValue();
    render(() => (
      <ModelAliasesPanel
        aliases={[]}
        models={[model({ provider: 'openai', authType: 'subscription', model: 'gpt-5-codex' })]}
        onCreate={onCreate}
        onUpdate={vi.fn<(_: string, __: UpdateModelAliasInput) => Promise<void>>()}
        onToggle={vi.fn<(_: string, __: boolean) => Promise<void>>()}
        onDelete={vi.fn<(_: string) => Promise<void>>()}
        onCreateVariants={successfulVariantCreate}
      />
    ));

    await screen.findByDisplayValue('openai-subscription/gpt-5-codex');
    fireEvent.input(screen.getByLabelText('Reasoning'), { target: { value: 'high' } });
    fireEvent.click(screen.getByText('Add alias'));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model_id: 'openai-subscription/gpt-5-codex',
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
        onCreateVariants={successfulVariantCreate}
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
        onCreateVariants={successfulVariantCreate}
      />
    ));

    fireEvent.input(screen.getByDisplayValue('low'), { target: { value: 'high' } });
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

  it('reports every created variant after a successful bulk create', async () => {
    const onCreateVariants = vi.fn().mockResolvedValue({
      createdIds: ['openai-api/gpt-5-low', 'openai-api/gpt-5-high'],
      failedIds: [],
    });
    render(() => (
      <ModelAliasesPanel
        aliases={[]}
        models={[model({ provider: 'openai', authType: 'api_key', model: 'gpt-5' })]}
        onCreate={vi.fn<(_: CreateModelAliasInput) => Promise<void>>()}
        onUpdate={vi.fn<(_: string, __: UpdateModelAliasInput) => Promise<void>>()}
        onToggle={vi.fn<(_: string, __: boolean) => Promise<void>>()}
        onDelete={vi.fn<(_: string) => Promise<void>>()}
        onCreateVariants={onCreateVariants}
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

    await screen.findByDisplayValue('openai-api/gpt-5');
    await waitFor(() => {
      expect((screen.getByText('Expose variants') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByText('Expose variants'));

    await waitFor(() => {
      expect(onCreateVariants).toHaveBeenCalledTimes(1);
    });
    expect(onCreateVariants).toHaveBeenCalledWith([
      expect.objectContaining({
        model_id: 'openai-api/gpt-5-low',
        request_params: { reasoning_effort: 'low' },
      }),
      expect.objectContaining({
        model_id: 'openai-api/gpt-5-high',
        request_params: { reasoning_effort: 'high' },
      }),
    ]);
    expect((await screen.findByRole('status')).textContent?.trim()).toBe(
      'Created: openai-api/gpt-5-low, openai-api/gpt-5-high.',
    );
  });

  it('reports a duplicate middle variant without hiding later successes', async () => {
    const onCreateVariants = vi.fn().mockResolvedValue({
      createdIds: ['openai-api/gpt-5-low', 'openai-api/gpt-5-high'],
      failedIds: ['openai-api/gpt-5-medium'],
    });
    render(() => (
      <ModelAliasesPanel
        aliases={[]}
        models={[model({ provider: 'openai', authType: 'api_key', model: 'gpt-5' })]}
        onCreate={vi.fn<(_: CreateModelAliasInput) => Promise<void>>()}
        onUpdate={vi.fn<(_: string, __: UpdateModelAliasInput) => Promise<void>>()}
        onToggle={vi.fn<(_: string, __: boolean) => Promise<void>>()}
        onDelete={vi.fn<(_: string) => Promise<void>>()}
        onCreateVariants={onCreateVariants}
        getParamSpecs={async () => [reasoningSpec(['low', 'medium', 'high'])]}
      />
    ));

    await screen.findByDisplayValue('openai-api/gpt-5');
    const expose = screen.getByText('Expose variants') as HTMLButtonElement;
    await waitFor(() => expect(expose.disabled).toBe(false));
    fireEvent.click(expose);

    expect((await screen.findByRole('status')).textContent).toBe(
      'Created: openai-api/gpt-5-low, openai-api/gpt-5-high. Failed: openai-api/gpt-5-medium.',
    );
  });

  it('reports network failures and prevents double-submit while creating variants', async () => {
    let fail: ((reason?: unknown) => void) | undefined;
    const onCreateVariants = vi.fn(
      () =>
        new Promise<{ createdIds: string[]; failedIds: string[] }>((_, reject) => (fail = reject)),
    );
    render(() => (
      <ModelAliasesPanel
        aliases={[]}
        models={[model({ provider: 'openai', authType: 'api_key', model: 'gpt-5' })]}
        onCreate={vi.fn<(_: CreateModelAliasInput) => Promise<void>>()}
        onUpdate={vi.fn<(_: string, __: UpdateModelAliasInput) => Promise<void>>()}
        onToggle={vi.fn<(_: string, __: boolean) => Promise<void>>()}
        onDelete={vi.fn<(_: string) => Promise<void>>()}
        onCreateVariants={onCreateVariants}
        getParamSpecs={async () => [reasoningSpec(['low'])]}
      />
    ));

    const expose = screen.getByText('Expose variants') as HTMLButtonElement;
    await waitFor(() => expect(expose.disabled).toBe(false));
    fireEvent.click(expose);
    fireEvent.click(expose);
    expect(onCreateVariants).toHaveBeenCalledTimes(1);
    expect((screen.getByText('Add alias') as HTMLButtonElement).disabled).toBe(true);

    fail?.(new Error('Network unavailable'));
    expect((await screen.findByRole('status')).textContent).toBe('Failed: openai-api/gpt-5-low.');
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
