# Provider Model Context Filtering Product Spec

## Goal

Make Manifest's OpenAI-compatible model catalog useful for agent context budgeting while giving users a per-agent way to hide provider models they do not want advertised or routed.

## User-Facing Behavior

- `/v1/models` keeps the OpenAI-compatible list shape and official model fields.
- Visible model rows may include additive metadata:
  - `context_window`: Manifest's canonical token context limit.
  - `context_length`: compatibility alias for clients that look for this field.
- Clients continue to select models by the row's `id`.
- `auto` and `manifest/auto` expose a conservative context value based on the smallest currently enabled routed target for the agent.
- Provider model rows expose their discovered context value when it is known and finite.
- Alias rows expose the smallest known context across their effective route and fallback routes.
- Hidden provider models do not appear in `/v1/models`, normal model pickers, or direct route resolution.
- Requests that explicitly name a hidden model fail as unavailable instead of silently falling back to `auto`.
- Hidden models remain visible in a dashboard management view so users can re-enable them.

## UI Requirements

- Add a compact Routing page section named "Provider model exposure".
- Group models by provider and auth type.
- Each row shows model name, optional display name, context window, and a Show/Hide toggle.
- Toggling a model is scoped to the current agent.
- Existing provider-level enable/disable behavior stays separate. If a provider is disabled for the agent, all of its models remain unavailable regardless of model-level settings.

## Client Compatibility

- Standard OpenAI SDK model-list parsing must keep working because existing fields remain unchanged.
- Manifest-specific routing fields are not exposed in `/v1/models` by default:
  - filter state
  - route objects
  - fallback routes
  - tier/source metadata
  - provider key labels
  - request parameter defaults
- Existing `manifest_params` remains opt-in through its current query behavior.

## Success Criteria

- Agent clients can read context limits from `/v1/models` without losing OpenAI-compatible behavior.
- Hiding a provider model removes it from advertised and routable model surfaces for that agent.
- Re-enabling a model makes it visible and routable again without reconnecting the provider.
- Existing alias and raw direct routing behavior remains intact for enabled models.

## Non-Goals

- Do not implement pre-call token estimation or context-aware tier escalation.
- Do not change upstream provider discovery semantics.
- Do not expose dashboard-only routing internals through `/v1/models`.
- Do not open an upstream PR from this fork-scoped change.
