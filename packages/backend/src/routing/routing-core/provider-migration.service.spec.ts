import type { DataSource, EntityManager } from 'typeorm';
import { Agent } from '../../entities/agent.entity';
import { AgentEnabledProvider } from '../../entities/agent-enabled-provider.entity';
import { ExposedModelRoute } from '../../entities/exposed-model-route.entity';
import { HeaderTier } from '../../entities/header-tier.entity';
import { SpecificityAssignment } from '../../entities/specificity-assignment.entity';
import { TenantProvider } from '../../entities/tenant-provider.entity';
import { TierAssignment } from '../../entities/tier-assignment.entity';
import type { RoutingCacheService } from './routing-cache.service';
import { ProviderMigrationService } from './provider-migration.service';

const sourceRoute = (model: string) => ({
  provider: 'openai',
  authType: 'subscription' as const,
  model,
  keyLabel: 'Default',
});

const targetRoute = (model: string) => ({
  provider: 'openai',
  authType: 'subscription' as const,
  model,
  keyLabel: 'Backup',
});

function repo<T>(rows: T[] = []) {
  const queryBuilder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
  };
  return {
    find: jest.fn().mockResolvedValue(rows),
    save: jest.fn().mockImplementation(async (value: T | T[]) => value),
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    queryBuilder,
  };
}

describe('ProviderMigrationService', () => {
  it('previews and applies matching routes and direct aliases across all harnesses', async () => {
    const source = Object.assign(new TenantProvider(), {
      id: 'source-id',
      tenant_id: 'tenant-1',
      provider: 'openai',
      auth_type: 'subscription',
      label: 'Default',
      is_active: true,
      api_key_encrypted: 'source-key',
    });
    const target = Object.assign(new TenantProvider(), {
      id: 'target-id',
      tenant_id: 'tenant-1',
      provider: 'openai',
      auth_type: 'subscription',
      label: 'Backup',
      is_active: true,
      api_key_encrypted: 'target-key',
    });
    const tier = Object.assign(new TierAssignment(), {
      id: 'tier-1',
      agent_id: 'agent-1',
      tier: 'standard',
      override_route: sourceRoute('gpt-5'),
      fallback_routes: null,
    });
    const specificity = Object.assign(new SpecificityAssignment(), {
      id: 'specificity-1',
      agent_id: 'agent-2',
      category: 'coding',
      override_route: null,
      fallback_routes: [sourceRoute('gpt-5-codex')],
    });
    const header = Object.assign(new HeaderTier(), {
      id: 'header-1',
      agent_id: 'agent-2',
      name: 'Premium',
      override_route: sourceRoute('gpt-5-pro'),
      fallback_routes: null,
    });
    const alias = Object.assign(new ExposedModelRoute(), {
      id: 'alias-1',
      tenant_id: 'tenant-1',
      agent_id: 'agent-2',
      model_id: 'openai-subscription/gpt-5',
      source_kind: 'direct' as const,
      route: sourceRoute('gpt-5'),
      fallback_routes: null,
      credential_mode: 'pinned' as const,
    });
    const agents = [
      Object.assign(new Agent(), {
        id: 'agent-1',
        tenant_id: 'tenant-1',
        name: 'harness-one',
        display_name: null,
        is_playground: false,
        deleted_at: null,
      }),
      Object.assign(new Agent(), {
        id: 'agent-2',
        tenant_id: 'tenant-1',
        name: 'harness-two',
        display_name: 'Second harness',
        is_playground: false,
        deleted_at: null,
      }),
    ];

    const repos = new Map<unknown, ReturnType<typeof repo>>([
      [Agent, repo(agents)],
      [TenantProvider, repo([source, target])],
      [AgentEnabledProvider, repo([])],
      [TierAssignment, repo([tier])],
      [SpecificityAssignment, repo([specificity])],
      [HeaderTier, repo([header])],
      [ExposedModelRoute, repo([alias])],
    ]);
    const manager = {
      getRepository: jest.fn((entity: unknown) => repos.get(entity)),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (callback: (tx: EntityManager) => Promise<unknown>) =>
        callback(manager),
      ),
    } as unknown as DataSource;
    const cache = {
      invalidateAgent: jest.fn(),
      invalidateTenant: jest.fn(),
    } as unknown as RoutingCacheService;
    const service = new ProviderMigrationService(
      dataSource,
      cache,
      repos.get(Agent) as never,
      repos.get(TenantProvider) as never,
      repos.get(AgentEnabledProvider) as never,
      repos.get(TierAssignment) as never,
      repos.get(SpecificityAssignment) as never,
      repos.get(HeaderTier) as never,
      repos.get(ExposedModelRoute) as never,
    );
    (repos.get(TenantProvider) as { manager?: EntityManager }).manager = manager;

    const request = {
      source: { provider: 'openai', authType: 'subscription' as const, label: 'Default' },
      target: { provider: 'openai', authType: 'subscription' as const, label: 'Backup' },
      mode: 'move_routes' as const,
    };
    const preview = await service.preview('tenant-1', request);

    expect(preview.counts).toEqual({
      harnesses: 2,
      routes: 4,
      aliases: 1,
      newly_enabled_target_connections: 2,
    });
    expect(preview.routes.map((route) => `${route.surface}:${route.position}`)).toEqual([
      'tier:primary',
      'specificity:fallback 1',
      'header:primary',
      'alias:primary',
    ]);
    expect(preview.aliases[0]).toMatchObject({ id: 'alias-1', positions: ['primary'] });

    const applied = await service.apply('tenant-1', request);

    expect(tier.override_route?.keyLabel).toBe('Backup');
    expect(specificity.fallback_routes?.[0].keyLabel).toBe('Backup');
    expect(header.override_route?.keyLabel).toBe('Backup');
    expect(alias.route?.keyLabel).toBe('Backup');
    expect(applied.counts).toEqual(preview.counts);
    expect(cache.invalidateAgent).toHaveBeenCalledWith('agent-1');
    expect(cache.invalidateAgent).toHaveBeenCalledWith('agent-2');
    expect(cache.invalidateTenant).toHaveBeenCalledWith('tenant-1');
    expect(repos.get(AgentEnabledProvider)?.queryBuilder.execute).toHaveBeenCalledTimes(2);
  });

  it('enables failover for every matching direct alias when aliasIds are omitted', async () => {
    const source = Object.assign(new TenantProvider(), {
      id: 'source-id',
      tenant_id: 'tenant-1',
      provider: 'openai',
      auth_type: 'subscription',
      label: 'Default',
      is_active: true,
    });
    const alias = Object.assign(new ExposedModelRoute(), {
      id: 'alias-1',
      tenant_id: 'tenant-1',
      agent_id: 'agent-1',
      model_id: 'openai-subscription/gpt-5',
      source_kind: 'direct' as const,
      route: sourceRoute('gpt-5'),
      fallback_routes: null,
      credential_mode: 'pinned' as const,
    });
    const repos = new Map<unknown, ReturnType<typeof repo>>([
      [
        Agent,
        repo([
          Object.assign(new Agent(), {
            id: 'agent-1',
            tenant_id: 'tenant-1',
            name: 'harness-one',
            display_name: null,
            is_playground: false,
            deleted_at: null,
          }),
        ]),
      ],
      [TenantProvider, repo([source])],
      [AgentEnabledProvider, repo([])],
      [TierAssignment, repo([])],
      [SpecificityAssignment, repo([])],
      [HeaderTier, repo([])],
      [ExposedModelRoute, repo([alias])],
    ]);
    const manager = {
      getRepository: jest.fn((entity: unknown) => repos.get(entity)),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (callback: (tx: EntityManager) => Promise<unknown>) =>
        callback(manager),
      ),
    } as unknown as DataSource;
    (repos.get(TenantProvider) as { manager?: EntityManager }).manager = manager;
    const service = new ProviderMigrationService(
      dataSource,
      { invalidateAgent: jest.fn(), invalidateTenant: jest.fn() } as never,
      repos.get(Agent) as never,
      repos.get(TenantProvider) as never,
      repos.get(AgentEnabledProvider) as never,
      repos.get(TierAssignment) as never,
      repos.get(SpecificityAssignment) as never,
      repos.get(HeaderTier) as never,
      repos.get(ExposedModelRoute) as never,
    );

    const request = {
      source: { provider: 'openai', authType: 'subscription' as const, label: 'Default' },
      mode: 'enable_alias_failover' as const,
    };
    const preview = await service.preview('tenant-1', request);
    expect(preview.counts.aliases).toBe(1);

    await service.apply('tenant-1', request);

    expect(alias.credential_mode).toBe('same_provider_failover');
  });
});
