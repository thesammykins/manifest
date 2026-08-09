import { RedactRequestParamSecrets1802000000000 } from './1802000000000-RedactRequestParamSecrets';

describe('RedactRequestParamSecrets1802000000000', () => {
  const migration = new RedactRequestParamSecrets1802000000000();
  const query = jest.fn().mockResolvedValue(undefined);
  const runner = { query } as never;

  beforeEach(() => jest.clearAllMocks());

  it('removes nested credential fields from every persisted request_params column', async () => {
    await migration.up(runner);

    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toContain('pg_temp.redact_request_param_secrets');
    expect(statements[0]).toContain('jsonb_each');
    expect(statements[0]).toContain('jsonb_array_elements');
    for (const table of ['agent_messages', 'exposed_model_routes', 'requests']) {
      const statement = statements.find((sql) => sql.includes(`UPDATE "${table}"`));
      expect(statement).toContain('IS DISTINCT FROM redacted.value');
      expect(statement).toContain('"request_params" IS NOT NULL');
    }
    for (const [, params] of query.mock.calls.slice(1)) {
      expect(params).toEqual([
        expect.arrayContaining(['apikey', 'accesstoken', 'clientsecret', 'refreshtoken']),
      ]);
    }
  });

  it('leaves the irreversible redaction in place on down', async () => {
    await migration.down(runner);
    expect(query).not.toHaveBeenCalled();
  });
});
