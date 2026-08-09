import {
  buildCredentialFailureFallback,
  buildCredentialFailureForward,
  credentialFailureCode,
  presentCredentialFailure,
  resolveRouteCredentials,
  CREDENTIAL_FAILURE_HTTP_STATUS,
} from '../route-credentials';
import type { OAuthServiceSet } from '../oauth-credentials';

describe('route-credentials', () => {
  describe('presentCredentialFailure', () => {
    it('maps missing key to M100', () => {
      const p = presentCredentialFailure(
        'no_provider_key',
        'openai',
        'https://dash.example/routing',
      );
      expect(p.code).toBe('M100');
      expect(p.reason).toBe('no_provider_key');
      expect(p.status).toBe(CREDENTIAL_FAILURE_HTTP_STATUS);
      expect(p.message).toContain('M100');
      expect(p.message).toContain('No openai API key yet');
      expect(p.errorBody).toContain('M100');
    });

    it('maps dead subscription OAuth to M102', () => {
      const p = presentCredentialFailure(
        'subscription_credentials_unusable',
        'anthropic',
        'https://dash.example/routing',
      );
      expect(p.code).toBe('M102');
      expect(p.reason).toBe('subscription_credentials_unusable');
      expect(p.message).toContain('subscription credentials could not be refreshed');
      expect(credentialFailureCode('subscription_credentials_unusable')).toBe('M102');
    });
  });

  describe('buildCredentialFailureForward / Fallback', () => {
    const presentation = presentCredentialFailure(
      'no_provider_key',
      'openai',
      'https://dash.example/routing',
    );

    it('builds a synthetic primary forward with a recorded attempt', async () => {
      const startProviderAttempt = jest.fn().mockReturnValue({
        id: 'att-1',
        attemptNumber: 1,
        startedAtMs: 1,
        startedAt: new Date(1).toISOString(),
        pendingWrite: Promise.resolve(true),
      });

      const forward = buildCredentialFailureForward({
        provider: 'openai',
        model: 'gpt-5.5',
        authType: 'api_key',
        tenantProviderId: null,
        keyLabel: 'Work',
        presentation,
        startProviderAttempt,
      });

      expect(forward.response.status).toBe(401);
      expect(forward.providerCallStarted).toBe(true);
      expect(forward.attempt?.id).toBe('att-1');
      expect(forward.attempt?.completedAtMs).toBeDefined();
      expect(await forward.response.text()).toContain('M100');
      expect(startProviderAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', model: 'gpt-5.5', keyLabel: 'Work' }),
      );
    });

    it('builds a mid-chain FailedFallback-shaped entry with the same body policy', () => {
      const entry = buildCredentialFailureFallback({
        model: 'MiniMax-M3',
        provider: 'minimax',
        fallbackIndex: 0,
        authType: 'api_key',
        tenantProviderId: null,
        keyLabel: 'Backup',
        presentation,
      });

      expect(entry).toMatchObject({
        model: 'MiniMax-M3',
        provider: 'minimax',
        fallbackIndex: 0,
        status: 401,
        providerCallStarted: true,
        // The failed hop names its own connection instead of inheriting the
        // primary's label at record time.
        keyLabel: 'Backup',
      });
      expect(entry.errorBody).toBe(presentation.errorBody);
    });
  });

  describe('resolveRouteCredentials', () => {
    const oauth = {
      openaiOauth: { unwrapToken: jest.fn() },
      minimaxOauth: { unwrapToken: jest.fn() },
      anthropicOauth: { unwrapToken: jest.fn() },
      geminiOauth: { unwrapToken: jest.fn() },
      kiroOauth: { unwrapToken: jest.fn() },
      xaiOauth: { unwrapToken: jest.fn() },
    } as unknown as OAuthServiceSet;

    const providerKeyService = {
      selectProviderKey: jest.fn(),
      getProviderApiKey: jest.fn(),
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('returns no_provider_key when no connection row exists', async () => {
      providerKeyService.selectProviderKey.mockResolvedValue(null);
      const result = await resolveRouteCredentials(
        { providerKeyService, oauth },
        {
          agentId: 'a1',
          tenantId: 't1',
          provider: 'openai',
          authType: 'api_key',
        },
      );
      expect(result).toEqual({
        ok: false,
        reason: 'no_provider_key',
        tenantProviderId: null,
      });
    });

    it('returns subscription_credentials_unusable when OAuth unwrap fails on a blob', async () => {
      const blob = JSON.stringify({ t: 'access', r: 'refresh', e: 0 });
      providerKeyService.selectProviderKey.mockResolvedValue({
        apiKey: blob,
        id: 'up-1',
        region: null,
        label: 'Default',
        priority: 0,
      });
      (oauth.openaiOauth.unwrapToken as jest.Mock).mockResolvedValue(null);

      const result = await resolveRouteCredentials(
        { providerKeyService, oauth },
        {
          agentId: 'a1',
          tenantId: 't1',
          provider: 'openai',
          authType: 'subscription',
        },
      );

      expect(result).toEqual({
        ok: false,
        reason: 'subscription_credentials_unusable',
        tenantProviderId: 'up-1',
      });
    });

    it('returns usable credentials for a plain API key', async () => {
      providerKeyService.selectProviderKey.mockResolvedValue({
        apiKey: 'sk-live',
        id: 'up-1',
        region: 'us',
        label: 'Work',
        priority: 0,
      });

      const result = await resolveRouteCredentials(
        { providerKeyService, oauth },
        {
          agentId: 'a1',
          tenantId: 't1',
          provider: 'openai',
          authType: 'api_key',
          providerKeyLabel: 'Work',
        },
      );

      expect(result).toEqual({
        ok: true,
        apiKey: 'sk-live',
        rawApiKey: 'sk-live',
        resourceUrl: undefined,
        providerRegion: 'us',
        tenantProviderId: 'up-1',
        keyLabel: 'Work',
      });
    });

    it('uses the selected connection label when a requested pin is stale', async () => {
      providerKeyService.selectProviderKey.mockResolvedValue({
        apiKey: 'sk-default',
        id: 'default-id',
        region: null,
        label: 'Default',
        priority: 0,
      });

      const result = await resolveRouteCredentials(
        { providerKeyService, oauth },
        {
          agentId: 'a1',
          tenantId: 't1',
          provider: 'openai',
          authType: 'api_key',
          providerKeyLabel: 'Retired',
          credentialMode: 'pinned',
        },
      );

      expect(result).toMatchObject({
        ok: true,
        tenantProviderId: 'default-id',
        keyLabel: 'Default',
      });
    });

    it('tries the next same-provider subscription credential after an unusable one', async () => {
      const candidateService = providerKeyService as typeof providerKeyService & {
        getProviderKeyCandidates: jest.Mock;
      };
      candidateService.getProviderKeyCandidates = jest.fn().mockResolvedValue([
        {
          apiKey: JSON.stringify({ t: 'expired-default', r: 'refresh-default', e: 0 }),
          id: 'default-id',
          region: null,
          label: 'Default',
          priority: 0,
        },
        {
          apiKey: 'backup-token',
          id: 'backup-id',
          region: 'us',
          label: 'Backup',
          priority: 1,
        },
      ]);
      (oauth.openaiOauth.unwrapToken as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('backup-access');

      const result = await resolveRouteCredentials(
        { providerKeyService: candidateService, oauth },
        {
          agentId: 'a1',
          tenantId: 't1',
          provider: 'openai',
          authType: 'subscription',
        },
      );

      expect(result).toMatchObject({
        ok: true,
        apiKey: 'backup-access',
        rawApiKey: 'backup-token',
        tenantProviderId: 'backup-id',
        keyLabel: 'Backup',
        providerRegion: 'us',
      });
      expect(candidateService.getProviderKeyCandidates).toHaveBeenCalledWith(
        't1',
        'openai',
        'subscription',
        undefined,
        'a1',
        'same_provider_failover',
      );
    });

    it('leaves an unpinned API-key route unlabelled', async () => {
      delete (providerKeyService as Record<string, unknown>).getProviderKeyCandidates;
      providerKeyService.selectProviderKey.mockResolvedValue({
        apiKey: 'sk-live',
        id: 'up-work',
        region: null,
        label: 'Work',
        priority: 1,
      });

      const result = await resolveRouteCredentials(
        { providerKeyService, oauth },
        { agentId: 'a1', tenantId: 't1', provider: 'openai', authType: 'api_key' },
      );

      expect(result).toMatchObject({ ok: true, tenantProviderId: 'up-work', keyLabel: undefined });
    });
  });
});
