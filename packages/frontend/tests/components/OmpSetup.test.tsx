import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@solidjs/testing-library';

import OmpSetup, { getOmpModelsYaml, OMP_LAUNCH_COMMAND } from '../../src/components/OmpSetup';

const writeText = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('navigator', {
  clipboard: { writeText },
});

describe('OmpSetup', () => {
  it('generates a valid discovery-backed OMP provider config', () => {
    const yaml = getOmpModelsYaml('https://manifest.example/v1', 'mnfst_test_key');

    expect(yaml).toBe(
      [
        'providers:',
        '  manifest:',
        '    baseUrl: "https://manifest.example/v1"',
        '    apiKey: "mnfst_test_key"',
        '    api: openai-responses',
        '    authHeader: true',
        '    discovery:',
        '      type: openai-models-list',
      ].join('\n'),
    );
  });

  it('quotes endpoint and key values at the YAML trust boundary', () => {
    const yaml = getOmpModelsYaml('https://example.test/v1#route', 'mnfst_key: value');
    const [, , baseUrlLine, apiKeyLine] = yaml.split('\n');
    const parsedBaseUrl = JSON.parse(baseUrlLine.slice(baseUrlLine.indexOf(':') + 1).trim());
    const parsedApiKey = JSON.parse(apiKeyLine.slice(apiKeyLine.indexOf(':') + 1).trim());

    expect(parsedBaseUrl).toBe('https://example.test/v1#route');
    expect(parsedApiKey).toBe('mnfst_key: value');
  });

  it('renders the config, copies the full key, and provides the launch command', async () => {
    const { container } = render(() => (
      <OmpSetup apiKey="mnfst_secret" keyPrefix="mnfst_live" baseUrl="http://localhost:3001/v1" />
    ));

    expect(container.textContent).toContain('~/.omp/agent/models.yml');
    expect(container.textContent).toContain('mnfst_secret');
    expect(container.textContent).toContain('openai-models-list');
    expect(container.textContent).toContain(OMP_LAUNCH_COMMAND);

    const buttons = container.querySelectorAll('.setup-cli-block__actions button');
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('apiKey: "mnfst_secret"'));
      expect(writeText).toHaveBeenCalledWith(OMP_LAUNCH_COMMAND);
    });
  });

  it('keeps a fetched key prefix redacted when the full key is unavailable', () => {
    const { container } = render(() => (
      <OmpSetup apiKey={null} keyPrefix="mnfst_live" baseUrl="http://localhost:3001/v1" />
    ));

    expect(container.textContent).toContain('mnfst_live...');
    expect(container.textContent).not.toContain('mnfst_YOUR_KEY');
  });
});
