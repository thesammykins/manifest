import { SENSITIVE_REQUEST_PARAM_KEYS } from 'manifest-shared';
import { MigrationInterface, QueryRunner } from 'typeorm';

const REQUEST_PARAM_TABLES = ['agent_messages', 'exposed_model_routes', 'requests'] as const;

/**
 * Removes credential fields from every persisted request-parameter snapshot.
 * The temporary function walks objects and arrays so legacy nested values are
 * cleaned without changing unrelated JSONB fields.
 */
export class RedactRequestParamSecrets1802000000000 implements MigrationInterface {
  name = 'RedactRequestParamSecrets1802000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION pg_temp.redact_request_param_secrets(p_value jsonb, p_keys text[])
      RETURNS jsonb
      LANGUAGE plpgsql
      IMMUTABLE
      AS $$
      DECLARE
        entry record;
        result jsonb;
      BEGIN
        CASE jsonb_typeof(p_value)
          WHEN 'object' THEN
            result := '{}'::jsonb;
            FOR entry IN SELECT key, value FROM jsonb_each(p_value) LOOP
              IF lower(replace(replace(entry.key, '_', ''), '-', '')) = ANY(p_keys) THEN
                CONTINUE;
              END IF;
              result := result || jsonb_build_object(
                entry.key,
                pg_temp.redact_request_param_secrets(entry.value, p_keys)
              );
            END LOOP;
            RETURN result;
          WHEN 'array' THEN
            SELECT coalesce(
              jsonb_agg(pg_temp.redact_request_param_secrets(element.value, p_keys)),
              '[]'::jsonb
            ) INTO result
            FROM jsonb_array_elements(p_value) AS element(value);
            RETURN result;
          ELSE
            RETURN p_value;
        END CASE;
      END;
      $$
    `);

    const keys = SENSITIVE_REQUEST_PARAM_KEYS.map((key) => key.replaceAll(/[-_]/g, ''));
    for (const table of REQUEST_PARAM_TABLES) {
      await queryRunner.query(
        `
          WITH redacted AS (
            SELECT "id", pg_temp.redact_request_param_secrets("request_params", $1::text[]) AS value
            FROM "${table}"
            WHERE "request_params" IS NOT NULL
          )
          UPDATE "${table}" AS target
          SET "request_params" = redacted.value
          FROM redacted
          WHERE target."id" = redacted."id"
            AND target."request_params" IS DISTINCT FROM redacted.value
        `,
        [keys],
      );
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Redaction is irreversible; reintroducing removed credential fields would be unsafe.
  }
}
