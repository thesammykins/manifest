import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getModelFilters, setModelFilterEnabled } from '../../src/services/api/routing.js';

describe('model filter API helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches model filter rows for an agent', async () => {
    const payload = [
      {
        provider: 'openai',
        auth_type: 'api_key',
        model_name: 'gpt-4o',
        display_name: 'GPT-4o',
        context_window: 128000,
        enabled: true,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getModelFilters('test agent')).resolves.toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/routing/test%20agent/model-filters'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('patches a model exposure toggle', async () => {
    const updated = {
      provider: 'openai',
      auth_type: 'api_key',
      model_name: 'gpt-4o',
      display_name: 'GPT-4o',
      context_window: 128000,
      enabled: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(updated)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      setModelFilterEnabled('test agent', {
        provider: 'openai',
        auth_type: 'api_key',
        model_name: 'gpt-4o',
        enabled: false,
      }),
    ).resolves.toEqual(updated);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/routing/test%20agent/model-filters',
      expect.objectContaining({
        credentials: 'include',
        method: 'PATCH',
        body: JSON.stringify({
          provider: 'openai',
          auth_type: 'api_key',
          model_name: 'gpt-4o',
          enabled: false,
        }),
      }),
    );
  });
});
