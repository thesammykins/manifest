import { createSignal, Show, type Component } from 'solid-js';
import CopyButton from './CopyButton.jsx';
import CodeBlock from './CodeBlock.jsx';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function powerShellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function getCodexConfig(baseUrl: string): string {
  return getCodexConfigForPlatform(baseUrl, 'posix');
}

export function getCodexConfigForPlatform(baseUrl: string, platform: 'posix' | 'windows'): string {
  const auth =
    platform === 'windows'
      ? 'auth = { command = "powershell.exe", args = ["-NoProfile", "-Command", "[Console]::Out.Write($env:MANIFEST_API_KEY)"] }'
      : 'auth = { command = "printenv", args = ["MANIFEST_API_KEY"] }';
  return [
    'model = "auto"',
    'model_provider = "manifest"',
    '',
    '[model_providers.manifest]',
    'name = "Manifest"',
    `base_url = ${tomlString(baseUrl)}`,
    auth,
    'wire_api = "responses"',
  ].join('\n');
}

export function getCodexEnvSnippet(apiKey: string): string {
  return getCodexEnvSnippetForPlatform(apiKey, 'posix');
}

export function getCodexEnvSnippetForPlatform(
  apiKey: string,
  platform: 'posix' | 'windows',
): string {
  return platform === 'windows'
    ? `$env:MANIFEST_API_KEY = ${powerShellSingleQuote(apiKey)}`
    : `export MANIFEST_API_KEY=${shellSingleQuote(apiKey)}`;
}

const EyeIcon: Component<{ open: boolean }> = (props) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <Show
      when={props.open}
      fallback={
        <>
          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
          <circle cx="12" cy="12" r="3" />
        </>
      }
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </Show>
  </svg>
);

const CodexSetup: Component<Props> = (props) => {
  const [keyRevealed, setKeyRevealed] = createSignal(false);
  const placeholderKey = 'mnfst_YOUR_KEY';
  const copyKey = () => props.apiKey ?? placeholderKey;
  const platform = (): 'posix' | 'windows' =>
    typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent ?? '')
      ? 'windows'
      : 'posix';
  const config = () => getCodexConfigForPlatform(props.baseUrl, platform());
  const envSnippet = (key: string) => getCodexEnvSnippetForPlatform(key, platform());
  const shownKey = () => {
    if (!props.apiKey) return placeholderKey;
    if (keyRevealed()) return props.apiKey;
    return props.keyPrefix ? `${props.keyPrefix}...` : placeholderKey;
  };

  return (
    <div class="setup-agents-card">
      <p class="setup-method__hint">
        Add this provider to <code class="setup-model-hint__code">~/.codex/config.toml</code>. Codex
        merges Manifest&apos;s alias metadata into its native model catalog, so{' '}
        <code class="setup-model-hint__code">/model</code> shows each model&apos;s supported
        reasoning levels and routes selections through Manifest.
      </p>

      <p class="setup-method__hint">
        Codex&apos;s hidden <code class="setup-model-hint__code">codex-auto-review</code> automatic
        approval model routes through your <strong>Simple</strong> tier. Point that tier at an
        inexpensive model such as DeepSeek V4 Flash to keep approval reviews economical.
      </p>

      <div class="setup-cli-block">
        <div class="setup-cli-block__actions">
          <CopyButton text={config()} />
        </div>
        <CodeBlock code={config()} language="toml" />
      </div>

      <p class="setup-method__hint">
        Set the harness key in the shell that launches{' '}
        <code class="setup-model-hint__code">codex</code>.
      </p>
      <div class="setup-cli-block">
        <div class="setup-cli-block__actions">
          <Show when={!!props.apiKey}>
            <button
              class="modal-terminal__copy"
              onClick={() => setKeyRevealed(!keyRevealed())}
              aria-label={keyRevealed() ? 'Hide API key' : 'Reveal API key'}
              title={keyRevealed() ? 'Hide key' : 'Reveal key'}
            >
              <EyeIcon open={keyRevealed()} />
            </button>
          </Show>
          <CopyButton text={envSnippet(copyKey())} />
        </div>
        <CodeBlock
          code={envSnippet(shownKey())}
          language={platform() === 'windows' ? 'powershell' : 'bash'}
        />
      </div>
    </div>
  );
};

export default CodexSetup;
