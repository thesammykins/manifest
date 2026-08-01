import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { AuthType, CredentialSelectionMode, ModelRoute } from 'manifest-shared';
import { expandProviderNames } from '../../common/utils/provider-aliases';
import { isManifestUsableProvider } from '../../common/utils/subscription-support';
import { Agent } from '../../entities/agent.entity';
import { AgentEnabledProvider } from '../../entities/agent-enabled-provider.entity';
import { ExposedModelRoute } from '../../entities/exposed-model-route.entity';
import { HeaderTier } from '../../entities/header-tier.entity';
import { SpecificityAssignment } from '../../entities/specificity-assignment.entity';
import { TenantProvider } from '../../entities/tenant-provider.entity';
import { TierAssignment } from '../../entities/tier-assignment.entity';
import { RoutingCacheService } from './routing-cache.service';
import type { ProviderMigrationDto } from '../dto/routing.dto';

export interface ProviderMigrationRouteImpact {
  agent_id: string;
  agent_name: string;
  surface: 'tier' | 'specificity' | 'header' | 'alias';
  assignment_id?: string;
  alias_id?: string;
  name: string;
  position: string;
  model: string;
  provider: string;
  auth_type: AuthType;
  key_label: string;
}

export interface ProviderMigrationAliasImpact {
  id: string;
  agent_id: string;
  agent_name: string;
  model_id: string;
  positions: string[];
  credential_mode: CredentialSelectionMode | null;
}

export interface ProviderMigrationPlan {
  mode: ProviderMigrationDto['mode'];
  source: ProviderMigrationDto['source'];
  target: ProviderMigrationDto['target'] | null;
  target_provider_id: string | null;
  target_label: string | null;
  routes: ProviderMigrationRouteImpact[];
  aliases: ProviderMigrationAliasImpact[];
  affected_harnesses: Array<{
    agent_id: string;
    agent_name: string;
    route_count: number;
    alias_count: number;
  }>;
  counts: {
    harnesses: number;
    routes: number;
    aliases: number;
    newly_enabled_target_connections: number;
  };
}

interface AgentNameRow {
  id: string;
  name: string;
}

@Injectable()
export class ProviderMigrationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly routingCache: RoutingCacheService,
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
    @InjectRepository(TenantProvider)
    private readonly providerRepo: Repository<TenantProvider>,
    @InjectRepository(AgentEnabledProvider)
    private readonly enabledProviderRepo: Repository<AgentEnabledProvider>,
    @InjectRepository(TierAssignment)
    private readonly tierRepo: Repository<TierAssignment>,
    @InjectRepository(SpecificityAssignment)
    private readonly specificityRepo: Repository<SpecificityAssignment>,
    @InjectRepository(HeaderTier)
    private readonly headerTierRepo: Repository<HeaderTier>,
    @InjectRepository(ExposedModelRoute)
    private readonly aliasRepo: Repository<ExposedModelRoute>,
  ) {}

  async preview(tenantId: string, request: ProviderMigrationDto): Promise<ProviderMigrationPlan> {
    const source = await this.findProvider(tenantId, request.source);
    if (!source) {
      throw new NotFoundException(
        `Source provider key "${request.source.label}" not found for ${request.source.provider}/${request.source.authType}`,
      );
    }
    const target = await this.resolveTarget(tenantId, request, source);
    return this.buildPlan(this.providerRepo.manager, tenantId, request, source, target);
  }

  async apply(tenantId: string, request: ProviderMigrationDto): Promise<ProviderMigrationPlan> {
    let plan!: ProviderMigrationPlan;
    await this.dataSource.transaction(async (manager) => {
      const source = await this.findProvider(tenantId, request.source, manager);
      if (!source) {
        throw new NotFoundException(
          `Source provider key "${request.source.label}" not found for ${request.source.provider}/${request.source.authType}`,
        );
      }
      const target = await this.resolveTarget(tenantId, request, source, manager);
      plan = await this.buildPlan(manager, tenantId, request, source, target);
      if (request.mode === 'move_routes') {
        await this.moveRoutes(manager, tenantId, request, source, target!, plan);
        await this.enableTargets(manager, plan, target!);
      } else {
        await this.enableAliasFailover(manager, plan);
      }
    });

    for (const harness of plan.affected_harnesses) {
      this.routingCache.invalidateAgent(harness.agent_id);
    }
    this.routingCache.invalidateTenant(tenantId);
    return plan;
  }

  private async resolveTarget(
    tenantId: string,
    request: ProviderMigrationDto,
    source: TenantProvider,
    manager?: EntityManager,
  ): Promise<TenantProvider | null> {
    if (request.mode === 'enable_alias_failover') return null;
    if (!request.target) {
      throw new BadRequestException('move_routes requires a target provider key');
    }
    if (request.target.authType !== source.auth_type) {
      throw new BadRequestException('Migration target must use the same auth type as the source');
    }
    const sourceNames = expandProviderNames([source.provider]);
    const targetNames = expandProviderNames([request.target.provider]);
    if (![...sourceNames].some((name) => targetNames.has(name))) {
      throw new BadRequestException(
        'Migration target must use the same canonical provider and auth type as the source',
      );
    }
    const target = await this.findProvider(tenantId, request.target, manager);
    if (
      !target ||
      !target.is_active ||
      !isManifestUsableProvider(target) ||
      (target.auth_type !== 'local' && !target.api_key_encrypted)
    ) {
      throw new BadRequestException(
        `Target provider key "${request.target.label}" is not an active usable connection`,
      );
    }
    if (target.id === source.id) {
      throw new BadRequestException('Migration target must be different from the source');
    }
    return target;
  }

  private async findProvider(
    tenantId: string,
    ref: ProviderMigrationDto['source'],
    manager?: EntityManager,
  ): Promise<TenantProvider | null> {
    const repo = manager ? manager.getRepository(TenantProvider) : this.providerRepo;
    const names = expandProviderNames([ref.provider]);
    const rows = await repo.find({ where: { tenant_id: tenantId, auth_type: ref.authType } });
    return (
      rows.find(
        (row) =>
          row.provider.toLowerCase() === ref.provider.toLowerCase() &&
          row.label.toLowerCase() === ref.label.toLowerCase(),
      ) ??
      rows.find(
        (row) =>
          names.has(row.provider.toLowerCase()) &&
          row.label.toLowerCase() === ref.label.toLowerCase(),
      ) ??
      null
    );
  }

  private async buildPlan(
    manager: EntityManager,
    tenantId: string,
    request: ProviderMigrationDto,
    source: TenantProvider,
    target: TenantProvider | null,
  ): Promise<ProviderMigrationPlan> {
    const agentRows = await manager.getRepository(Agent).find({ where: { tenant_id: tenantId } });
    const agents: AgentNameRow[] = agentRows
      .filter((agent) => !agent.deleted_at && !agent.is_playground)
      .map((agent) => ({ id: agent.id, name: agent.display_name?.trim() || agent.name }));
    const namesById = new Map(agents.map((agent) => [agent.id, agent.name]));
    const routes: ProviderMigrationRouteImpact[] = [];
    const aliases = new Map<string, ProviderMigrationAliasImpact>();
    const agentIds = agents.map((agent) => agent.id);

    const addRoute = (
      route: ModelRoute | null,
      context: Omit<ProviderMigrationRouteImpact, 'model' | 'provider' | 'auth_type' | 'key_label'>,
    ) => {
      if (!route || !this.routeMatchesSource(route, source)) return false;
      routes.push({
        ...context,
        model: route.model,
        provider: route.provider,
        auth_type: route.authType,
        key_label: route.keyLabel!,
      });
      return true;
    };

    const tiers = await manager
      .getRepository(TierAssignment)
      .find({ where: { agent_id: In(agentIds) } });
    for (const row of tiers) {
      const context = {
        agent_id: row.agent_id,
        agent_name: namesById.get(row.agent_id) ?? row.agent_id,
        surface: 'tier' as const,
        assignment_id: row.id,
        name: row.tier,
      };
      addRoute(row.override_route, { ...context, position: 'primary' });
      for (const [index, route] of (row.fallback_routes ?? []).entries()) {
        addRoute(route, { ...context, position: `fallback ${index + 1}` });
      }
    }

    const specificity = await manager
      .getRepository(SpecificityAssignment)
      .find({ where: { agent_id: In(agentIds) } });
    for (const row of specificity) {
      const context = {
        agent_id: row.agent_id,
        agent_name: namesById.get(row.agent_id) ?? row.agent_id,
        surface: 'specificity' as const,
        assignment_id: row.id,
        name: row.category,
      };
      addRoute(row.override_route, { ...context, position: 'primary' });
      for (const [index, route] of (row.fallback_routes ?? []).entries()) {
        addRoute(route, { ...context, position: `fallback ${index + 1}` });
      }
    }

    const headers = await manager
      .getRepository(HeaderTier)
      .find({ where: { agent_id: In(agentIds) } });
    for (const row of headers) {
      const context = {
        agent_id: row.agent_id,
        agent_name: namesById.get(row.agent_id) ?? row.agent_id,
        surface: 'header' as const,
        assignment_id: row.id,
        name: row.name,
      };
      addRoute(row.override_route, { ...context, position: 'primary' });
      for (const [index, route] of (row.fallback_routes ?? []).entries()) {
        addRoute(route, { ...context, position: `fallback ${index + 1}` });
      }
    }

    const aliasRows = await manager
      .getRepository(ExposedModelRoute)
      .find({ where: { tenant_id: tenantId, source_kind: 'direct' } });
    const selectedAliasIds = request.aliasIds ? new Set(request.aliasIds) : null;
    for (const alias of aliasRows) {
      if (!namesById.has(alias.agent_id)) continue;
      if (selectedAliasIds && !selectedAliasIds.has(alias.id)) continue;
      const positions: string[] = [];
      const primaryMatches = this.aliasMatchesRequest(alias.route, request, source);
      if (primaryMatches) {
        positions.push('primary');
        addRoute(alias.route, {
          agent_id: alias.agent_id,
          agent_name: namesById.get(alias.agent_id) ?? alias.agent_id,
          surface: 'alias',
          assignment_id: alias.id,
          alias_id: alias.id,
          name: alias.model_id,
          position: 'primary',
        });
      }
      for (const [index, route] of (alias.fallback_routes ?? []).entries()) {
        if (!this.aliasMatchesRequest(route, request, source)) continue;
        positions.push(`fallback ${index + 1}`);
        addRoute(route, {
          agent_id: alias.agent_id,
          agent_name: namesById.get(alias.agent_id) ?? alias.agent_id,
          surface: 'alias',
          assignment_id: alias.id,
          alias_id: alias.id,
          name: alias.model_id,
          position: `fallback ${index + 1}`,
        });
      }
      if (positions.length > 0) {
        aliases.set(alias.id, {
          id: alias.id,
          agent_id: alias.agent_id,
          agent_name: namesById.get(alias.agent_id) ?? alias.agent_id,
          model_id: alias.model_id,
          positions,
          credential_mode: alias.credential_mode,
        });
      }
    }

    const affected = new Map<string, { route_count: number; alias_count: number }>();
    for (const route of routes) {
      const value = affected.get(route.agent_id) ?? { route_count: 0, alias_count: 0 };
      value.route_count += 1;
      affected.set(route.agent_id, value);
    }
    for (const alias of aliases.values()) {
      const value = affected.get(alias.agent_id) ?? { route_count: 0, alias_count: 0 };
      value.alias_count += 1;
      affected.set(alias.agent_id, value);
    }

    const enabledRows = await manager
      .getRepository(AgentEnabledProvider)
      .find({ where: { tenant_provider_id: target?.id ?? '__none__' } });
    const enabledIds = new Set(enabledRows.map((row) => row.agent_id));
    const newlyEnabled = target
      ? [...affected.keys()].filter((agentId) => !enabledIds.has(agentId)).length
      : 0;

    return {
      mode: request.mode,
      source: request.source,
      target: request.target ?? null,
      target_provider_id: target?.id ?? null,
      target_label: target?.label ?? null,
      routes,
      aliases: [...aliases.values()],
      affected_harnesses: [...affected.entries()].map(([agentId, counts]) => ({
        agent_id: agentId,
        agent_name: namesById.get(agentId) ?? agentId,
        ...counts,
      })),
      counts: {
        harnesses: affected.size,
        routes: routes.length,
        aliases: aliases.size,
        newly_enabled_target_connections: newlyEnabled,
      },
    };
  }

  private routeMatchesSource(route: ModelRoute | null, source: TenantProvider): boolean {
    if (!route || route.authType !== source.auth_type || !route.keyLabel) return false;
    const routeNames = expandProviderNames([route.provider]);
    const sourceNames = expandProviderNames([source.provider]);
    return (
      [...routeNames].some((name) => sourceNames.has(name)) &&
      route.keyLabel.toLowerCase() === source.label.toLowerCase()
    );
  }

  private aliasMatchesRequest(
    route: ModelRoute | null,
    request: ProviderMigrationDto,
    source: TenantProvider,
  ): boolean {
    if (request.mode === 'move_routes') return this.routeMatchesSource(route, source);
    if (!route || !this.routeMatchesSource(route, source)) return false;
    return true;
  }

  private async moveRoutes(
    manager: EntityManager,
    _tenantId: string,
    _request: ProviderMigrationDto,
    source: TenantProvider,
    target: TenantProvider,
    plan: ProviderMigrationPlan,
  ): Promise<void> {
    const replace = (route: ModelRoute | null): ModelRoute | null =>
      this.routeMatchesSource(route, source) ? { ...route!, keyLabel: target.label } : route;
    const agentIds = plan.affected_harnesses.map((harness) => harness.agent_id);
    const tiers = await manager
      .getRepository(TierAssignment)
      .find({ where: { agent_id: In(agentIds) } });
    for (const row of tiers) {
      row.override_route = replace(row.override_route);
      row.fallback_routes = row.fallback_routes
        ? row.fallback_routes.map((route) => replace(route)!)
        : null;
      row.updated_at = new Date().toISOString();
      if (plan.routes.some((route) => route.surface === 'tier' && route.assignment_id === row.id)) {
        await manager.getRepository(TierAssignment).save(row);
      }
    }
    const specificity = await manager
      .getRepository(SpecificityAssignment)
      .find({ where: { agent_id: In(agentIds) } });
    for (const row of specificity) {
      row.override_route = replace(row.override_route);
      row.fallback_routes = row.fallback_routes
        ? row.fallback_routes.map((route) => replace(route)!)
        : null;
      row.updated_at = new Date().toISOString();
      if (
        plan.routes.some(
          (route) => route.surface === 'specificity' && route.assignment_id === row.id,
        )
      ) {
        await manager.getRepository(SpecificityAssignment).save(row);
      }
    }
    const headers = await manager
      .getRepository(HeaderTier)
      .find({ where: { agent_id: In(agentIds) } });
    for (const row of headers) {
      row.override_route = replace(row.override_route);
      row.fallback_routes = row.fallback_routes
        ? row.fallback_routes.map((route) => replace(route)!)
        : null;
      row.updated_at = new Date().toISOString();
      if (
        plan.routes.some((route) => route.surface === 'header' && route.assignment_id === row.id)
      ) {
        await manager.getRepository(HeaderTier).save(row);
      }
    }
    const aliases = await manager.getRepository(ExposedModelRoute).find({
      where: { id: In(plan.aliases.map((alias) => alias.id)) },
    });
    for (const alias of aliases) {
      alias.route = replace(alias.route);
      alias.fallback_routes = alias.fallback_routes
        ? alias.fallback_routes.map((route) => replace(route)!)
        : null;
      alias.updated_at = new Date().toISOString();
      await manager.getRepository(ExposedModelRoute).save(alias);
    }
  }

  private async enableTargets(
    manager: EntityManager,
    plan: ProviderMigrationPlan,
    target: TenantProvider,
  ): Promise<void> {
    for (const harness of plan.affected_harnesses) {
      await manager
        .getRepository(AgentEnabledProvider)
        .createQueryBuilder()
        .insert()
        .into(AgentEnabledProvider)
        .values({ agent_id: harness.agent_id, tenant_provider_id: target.id })
        .orIgnore()
        .execute();
    }
  }

  private async enableAliasFailover(
    manager: EntityManager,
    plan: ProviderMigrationPlan,
  ): Promise<void> {
    const aliasIds = plan.aliases.map((alias) => alias.id);
    if (aliasIds.length === 0) return;
    const repo = manager.getRepository(ExposedModelRoute);
    const aliases = await repo.find({ where: { id: In(aliasIds) } });
    for (const alias of aliases) {
      alias.credential_mode = 'same_provider_failover';
      alias.updated_at = new Date().toISOString();
    }
    await repo.save(aliases);
  }
}
