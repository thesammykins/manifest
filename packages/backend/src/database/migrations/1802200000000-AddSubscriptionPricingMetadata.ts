import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionPricingMetadata1802200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_messages" ADD COLUMN "api_pricing_basis" varchar`);
    await queryRunner.query(
      `ALTER TABLE "tenant_providers" ADD COLUMN "subscription_plan" varchar`,
    );
    await queryRunner.query(
      `UPDATE "agent_messages" SET "api_pricing_basis" = 'event_snapshot' WHERE "api_equivalent_cost_usd" IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenant_providers" DROP COLUMN "subscription_plan"`);
    await queryRunner.query(`ALTER TABLE "agent_messages" DROP COLUMN "api_pricing_basis"`);
  }
}
