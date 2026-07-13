import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CodexSetup, {
  getCodexConfig,
  getCodexConfigForPlatform,
  getCodexEnvSnippet,
  getCodexEnvSnippetForPlatform,
} from '../../src/components/CodexSetup';

const writeText = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('navigator', {
  clipboard: { writeText },
});

describe('CodexSetup', () => {
  beforeEach(() => writeText.mockClear());

  it('emits the native Codex Responses provider config', () => {
    const config = getCodexConfig('https://manifest.example/v1');
    expect(config).toContain('model = "auto"');
    expect(config).toContain('model_provider = "manifest"');
    expect(config).toContain('[model_providers.manifest]');
    expect(config).toContain('base_url = "https://manifest.example/v1"');
    expect(config).toContain('auth = { command = "printenv", args = ["MANIFEST_API_KEY"] }');
    expect(config).toContain('wire_api = "responses"');
    expect(config).not.toContain('env_key =');
    expect(config).not.toContain('chat/completions');
    expect(config).not.toContain('model_catalog_json');
  });

  it('emits the equivalent command-backed auth config on Windows', () => {
    const config = getCodexConfigForPlatform('https://manifest.example/v1', 'windows');
    expect(config).toContain(
      'auth = { command = "powershell.exe", args = ["-NoProfile", "-Command", "[Console]::Out.Write($env:MANIFEST_API_KEY)"] }',
    );
    expect(config).not.toContain('env_key =');
    expect(getCodexEnvSnippetForPlatform("mnfst_a'b", 'windows')).toBe(
      "$env:MANIFEST_API_KEY = 'mnfst_a''b'",
    );
  });

  it('renders /model guidance and keeps the full key masked until revealed', () => {
    const { container } = render(() => (
      <CodexSetup
        apiKey="mnfst_secret"
        keyPrefix="mnfst_live"
        baseUrl="http://localhost:38240/v1"
      />
    ));

    expect(container.textContent).toContain('~/.codex/config.toml');
    expect(container.textContent).toContain('/model');
    expect(container.textContent).toContain('codex-auto-review');
    expect(container.textContent).toContain('Simple');
    expect(container.textContent).toContain('DeepSeek V4 Flash');
    expect(container.textContent).toContain("export MANIFEST_API_KEY='mnfst_live...'");
    expect(container.textContent).not.toContain('mnfst_secret');
    fireEvent.click(screen.getByLabelText('Reveal API key'));
    expect(container.textContent).toContain("export MANIFEST_API_KEY='mnfst_secret'");
  });

  it('copies the full key even while the displayed command is masked', async () => {
    const { container } = render(() => (
      <CodexSetup
        apiKey="mnfst_secret"
        keyPrefix="mnfst_live"
        baseUrl="http://localhost:38240/v1"
      />
    ));
    const blocks = container.querySelectorAll('.setup-cli-block');
    const envCopyButton = blocks[blocks.length - 1].querySelector(
      '.setup-cli-block__actions [aria-label="Copy to clipboard"]',
    );
    fireEvent.click(envCopyButton!);
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("export MANIFEST_API_KEY='mnfst_secret'");
    });
  });

  it('shell-quotes unusual key content safely', () => {
    expect(getCodexEnvSnippet("mnfst_a'b")).toBe("export MANIFEST_API_KEY='mnfst_a'\"'\"'b'");
  });
});
