import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { computeTokenCost } from '../../common/utils/cost-calculator';
import { decrypt, getEncryptionSecret } from '../../common/utils/crypto.util';
import { extractSubscriptionPlan } from '../../common/utils/subscription-plan';
import { BackfillState } from '../../entities/backfill-state.entity';
import { ModelPricingCacheService } from '../../model-prices/model-pricing-cache.service';

export const SUBSCRIPTION_PRICING_BACKFILL_NAME = 'subscription_api_equivalent_cost_v1';
export const SUBSCRIPTION_PRICING_BACKFILL_LOCK_KEY = 1802200000;
const BATCH_SIZE = 500;

interface CostRow {
  id: string;
  model: string;
  input_tokens: number | string;
  output_tokens: number | string;
  cache_read_tokens: number | string;
  cache_creation_tokens: number | string;
}

@Injectable()
export class SubscriptionPricingBackfillBootService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubscriptionPricingBackfillBootService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly pricingCache: ModelPricingCacheService,
    @InjectRepository(BackfillState)
    private readonly stateRepo: Repository<BackfillState>,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env['NODE_ENV'] !== 'production') return;
    void this.runOnce().catch((error) => {
      this.logger.error(
        `subscription pricing backfill failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async runOnce(): Promise<boolean> {
    if ((await this.stateRepo.countBy({ name: SUBSCRIPTION_PRICING_BACKFILL_NAME })) > 0) {
      return true;
    }
    await this.pricingCache.whenInitialized();
    if (this.pricingCache.getAll().length === 0) {
      this.logger.warn('pricing cache is empty; subscription history will retry on next boot');
      return false;
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    let acquired = false;
    try {
      const lockRows = (await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [
        SUBSCRIPTION_PRICING_BACKFILL_LOCK_KEY,
      ])) as { locked: boolean }[];
      acquired = lockRows[0]?.locked === true;
      if (!acquired) return false;
      if ((await this.stateRepo.countBy({ name: SUBSCRIPTION_PRICING_BACKFILL_NAME })) > 0) {
        return true;
      }

      await this.hydrateOpenAiPlans();
      let lastId = '';
      let updated = 0;
      for (;;) {
        const rows = (await runner.query(
          `SELECT id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens
             FROM agent_messages
            WHERE auth_type = 'subscription'
              AND api_equivalent_cost_usd IS NULL
              AND model IS NOT NULL
              AND id > $1
              AND (COALESCE(input_tokens, 0) > 0 OR COALESCE(output_tokens, 0) > 0)
            ORDER BY id
            LIMIT $2`,
          [lastId, BATCH_SIZE],
        )) as CostRow[];
        if (rows.length === 0) break;
        lastId = rows.at(-1)!.id;
        const values = rows.flatMap((row) => {
          const pricing = this.pricingCache.getByModel(row.model);
          const cost = computeTokenCost({
            inputTokens: Number(row.input_tokens) || 0,
            outputTokens: Number(row.output_tokens) || 0,
            cacheReadTokens: Number(row.cache_read_tokens) || 0,
            cacheCreationTokens: Number(row.cache_creation_tokens) || 0,
            model: row.model,
            pricing,
          });
          return cost == null
            ? []
            : [
                {
                  id: row.id,
                  cost,
                  source: pricing?.source ?? null,
                  model_id: pricing?.model_name ?? row.model,
                },
              ];
        });
        if (values.length > 0) {
          await runner.query(
            `UPDATE agent_messages AS m
                SET api_equivalent_cost_usd = v.cost,
                    api_pricing_source = v.source,
                    api_pricing_model_id = v.model_id,
                    api_pricing_basis = 'current_backfill'
               FROM jsonb_to_recordset($1::jsonb)
                 AS v(id varchar, cost numeric, source varchar, model_id varchar)
              WHERE m.id = v.id AND m.api_equivalent_cost_usd IS NULL`,
            [JSON.stringify(values)],
          );
          updated += values.length;
        }
      }

      await this.stateRepo
        .createQueryBuilder()
        .insert()
        .into(BackfillState)
        .values({ name: SUBSCRIPTION_PRICING_BACKFILL_NAME })
        .orIgnore()
        .execute();
      this.logger.log(`subscription pricing backfill complete: estimated ${updated} message(s)`);
      return true;
    } finally {
      if (acquired) {
        await runner
          .query('SELECT pg_advisory_unlock($1)', [SUBSCRIPTION_PRICING_BACKFILL_LOCK_KEY])
          .catch(() => undefined);
      }
      await runner.release();
    }
  }

  private async hydrateOpenAiPlans(): Promise<void> {
    const rows = (await this.dataSource.query(
      `SELECT id, api_key_encrypted
         FROM tenant_providers
        WHERE provider = 'openai' AND auth_type = 'subscription'
          AND subscription_plan IS NULL AND api_key_encrypted IS NOT NULL`,
    )) as { id: string; api_key_encrypted: string }[];
    for (const row of rows) {
      try {
        const raw = decrypt(row.api_key_encrypted, getEncryptionSecret());
        const plan = extractSubscriptionPlan('openai', raw);
        if (plan) {
          await this.dataSource.query(
            `UPDATE tenant_providers SET subscription_plan = $1 WHERE id = $2 AND subscription_plan IS NULL`,
            [plan, row.id],
          );
        }
      } catch {
        // A stale or differently encrypted credential must not block usage-cost enrichment.
      }
    }
  }
}
