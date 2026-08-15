import { QueryRunner } from 'typeorm';
import { AddSubscriptionApiEquivalentCost1802100000000 } from './1802100000000-AddSubscriptionApiEquivalentCost';

describe('AddSubscriptionApiEquivalentCost1802100000000', () => {
  const queryRunner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner;
  const migration = new AddSubscriptionApiEquivalentCost1802100000000();

  beforeEach(() => jest.clearAllMocks());

  it('adds the nullable API-equivalent pricing snapshot columns', async () => {
    await migration.up(queryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(3);
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('"api_equivalent_cost_usd" decimal(10,6)'),
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('"api_pricing_source" varchar'),
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('"api_pricing_model_id" varchar'),
    );
  });

  it('drops the pricing snapshot columns in reverse order', async () => {
    await migration.down(queryRunner);

    expect(queryRunner.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('DROP COLUMN "api_pricing_model_id"'),
    );
    expect(queryRunner.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('DROP COLUMN "api_equivalent_cost_usd"'),
    );
  });
});
