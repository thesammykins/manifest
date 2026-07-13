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

export function getCodexConfig(baseUrl: string): string {
  return [
    'model = "auto"',
    'model_provider = "manifest"',
    '',
    '[model_providers.manifest]',
    'name = "Manifest"',
    `base_url = ${tomlString(baseUrl)}`,
    'env_key = "MANIFEST_API_KEY"',
    'env_key_instructions = "Set MANIFEST_API_KEY to this harness key before starting Codex."',
    'wire_api = "responses"',
  ].join('\n');
}

export function getCodexEnvSnippet(apiKey: string): string {
  return `export MANIFEST_API_KEY=${shellSingleQuote(apiKey)}`;
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
  const shownKey = () => {
    if (!props.apiKey) return placeholderKey;
    if (keyRevealed()) return props.apiKey;
    return props.keyPrefix ? `${props.keyPrefix}...` : placeholderKey;
  };

  return (
    <div class="setup-agents-card">
      <p class="setup-method__hint">
        Add this provider to <code class="setup-model-hint__code">~/.codex/config.toml</code>. Codex
        keeps its native model catalog, so <code class="setup-model-hint__code">/model</code>{' '}
        selections route through Manifest using the matching aliases.
      </p>

      <p class="setup-method__hint">
        Codex&apos;s hidden <code class="setup-model-hint__code">codex-auto-review</code> automatic
        approval model routes through your <strong>Simple</strong> tier. Point that tier at an
        inexpensive model such as DeepSeek V4 Flash to keep approval reviews economical.
      </p>

      <div class="setup-cli-block">
        <div class="setup-cli-block__actions">
          <CopyButton text={getCodexConfig(props.baseUrl)} />
        </div>
        <CodeBlock code={getCodexConfig(props.baseUrl)} language="toml" />
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
          <CopyButton text={getCodexEnvSnippet(copyKey())} />
        </div>
        <CodeBlock code={getCodexEnvSnippet(shownKey())} language="bash" />
      </div>
    </div>
  );
};

export default CodexSetup;
