import { type Component } from 'solid-js';
import CopyButton from './CopyButton.jsx';
import CodeBlock from './CodeBlock.jsx';
import type { AvailableModel, ModelAlias } from '../services/api.js';
import { exposedSetupModels } from '../services/exposed-models.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
  modelAliases?: ModelAlias[];
  availableModels?: AvailableModel[];
}

export const OMP_LAUNCH_COMMAND = 'omp --model manifest/auto';

/** Serialize untrusted endpoint/key strings as JSON scalars, which are valid YAML scalars. */
export function getOmpModelsYaml(
  baseUrl: string,
  apiKey: string,
  modelAliases?: ModelAlias[],
  availableModels?: AvailableModel[],
): string {
  const lines = [
    'providers:',
    '  manifest:',
    `    baseUrl: ${JSON.stringify(baseUrl)}`,
    `    apiKey: ${JSON.stringify(apiKey)}`,
    '    api: openai-responses',
    '    authHeader: true',
    '    discovery:',
    '      type: openai-models-list',
  ];
  const reasoningModels = exposedSetupModels(modelAliases, availableModels).filter(
    (model) => model.reasoningEfforts?.length,
  );
  if (reasoningModels.length > 0) {
    lines.push('    modelOverrides:');
    for (const model of reasoningModels) {
      lines.push(
        `      ${JSON.stringify(model.id)}:`,
        `        name: ${JSON.stringify(model.name)}`,
        '        reasoning: true',
        '        thinking:',
        '          mode: effort',
        `          efforts: ${JSON.stringify(model.reasoningEfforts)}`,
        '        compat:',
        '          supportsReasoningEffort: true',
      );
    }
  }
  return lines.join('\n');
}

const OmpSetup: Component<Props> = (props) => {
  const placeholderKey = 'mnfst_YOUR_KEY';
  const shownKey = () =>
    props.apiKey ?? (props.keyPrefix ? `${props.keyPrefix}...` : placeholderKey);
  const copyKey = () => props.apiKey ?? placeholderKey;
  const settingsCopy = () =>
    getOmpModelsYaml(props.baseUrl, copyKey(), props.modelAliases, props.availableModels);
  const settingsShown = () =>
    getOmpModelsYaml(props.baseUrl, shownKey(), props.modelAliases, props.availableModels);

  return (
    <div class="setup-agents-card">
      <p class="setup-method__hint">
        Add this provider to <code class="setup-model-hint__code">~/.omp/agent/models.yml</code>.
        OMP discovers only the models you advertise from Manifest. Reasoning-capable models stay as
        one model with OMP's reasoning selector.
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
