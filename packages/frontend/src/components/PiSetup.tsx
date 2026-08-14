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

const PI_REASONING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;

function piThinkingLevelMap(efforts: readonly string[]): Record<string, string | null> {
  const supported = new Set(efforts.map((effort) => effort.trim().toLowerCase()));
  const levels: Record<string, string | null> = {
    off: supported.has('none') ? 'none' : null,
  };
  for (const level of PI_REASONING_LEVELS) {
    levels[level] = supported.has(level) ? level : null;
  }
  levels.xhigh = supported.has('xhigh') ? 'xhigh' : supported.has('max') ? 'max' : null;
  return levels;
}

export function getPiModelsJson(
  baseUrl: string,
  apiKey: string,
  modelAliases?: ModelAlias[],
  availableModels?: AvailableModel[],
): string {
  const models = exposedSetupModels(modelAliases, availableModels).map((model) => {
    const entry: Record<string, unknown> = { id: model.id, name: model.name };
    if (model.reasoningEfforts?.length) {
      entry.reasoning = true;
      entry.thinkingLevelMap = piThinkingLevelMap(model.reasoningEfforts);
    }
    return entry;
  });

  return JSON.stringify(
    {
      providers: {
        manifest: {
          name: 'Manifest',
          baseUrl,
          api: 'openai-responses',
          apiKey,
          models,
        },
      },
    },
    null,
    2,
  );
}

const PiSetup: Component<Props> = (props) => {
  const placeholderKey = 'mnfst_YOUR_KEY';
  const shownKey = () =>
    props.apiKey ?? (props.keyPrefix ? `${props.keyPrefix}...` : placeholderKey);
  const copyKey = () => props.apiKey ?? placeholderKey;
  const settingsCopy = () =>
    getPiModelsJson(props.baseUrl, copyKey(), props.modelAliases, props.availableModels);
  const settingsShown = () =>
    getPiModelsJson(props.baseUrl, shownKey(), props.modelAliases, props.availableModels);

  return (
    <div class="setup-agents-card">
      <p class="setup-method__hint">
        Add this block to <code class="setup-model-hint__code">~/.pi/agent/models.json</code>.
        Reasoning-capable aliases use Pi's native thinking selector.
      </p>

      <div class="setup-cli-block">
        <div class="setup-cli-block__actions">
          <CopyButton text={settingsCopy()} />
        </div>
        <CodeBlock code={settingsShown()} language="json" />
      </div>
    </div>
  );
};

export default PiSetup;
