import { type Component } from 'solid-js';
import CopyButton from './CopyButton.jsx';
import CodeBlock from './CodeBlock.jsx';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
}

export const OMP_LAUNCH_COMMAND = 'omp --model manifest/auto';

/** Serialize untrusted endpoint/key strings as JSON scalars, which are valid YAML scalars. */
export function getOmpModelsYaml(baseUrl: string, apiKey: string): string {
  return [
    'providers:',
    '  manifest:',
    `    baseUrl: ${JSON.stringify(baseUrl)}`,
    `    apiKey: ${JSON.stringify(apiKey)}`,
    '    api: openai-responses',
    '    authHeader: true',
    '    discovery:',
    '      type: openai-models-list',
  ].join('\n');
}

const OmpSetup: Component<Props> = (props) => {
  const placeholderKey = 'mnfst_YOUR_KEY';
  const shownKey = () =>
    props.apiKey ?? (props.keyPrefix ? `${props.keyPrefix}...` : placeholderKey);
  const copyKey = () => props.apiKey ?? placeholderKey;
  const settingsCopy = () => getOmpModelsYaml(props.baseUrl, copyKey());
  const settingsShown = () => getOmpModelsYaml(props.baseUrl, shownKey());

  return (
    <div class="setup-agents-card">
      <p class="setup-method__hint">
        Add this provider to <code class="setup-model-hint__code">~/.omp/agent/models.yml</code>.
        OMP will discover every model and enabled alias from Manifest automatically.
      </p>

      <div class="setup-cli-block">
        <div class="setup-cli-block__actions">
          <CopyButton text={settingsCopy()} />
        </div>
        <CodeBlock code={settingsShown()} language="yaml" />
      </div>

      <p class="setup-method__hint">
        Then start OMP with Manifest's automatic route. This leaves your other OMP model roles
        unchanged.
      </p>
      <div class="setup-cli-block">
        <div class="setup-cli-block__actions">
          <CopyButton text={OMP_LAUNCH_COMMAND} />
        </div>
        <CodeBlock code={OMP_LAUNCH_COMMAND} language="bash" />
      </div>
    </div>
  );
};

export default OmpSetup;
