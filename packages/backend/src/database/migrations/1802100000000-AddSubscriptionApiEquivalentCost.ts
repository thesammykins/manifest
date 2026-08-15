import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionApiEquivalentCost1802100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_messages" ADD COLUMN "api_equivalent_cost_usd" decimal(10,6)`,
    );
    await queryRunner.query(`ALTER TABLE "agent_messages" ADD COLUMN "api_pricing_source" varchar`);
    await queryRunner.query(
      `ALTER TABLE "agent_messages" ADD COLUMN "api_pricing_model_id" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_messages" DROP COLUMN "api_pricing_model_id"`);
    await queryRunner.query(`ALTER TABLE "agent_messages" DROP COLUMN "api_pricing_source"`);
    await queryRunner.query(`ALTER TABLE "agent_messages" DROP COLUMN "api_equivalent_cost_usd"`);
  }
}
