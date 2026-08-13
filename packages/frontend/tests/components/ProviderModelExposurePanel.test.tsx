import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import ProviderModelExposurePanel from '../../src/components/ProviderModelExposurePanel';
import type { ModelFilterRow } from '../../src/services/api.js';

const rows: ModelFilterRow[] = [
  {
    provider: 'openai',
    auth_type: 'api_key',
    model_name: 'gpt-4o',
    display_name: 'GPT-4o',
    context_window: 128000,
    enabled: true,
  },
  {
    provider: 'openai',
    auth_type: 'api_key',
    model_name: 'gpt-4o-mini',
    display_name: null,
    context_window: 128000,
    enabled: false,
  },
  {
    provider: 'anthropic',
    auth_type: 'subscription',
    model_name: 'claude-sonnet-4',
    display_name: 'Claude Sonnet 4',
    context_window: 200000,
    enabled: true,
  },
];

describe('ProviderModelExposurePanel', () => {
  it('renders visible and hidden models grouped by provider/auth type', () => {
    render(() => (
      <ProviderModelExposurePanel rows={rows} onToggle={vi.fn()} onToggleAll={vi.fn()} />
    ));

    expect(screen.getByText('Routing model availability')).toBeTruthy();
    expect(screen.getByText('Openai')).toBeTruthy();
    expect(screen.getByText('Anthropic')).toBeTruthy();
    expect(screen.getByText('GPT-4o')).toBeTruthy();
    expect(screen.getByText('gpt-4o-mini')).toBeTruthy();
    expect(screen.getAllByText('128,000 ctx')).toHaveLength(2);
    expect(screen.getByText('1 of 2 enabled')).toBeTruthy();
  });

  it('toggles hidden models back on', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <ProviderModelExposurePanel rows={rows} onToggle={onToggle} onToggleAll={vi.fn()} />
    ));

    fireEvent.click(screen.getByText('Enable'));

    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith(rows[1], true);
    });
  });

  it('hides every model from one action', async () => {
    const onToggleAll = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <ProviderModelExposurePanel rows={rows} onToggle={vi.fn()} onToggleAll={onToggleAll} />
    ));

    fireEvent.click(screen.getByText('Disable all models'));

    await waitFor(() => {
      expect(onToggleAll).toHaveBeenCalledWith(rows, false);
    });
  });

  it('restores just one provider/auth catalog when it is fully hidden', async () => {
    const onToggleAll = vi.fn().mockResolvedValue(undefined);
    const hiddenOpenAiRows = rows.map((row) =>
      row.provider === 'openai' ? { ...row, enabled: false } : row,
    );
    render(() => (
      <ProviderModelExposurePanel
        rows={hiddenOpenAiRows}
        onToggle={vi.fn()}
        onToggleAll={onToggleAll}
      />
    ));

    fireEvent.click(screen.getByText('Enable all'));

    await waitFor(() => {
      expect(onToggleAll).toHaveBeenCalledWith(hiddenOpenAiRows.slice(0, 2), true);
    });
  });
});
