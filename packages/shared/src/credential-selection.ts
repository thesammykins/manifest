/** How a route chooses among credentials for one provider/auth pair. */
export const CREDENTIAL_SELECTION_MODES = ['pinned', 'same_provider_failover'] as const;

export type CredentialSelectionMode = (typeof CREDENTIAL_SELECTION_MODES)[number];
