import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCredentialSelectionAndOAuthLabels1801700000000 implements MigrationInterface {
  name = 'AddCredentialSelectionAndOAuthLabels1801700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "exposed_model_routes" ADD COLUMN IF NOT EXISTS "credential_mode" varchar`,
    );
    await queryRunner.query(`
      UPDATE "exposed_model_routes"
      SET "credential_mode" = CASE
        WHEN COALESCE("route"->>'keyLabel', '') <> '' THEN 'pinned'
        ELSE 'same_provider_failover'
      END
      WHERE "source_kind" = 'direct' AND "credential_mode" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "exposed_model_routes"
      ADD CONSTRAINT "CHK_exposed_model_routes_credential_mode"
      CHECK ("credential_mode" IS NULL OR "credential_mode" IN ('pinned', 'same_provider_failover'))
    `);
    await queryRunner.query(
      `ALTER TABLE "oauth_pending_flows" ADD COLUMN IF NOT EXISTS "label" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "oauth_pending_flows" DROP COLUMN IF EXISTS "label"`);
    await queryRunner.query(
      `ALTER TABLE "exposed_model_routes" DROP CONSTRAINT IF EXISTS "CHK_exposed_model_routes_credential_mode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "exposed_model_routes" DROP COLUMN IF EXISTS "credential_mode"`,
    );
  }
}
