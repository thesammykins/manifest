import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { entities, migrations } from './data-source-definitions';
import { ExposedModelRoute } from '../entities/exposed-model-route.entity';
import { AgentModelFilter } from '../entities/agent-model-filter.entity';

describe('migration registry', () => {
  it('registers every source migration exactly once', () => {
    const sourceNames = readdirSync(join(__dirname, 'migrations'))
      .filter((file) => /^\d+-.+\.ts$/.test(file) && !file.endsWith('.spec.ts'))
      .map((file) => {
        const [, timestamp, description] = file.match(/^(\d+)-(.+)\.ts$/)!;
        return `${description}${timestamp}`;
      })
      .sort();
    const registeredNames = migrations.map((Migration) => Migration.name).sort();

    expect(registeredNames).toEqual(sourceNames);
  });

  it('registers the credential-routing schema prerequisites in order', () => {
    const migrationIndex = (name: string) =>
      migrations.findIndex((Migration) => Migration.name === name);

    expect(entities).toEqual(expect.arrayContaining([ExposedModelRoute, AgentModelFilter]));
    expect(migrationIndex('AddExposedModelRoutes1795200000000')).toBeGreaterThanOrEqual(0);
    expect(migrationIndex('AddAgentModelFilters1800400000000')).toBeGreaterThanOrEqual(0);
    expect(migrationIndex('AddExposedModelRoutes1795200000000')).toBeLessThan(
      migrationIndex('AddCredentialSelectionAndOAuthLabels1801700000000'),
    );
    expect(migrationIndex('AddAgentModelFilters1800400000000')).toBeLessThan(
      migrationIndex('AddRequestsAndProviderAttempts1801000000000'),
    );
  });
});
