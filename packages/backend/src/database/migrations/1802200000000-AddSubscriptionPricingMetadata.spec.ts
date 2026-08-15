import { QueryRunner } from 'typeorm';
import { AddSubscriptionPricingMetadata1802200000000 } from './1802200000000-AddSubscriptionPricingMetadata';

describe('AddSubscriptionPricingMetadata1802200000000', () => {
  const queryRunner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner;
  const migration = new AddSubscriptionPricingMetadata1802200000000();

  beforeEach(() => jest.clearAllMocks());

  it('adds pricing provenance and provider plan metadata', async () => {
    await migration.up(queryRunner);
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('"api_pricing_basis" varchar'),
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('"subscription_plan" varchar'),
    );
    expect(queryRunner.query).toHaveBeenCalledWith(expect.stringContaining("'event_snapshot'"));
  });

  it('drops both columns on rollback', async () => {
    await migration.down(queryRunner);
    expect(queryRunner.query).toHaveBeenCalledTimes(2);
  });
});
