import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import type { AuthType, ModelRoute } from 'manifest-shared';
import { AgentModelFilter } from '../entities/agent-model-filter.entity';
import type { DiscoveredModel } from './model-fetcher';

export interface ModelFilterKey {
  provider: string;
  authType: AuthType;
  modelId: string;
}

export type FilterableDiscoveredModel = DiscoveredModel & { enabled: boolean };

@Injectable()
export class AgentModelFilterService {
  constructor(
    @InjectRepository(AgentModelFilter)
    private readonly repo: Repository<AgentModelFilter>,
  ) {}

  async disabledKeys(agentId: string): Promise<Set<string>> {
    const rows = await this.repo.find({ where: { agent_id: agentId } });
    return new Set(rows.map((row) => filterKey(row.provider, row.auth_type, row.model_id)));
  }

  async applyFilter(agentId: string, models: DiscoveredModel[]): Promise<DiscoveredModel[]> {
    const disabled = await this.disabledKeys(agentId);
    if (disabled.size === 0) return models;
    return models.filter((model) => !disabled.has(filterKeyForModel(model)));
  }

  async withState(
    agentId: string,
    models: DiscoveredModel[],
  ): Promise<FilterableDiscoveredModel[]> {
    const disabled = await this.disabledKeys(agentId);
    return models.map((model) => ({
      ...model,
      enabled: !disabled.has(filterKeyForModel(model)),
    }));
  }

  async isRouteDisabled(agentId: string, route: ModelRoute): Promise<boolean> {
    if (!route.provider || !route.authType) return false;
    const count = await this.repo
      .createQueryBuilder('filter')
      .where('filter.agent_id = :agentId', { agentId })
      .andWhere('LOWER(filter.provider) = :provider', {
        provider: route.provider.toLowerCase(),
      })
      .andWhere('filter.auth_type = :authType', { authType: route.authType })
      .andWhere('LOWER(filter.model_id) = :modelId', {
        modelId: route.model.toLowerCase(),
      })
      .getCount();
    return count > 0;
  }

  async setModelEnabled(
    tenantId: string,
    agentId: string,
    key: ModelFilterKey,
    enabled: boolean,
  ): Promise<void> {
    const normalized = normalizeKey(key);
    if (enabled) {
      await this.repo
        .createQueryBuilder()
        .delete()
        .where('agent_id = :agentId', { agentId })
        .andWhere('LOWER(provider) = :provider', { provider: normalized.provider })
        .andWhere('auth_type = :authType', { authType: normalized.authType })
        .andWhere('LOWER(model_id) = :modelId', { modelId: normalized.modelId })
        .execute();
      return;
    }

    const existing = await this.repo
      .createQueryBuilder('filter')
      .where('filter.agent_id = :agentId', { agentId })
      .andWhere('LOWER(filter.provider) = :provider', { provider: normalized.provider })
      .andWhere('filter.auth_type = :authType', { authType: normalized.authType })
      .andWhere('LOWER(filter.model_id) = :modelId', { modelId: normalized.modelId })
      .getOne();
    if (existing) {
      existing.updated_at = new Date().toISOString();
      await this.repo.save(existing);
      return;
    }

    const now = new Date().toISOString();
    await this.repo.save(
      Object.assign(new AgentModelFilter(), {
        id: randomUUID(),
        tenant_id: tenantId,
        agent_id: agentId,
        provider: key.provider.trim(),
        auth_type: key.authType,
        model_id: key.modelId.trim(),
        created_at: now,
        updated_at: now,
      }),
    );
  }

  async setModelsEnabled(
    tenantId: string,
    agentId: string,
    keys: ModelFilterKey[],
    enabled: boolean,
  ): Promise<void> {
    const uniqueKeys = [
      ...new Map(
        keys.map((key) => {
          const normalized = normalizeKey(key);
          return [
            filterKey(normalized.provider, normalized.authType, normalized.modelId),
            normalized,
          ];
        }),
      ).values(),
    ];
    if (uniqueKeys.length === 0) return;

    if (enabled) {
      const params: Record<string, string> = { agentId };
      const conditions = uniqueKeys.map((key, index) => {
        params[`provider${index}`] = key.provider;
        params[`authType${index}`] = key.authType;
        params[`modelId${index}`] = key.modelId;
        return `(LOWER(provider) = :provider${index} AND auth_type = :authType${index} AND LOWER(model_id) = :modelId${index})`;
      });
      await this.repo
        .createQueryBuilder()
        .delete()
        .where('agent_id = :agentId', params)
        .andWhere(`(${conditions.join(' OR ')})`, params)
        .execute();
      return;
    }

    const now = new Date().toISOString();
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(AgentModelFilter)
      .values(
        uniqueKeys.map((key) => ({
          id: randomUUID(),
          tenant_id: tenantId,
          agent_id: agentId,
          provider: key.provider,
          auth_type: key.authType,
          model_id: key.modelId,
          created_at: now,
          updated_at: now,
        })),
      )
      .orIgnore()
      .execute();
  }
}

function filterKeyForModel(model: DiscoveredModel): string {
  return filterKey(model.provider, model.authType ?? 'api_key', model.id);
}

function filterKey(provider: string, authType: AuthType, modelId: string): string {
  return `${provider.trim().toLowerCase()}\u0000${authType}\u0000${modelId.trim().toLowerCase()}`;
}

function normalizeKey(key: ModelFilterKey): ModelFilterKey {
  return {
    provider: key.provider.trim().toLowerCase(),
    authType: key.authType,
    modelId: key.modelId.trim().toLowerCase(),
  };
}
