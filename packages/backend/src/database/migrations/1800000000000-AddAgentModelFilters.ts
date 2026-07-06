import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentModelFilters1800000000000 implements MigrationInterface {
  name = 'AddAgentModelFilters1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_model_filters" (
        "id" varchar PRIMARY KEY,
        "tenant_id" varchar NOT NULL,
        "agent_id" varchar NOT NULL,
        "provider" varchar NOT NULL,
        "auth_type" varchar NOT NULL,
        "model_id" varchar NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_agent_model_filters_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_model_filters_agent"
          FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_agent_model_filters_agent_route_lower"
        ON "agent_model_filters" ("agent_id", lower("provider"), "auth_type", lower("model_id"))
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agent_model_filters_agent"
        ON "agent_model_filters" ("agent_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_agent_model_filters_agent"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_agent_model_filters_agent_route_lower"');
    await queryRunner.query('DROP TABLE IF EXISTS "agent_model_filters"');
  }
}
