import { SubscriptionPricingBackfillBootService } from './subscription-pricing-backfill.boot.service';

describe('SubscriptionPricingBackfillBootService', () => {
  it('recalculates historical subscription usage at current API rates', async () => {
    let selected = false;
    const query = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return [{ locked: true }];
      if (sql.includes('SELECT id, model')) {
        if (selected) return [];
        selected = true;
        return [
          {
            id: 'message-1',
            model: 'gpt-test',
            input_tokens: 100,
            output_tokens: 20,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
          },
        ];
      }
      return [];
    });
    const runner = { connect: jest.fn(), release: jest.fn(), query };
    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(runner),
      query: jest.fn().mockResolvedValue([]),
    };
    const pricing = {
      whenInitialized: jest.fn().mockResolvedValue(undefined),
      getAll: jest.fn().mockReturnValue([{ model_name: 'gpt-test' }]),
      getByModel: jest.fn().mockReturnValue({
        model_name: 'gpt-test',
        input_price_per_token: 0.001,
        output_price_per_token: 0.002,
        source: 'models.dev',
      }),
    };
    const execute = jest.fn().mockResolvedValue(undefined);
    const stateRepo = {
      countBy: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute,
      }),
    };
    const service = new SubscriptionPricingBackfillBootService(
      dataSource as never,
      pricing as never,
      stateRepo as never,
    );

    await expect(service.runOnce()).resolves.toBe(true);

    const updateCall = query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE agent_messages AS m'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toContain("api_pricing_basis = 'current_backfill'");
    expect(JSON.parse(updateCall![1][0])).toEqual([
      {
        id: 'message-1',
        cost: 0.14,
        source: 'models.dev',
        model_id: 'gpt-test',
      },
    ]);
    expect(execute).toHaveBeenCalled();
  });

  it('defers without marking complete when pricing is unavailable', async () => {
    const stateRepo = { countBy: jest.fn().mockResolvedValue(0) };
    const service = new SubscriptionPricingBackfillBootService(
      { createQueryRunner: jest.fn() } as never,
      {
        whenInitialized: jest.fn().mockResolvedValue(undefined),
        getAll: jest.fn().mockReturnValue([]),
      } as never,
      stateRepo as never,
    );

    await expect(service.runOnce()).resolves.toBe(false);
  });
});
