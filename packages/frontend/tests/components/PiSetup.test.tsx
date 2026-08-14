import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@solidjs/testing-library';

import PiSetup, { getPiModelsJson } from '../../src/components/PiSetup';
import type { AvailableModel, ModelAlias } from '../../src/services/api';

const writeText = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('navigator', {
  clipboard: { writeText },
});

describe('PiSetup', () => {
  it('renders a models.json block with enabled aliases', async () => {
    const aliases = [
      {
        model_id: 'openai-subscription/gpt-5.5',
        display_name: 'GPT 5.5',
        enabled: true,
      },
      {
        model_id: 'openai-subscription/gpt-5.5-high',
        display_name: 'GPT 5.5 High',
        enabled: true,
      },
      {
        model_id: 'openai-subscription/gpt-5.5-hidden',
        display_name: 'Hidden',
        enabled: false,
      },
    ] as ModelAlias[];

    const { container } = render(() => (
      <PiSetup
        apiKey={null}
        keyPrefix="mnfst_live"
        baseUrl="http://localhost:38240/v1"
        modelAliases={aliases}
      />
    ));

    expect(container.textContent).toContain('~/.pi/agent/models.json');
    expect(container.textContent).toContain('"api": "openai-responses"');
    expect(container.textContent).toContain('"apiKey": "mnfst_live..."');
    expect(container.textContent).toContain('"id": "manifest/auto"');
    expect(container.textContent).toContain('"id": "openai-subscription/gpt-5.5"');
    expect(container.textContent).toContain('"id": "openai-subscription/gpt-5.5-high"');
    expect(container.textContent).not.toContain('gpt-5.5-hidden');

    fireEvent.click(container.querySelector('[aria-label="Copy to clipboard"]')!);
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"apiKey": "mnfst_YOUR_KEY"'));
    });
  });

  it('uses Pi reasoning controls for one base model without inventing max as a Pi level', () => {
    const aliases = [
      {
        model_id: 'openai-subscription/gpt-5.6-sol',
        display_name: 'GPT-5.6 Sol',
        enabled: true,
        source_kind: 'direct',
        route: { provider: 'openai', authType: 'subscription', model: 'gpt-5.6-sol' },
        request_params: null,
      },
    ] as ModelAlias[];
    const availableModels = [
      {
        model_name: 'gpt-5.6-sol',
        provider: 'openai',
        auth_type: 'subscription',
        reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
    ] as AvailableModel[];

    const config = JSON.parse(
      getPiModelsJson('http://localhost:38240/v1', 'mnfst_key', aliases, availableModels),
    );
    const model = config.providers.manifest.models.find(
      (candidate: { id: string }) => candidate.id === 'openai-subscription/gpt-5.6-sol',
    );

    expect(config.providers.manifest.api).toBe('openai-responses');
    expect(model).toMatchObject({
      id: 'openai-subscription/gpt-5.6-sol',
      reasoning: true,
      thinkingLevelMap: {
        off: 'none',
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
      },
    });
    expect(model.thinkingLevelMap).not.toHaveProperty('max');
  });

  it('maps a provider-only max effort onto Pi xhigh', () => {
    const aliases = [
      {
        model_id: 'moonshot/kimi-k3',
        enabled: true,
        source_kind: 'direct',
        route: { provider: 'moonshot', authType: 'api_key', model: 'kimi-k3' },
        request_params: null,
      },
    ] as ModelAlias[];
    const availableModels = [
      {
        model_name: 'kimi-k3',
        provider: 'moonshot',
        auth_type: 'api_key',
        reasoning_efforts: ['max'],
      },
    ] as AvailableModel[];

    const config = JSON.parse(
      getPiModelsJson('http://localhost:38240/v1', 'mnfst_key', aliases, availableModels),
    );
    const model = config.providers.manifest.models.find(
      (candidate: { id: string }) => candidate.id === 'moonshot/kimi-k3',
    );

    expect(model.thinkingLevelMap).toMatchObject({ off: null, xhigh: 'max' });
  });
});
