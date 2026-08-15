import { PricingEntry } from '../../model-prices/model-pricing-cache.service';

export interface CostInput {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  model: string | null | undefined;
  pricing: PricingEntry | undefined;
  /**
   * When true, cost is subscription-based and the per-token pricing is
   * ignored. The default is `0` (flat-fee plans like Claude Max or ChatGPT
   * Plus), but providers that publish a per-request rate (OpenCode Go) pass
   * a non-null `perRequestCostUsd` to record the actual dollar value of the
   * single request being logged.
   */
  isSubscription?: boolean;
  /**
   * For subscription providers that bill against a dollar quota on a
   * per-request basis (e.g. OpenCode Go), the fixed USD cost the docs
   * attribute to one request. Ignored unless `isSubscription` is true.
   */
  perRequestCostUsd?: number | null;
  /**
   * USD cost reported by the upstream provider in the response usage block.
   * Used for subscription providers that debit a quota/balance per request
   * (for example NousResearch Portal) instead of being flat-fee unlimited.
   */
  reportedCostUsd?: number | null;
}

export interface UsageCostComparison {
  /** What the provider actually charged for this attempt. */
  actualCostUsd: number | null;
  /** What the same token usage would have cost at the matched API rate. */
  apiEquivalentCostUsd: number | null;
  /** API-equivalent cost minus actual cost, clamped at zero. */
  estimatedApiSavingsUsd: number | null;
  /** Pricing source snapshotted with the estimate for later explanation. */
  apiPricingSource: PricingEntry['source'] | null;
  /** Exact pricing-cache model entry that produced the estimate. */
  apiPricingModelId: string | null;
}

/**
 * Computes the USD cost for a set of tokens given a pricing entry.
 *
 * Returns:
 * - `reportedCostUsd` when subscription usage includes a provider-reported
 *   non-negative USD cost (NousResearch Portal pattern)
 * - `perRequestCostUsd` when the usage is subscription-based AND a positive
 *   per-request rate is provided (OpenCode Go pattern)
 * - `0` when the usage is subscription-based with no per-request rate
 *   (flat-fee subscriptions: Claude Max, ChatGPT Plus, GLM Coding, etc.)
 * - `null` when the model is unknown, tokens are zero, or pricing is unavailable
 * - the computed cost otherwise
 */
export function computeTokenCost(input: CostInput): number | null {
  if (!input.model) return null;
  if (input.isSubscription) {
    if (input.reportedCostUsd != null && input.reportedCostUsd >= 0) {
      return input.reportedCostUsd;
    }
    if (input.perRequestCostUsd != null && input.perRequestCostUsd > 0) {
      return input.perRequestCostUsd;
    }
    return 0;
  }
  if (input.inputTokens === 0 && input.outputTokens === 0) return null;

  const pricing = input.pricing;
  if (!pricing || pricing.input_price_per_token == null || pricing.output_price_per_token == null) {
    return null;
  }

  const inputPrice = Number(pricing.input_price_per_token);
  const outputPrice = Number(pricing.output_price_per_token);
  const cacheReadTokens = Math.min(input.inputTokens, Math.max(0, input.cacheReadTokens ?? 0));
  const cacheCreationTokens = Math.min(
    input.inputTokens - cacheReadTokens,
    Math.max(0, input.cacheCreationTokens ?? 0),
  );
  const uncachedInputTokens = Math.max(
    0,
    input.inputTokens - cacheReadTokens - cacheCreationTokens,
  );
  const cacheReadPrice =
    pricing.cache_read_price_per_token != null
      ? Number(pricing.cache_read_price_per_token)
      : inputPrice;
  const cacheWritePrice =
    pricing.cache_write_price_per_token != null
      ? Number(pricing.cache_write_price_per_token)
      : inputPrice;

  const cost =
    uncachedInputTokens * inputPrice +
    cacheReadTokens * cacheReadPrice +
    cacheCreationTokens * cacheWritePrice +
    input.outputTokens * outputPrice;

  return cost < 0 ? null : cost;
}

/**
 * Compute the actual charged cost and, for subscription usage, the API-rate
 * counterfactual for the same model and tokens. This deliberately excludes the
 * subscription's recurring plan fee: that fee is shared with usage outside
 * Manifest and cannot be allocated truthfully to one provider attempt.
 */
export function computeUsageCostComparison(input: CostInput): UsageCostComparison {
  const actualCostUsd = computeTokenCost(input);
  if (!input.isSubscription) {
    return {
      actualCostUsd,
      apiEquivalentCostUsd: null,
      estimatedApiSavingsUsd: null,
      apiPricingSource: null,
      apiPricingModelId: null,
    };
  }

  const apiEquivalentCostUsd = computeTokenCost({
    ...input,
    isSubscription: false,
    perRequestCostUsd: null,
    reportedCostUsd: null,
  });
  const estimatedApiSavingsUsd =
    actualCostUsd == null || apiEquivalentCostUsd == null
      ? null
      : Math.max(apiEquivalentCostUsd - actualCostUsd, 0);

  return {
    actualCostUsd,
    apiEquivalentCostUsd,
    estimatedApiSavingsUsd,
    apiPricingSource: apiEquivalentCostUsd == null ? null : (input.pricing?.source ?? null),
    apiPricingModelId:
      apiEquivalentCostUsd == null ? null : (input.pricing?.model_name ?? input.model ?? null),
  };
}
