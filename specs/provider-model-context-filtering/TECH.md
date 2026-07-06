# Provider Model Context Filtering Technical Spec

## Data Model

Add sparse disabled-state storage in `agent_model_filters`.

Columns:

- `id`
- `tenant_id`
- `agent_id`
- `provider`
- `auth_type`
- `model_id`
- `created_at`
- `updated_at`

Only disabled models are stored. A model with no row is enabled. Setting a model back to enabled deletes the row.

Indexes:

- Unique index on `agent_id`, lower `provider`, `auth_type`, lower `model_id`.
- Index on `agent_id` for fast per-agent filtering.

## Backend Services

- Add an `AgentModelFilter` entity and migration.
- Add a small `AgentModelFilterService` responsible for:
  - listing disabled model keys for an agent
  - applying enabled/disabled flags to discovered models
  - toggling disabled state
  - checking whether a `ModelRoute` is explicitly disabled
- Extend `ModelDiscoveryService`:
  - default `getModelsForAgent()` keeps returning only enabled models
  - add a management method that returns models including disabled ones plus `enabled`
  - keep per-agent model cache invalidation working when filters change
- Update `ProviderKeyService.isRouteAvailable()` so explicitly disabled routes return unavailable before its active-provider fallback.
- Update route-chain resolution so disabled primary routes promote the first enabled fallback when possible and disabled fallback routes are dropped.

## `/v1/models`

Preserve the OpenAI-compatible response shape:

- top-level `object: "list"`
- each model row keeps `id`, `object`, `created`, `owned_by`

Add context metadata only when a positive finite value is known:

- `context_window`
- `context_length`

Context rules:

- Raw provider rows use `DiscoveredModel.contextWindow`.
- `auto` and `manifest/auto` use the minimum context among currently enabled configured routes. If no configured routes resolve, fall back to the minimum enabled discovered model context.
- Alias rows use the minimum context among the alias's effective primary route and fallback routes.
- Do not emit internal filter or routing fields.

## Dashboard API

Add authenticated routes under `/api/v1/routing/:agentName/model-filters`:

- `GET` returns provider models for management:
  - `provider`
  - `auth_type`
  - `model_name`
  - `display_name`
  - `context_window`
  - `enabled`
- `PATCH` accepts:
  - `provider`
  - `auth_type`
  - `model_name`
  - `enabled`

Validation:

- Require non-empty provider and model names.
- Require a valid auth type.
- Only allow toggling models that belong to the agent-visible provider catalog, including currently hidden rows.

## Frontend

- Add API client types and functions for model filters.
- Add a Routing page "Provider model exposure" section.
- Group rows by provider/auth type.
- Use existing button/switch styling and compact table/list patterns.
- Update local resource state after toggles instead of forcing a full page refresh.

## Tests

Backend coverage:

- `/v1/models` keeps OpenAI fields and includes context metadata for auto, aliases, and raw provider rows.
- Invalid or unknown context values are omitted.
- Hidden models are omitted from `getModelsForAgent()`, `/v1/models`, model picker data, raw direct resolution, aliases, and fallback chains.
- Disabled routes are unavailable even when provider discovery is cold.
- Filter GET/PATCH endpoints validate input, update sparse state, and invalidate model caches.

Frontend coverage:

- API route tests for `getModelFilters()` and `setModelFilterEnabled()`.
- Component/page tests that render grouped model exposure rows and toggle Show/Hide.

Verification:

- Run focused backend suites for proxy controller/service, model controller, model aliases, model discovery, and provider-key routing.
- Run focused frontend service/component/page tests for routing and model exposure.
