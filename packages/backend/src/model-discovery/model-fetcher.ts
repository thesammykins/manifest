/**
 * Types for provider-native model discovery.
 *
 * Each provider's /models API is called using a FetcherConfig that describes
 * the endpoint, auth header, and response parser. The result is a list of
 * DiscoveredModel objects cached in tenant_providers.cached_models.
 */

import type { AuthType, ModelCapability, ModelModality } from 'manifest-shared';

/**
 * Default context-window size assumed when a provider's API or the pricing
 * cache does not report one. Single source of truth for model discovery.
 */
export const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * Opaque Codex `/models` metadata retained from the ChatGPT subscription
 * catalog. Codex evolves this object independently of Manifest, so preserve
 * unknown fields while naming the fields Manifest uses to build alias rows.
 */
export interface CodexModelInfo {
  slug: string;
  display_name: string;
  description?: string | null;
  default_reasoning_level?: string | null;
  supported_reasoning_levels?: Array<{
    effort: string;
    description: string;
  }>;
  visibility?: string;
  supported_in_api?: boolean;
  priority?: number;
}

export interface DiscoveredModel {
  id: string;
  displayName: string;
  provider: string;
  contextWindow: number;
  inputPricePerToken: number | null;
  outputPricePerToken: number | null;
  capabilityReasoning: boolean;
  capabilityCode: boolean;
  capabilities?: readonly ModelCapability[];
  inputModalities?: readonly ModelModality[];
  outputModalities?: readonly ModelModality[];
  supportedEndpoints?: readonly string[];
  qualityScore: number;
  authType?: AuthType;
  codexModelInfo?: CodexModelInfo;
}

export interface FetcherConfig {
  /** Base URL for the models endpoint. */
  endpoint: string | ((key: string) => string);
  /** Build the Authorization / auth header(s). */
  buildHeaders: (key: string, authType?: string) => Record<string, string>;
  /** Parse provider-specific response JSON into DiscoveredModel[]. */
  parse: (body: unknown, provider: string) => DiscoveredModel[];
}
