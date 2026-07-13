import type { ObjectLiteral, Repository } from 'typeorm';
import { Agent } from '../../entities/agent.entity';
import { ExposedModelRoute } from '../../entities/exposed-model-route.entity';
import { TenantProvider } from '../../entities/tenant-provider.entity';
import { CodexAliasService } from './codex-alias.service';

function repo<T extends ObjectLiteral>() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    insert: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

describe('CodexAliasService', () => {
  let agentRepo: jest.Mocked<Repository<Agent>>;
  let providerRepo: jest.Mocked<Repository<TenantProvider>>;
  let aliasRepo: jest.Mocked<Repository<ExposedModelRoute>>;
  let service: CodexAliasService;

  beforeEach(() => {
    agentRepo = repo<Agent>();
    providerRepo = repo<TenantProvider>();
    aliasRepo = repo<ExposedModelRoute>();
    aliasRepo.find.mockResolvedValue([]);
    service = new CodexAliasService(agentRepo, providerRepo, aliasRepo);
  });

  it('creates Codex-native aliases for an active ChatGPT subscription', async () => {
    agentRepo.find.mockResolvedValue([{ id: 'codex-1' } as Agent]);
    providerRepo.findOne.mockResolvedValue({ id: 'openai-sub' } as TenantProvider);

    await service.reconcileTenant('tenant-1');

    const inserted = aliasRepo.save.mock.calls.map(([row]) => row as ExposedModelRoute);
    expect(inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model_id: 'gpt-5.6',
          route: { provider: 'openai', authType: 'subscription', model: 'gpt-5.6-sol' },
        }),
        expect.objectContaining({
          model_id: 'gpt-5.5',
          route: { provider: 'openai', authType: 'subscription', model: 'gpt-5.5' },
        }),
        expect.objectContaining({
          model_id: 'gpt-5.4',
          route: { provider: 'openai', authType: 'subscription', model: 'gpt-5.4' },
        }),
        expect.objectContaining({
          model_id: 'gpt-5.4-mini',
          route: { provider: 'openai', authType: 'subscription', model: 'gpt-5.4-mini' },
        }),
        expect.objectContaining({
          model_id: 'gpt-5.3-codex',
          route: {
            provider: 'openai',
            authType: 'subscription',
            model: 'gpt-5.3-codex-spark',
          },
        }),
        expect.objectContaining({
          model_id: 'gpt-5.2',
          route: { provider: 'openai', authType: 'subscription', model: 'gpt-5.4' },
        }),
        expect.objectContaining({
          model_id: 'codex-auto-review',
          source_kind: 'tier',
          source_key: 'simple',
          route: null,
        }),
      ]),
    );
    expect(inserted.every((row) => row.id.startsWith('manifest:codex:'))).toBe(true);
  });

  it('leaves a user-created alias authoritative when its model id overlaps', async () => {
    agentRepo.find.mockResolvedValue([{ id: 'codex-1' } as Agent]);
    providerRepo.findOne.mockResolvedValue({ id: 'openai-sub' } as TenantProvider);
    aliasRepo.find.mockResolvedValue([
      {
        id: 'user-alias',
        model_id: 'gpt-5.5',
        route: { provider: 'openai', authType: 'api_key', model: 'gpt-5.5' },
      } as ExposedModelRoute,
    ]);

    await service.reconcileTenant('tenant-1');

    const inserted = aliasRepo.save.mock.calls.map(([row]) => row as ExposedModelRoute);
    expect(inserted.some((row) => row.model_id === 'gpt-5.5')).toBe(false);
    expect(aliasRepo.save).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'user-alias' }));
  });

  it('does not rewrite managed aliases that are already current', async () => {
    agentRepo.find.mockResolvedValue([{ id: 'codex-1' } as Agent]);
    providerRepo.findOne.mockResolvedValue({ id: 'openai-sub' } as TenantProvider);
    aliasRepo.find.mockResolvedValue([
      {
        id: 'manifest:codex:codex-1:gpt-5.5',
        model_id: 'gpt-5.5',
        display_name: 'GPT-5.5',
        enabled: true,
        source_kind: 'direct',
        source_key: null,
        route: { provider: 'openai', authType: 'subscription', model: 'gpt-5.5' },
        fallback_routes: null,
        request_params: null,
        response_mode: 'buffered',
      } as ExposedModelRoute,
    ]);

    await service.reconcileTenant('tenant-1');

    expect(aliasRepo.save).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'manifest:codex:codex-1:gpt-5.5' }),
    );
  });

  it('removes ChatGPT aliases but retains the tier-backed auto-review alias after disconnect', async () => {
    agentRepo.find.mockResolvedValue([{ id: 'codex-1' } as Agent]);
    providerRepo.findOne.mockResolvedValue(null);
    aliasRepo.find.mockResolvedValue([
      { id: 'manifest:codex:codex-1:gpt-5.5', model_id: 'gpt-5.5' },
      {
        id: 'manifest:codex:codex-1:codex-auto-review',
        model_id: 'codex-auto-review',
        display_name: 'Codex Auto Review',
        enabled: true,
        source_kind: 'tier',
        source_key: 'simple',
        route: null,
        fallback_routes: null,
        request_params: null,
        response_mode: 'buffered',
      },
      { id: 'user-alias', model_id: 'my-model' },
    ] as ExposedModelRoute[]);

    await service.reconcileTenant('tenant-1');

    expect(aliasRepo.delete).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(aliasRepo.delete.mock.calls[0]?.[0])).toContain(
      'manifest:codex:codex-1:gpt-5.5',
    );
    expect(JSON.stringify(aliasRepo.delete.mock.calls[0]?.[0])).not.toContain('user-alias');
    expect(aliasRepo.save).not.toHaveBeenCalled();
  });

  it('creates the tier-backed auto-review alias without a ChatGPT subscription', async () => {
    agentRepo.find.mockResolvedValue([{ id: 'codex-1' } as Agent]);
    providerRepo.findOne.mockResolvedValue(null);

    await service.reconcileTenant('tenant-1');

    expect(aliasRepo.save).toHaveBeenCalledTimes(1);
    expect(aliasRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        model_id: 'codex-auto-review',
        source_kind: 'tier',
        source_key: 'simple',
        route: null,
      }),
    );
  });

  it('does nothing when the tenant has no Codex harnesses', async () => {
    agentRepo.find.mockResolvedValue([]);

    await service.reconcileTenant('tenant-1');

    expect(providerRepo.findOne).not.toHaveBeenCalled();
    expect(aliasRepo.find).not.toHaveBeenCalled();
  });
});
