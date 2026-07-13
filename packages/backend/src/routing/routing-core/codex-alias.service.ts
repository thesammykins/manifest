import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  DEFAULT_RESPONSE_MODE,
  getSubscriptionKnownModels,
  type ModelRoute,
} from 'manifest-shared';
import { Agent } from '../../entities/agent.entity';
import { ExposedModelRoute } from '../../entities/exposed-model-route.entity';
import { TenantProvider } from '../../entities/tenant-provider.entity';

const MANAGED_ALIAS_PREFIX = 'manifest:codex:';
const OPENAI_PROVIDER = 'openai';

interface CodexManagedAlias {
  modelId: string;
  sourceKind: 'direct' | 'tier';
  sourceKey: string | null;
  route: ModelRoute | null;
}

function directChatGptAlias(modelId: string, routeModel = modelId): CodexManagedAlias {
  return {
    modelId,
    sourceKind: 'direct',
    sourceKey: null,
    route: {
      provider: OPENAI_PROVIDER,
      authType: 'subscription',
      model: routeModel,
    },
  };
}

function codexManagedAliases(chatGptEnabled: boolean): CodexManagedAlias[] {
  const aliases: CodexManagedAlias[] = [
    {
      modelId: 'codex-auto-review',
      sourceKind: 'tier',
      sourceKey: 'simple',
      route: null,
    },
  ];
  if (!chatGptEnabled) return aliases;

  const knownModels = getSubscriptionKnownModels(OPENAI_PROVIDER) ?? [];
  aliases.push(...knownModels.map((modelId) => directChatGptAlias(modelId)));

  // Codex's bundled /model catalog can retain family or legacy slugs after the
  // ChatGPT endpoint moves to a newer concrete route. Keep those native picker
  // values working without maintaining a second Codex model catalog in Manifest.
  const compatibilityAliases = [
    directChatGptAlias('gpt-5.6', 'gpt-5.6-sol'),
    directChatGptAlias('gpt-5.3-codex', 'gpt-5.3-codex-spark'),
    directChatGptAlias('gpt-5.2', 'gpt-5.4'),
  ];
  for (const alias of compatibilityAliases.reverse()) {
    if (
      alias.route &&
      knownModels.includes(alias.route.model) &&
      !knownModels.includes(alias.modelId)
    ) {
      aliases.unshift(alias);
    }
  }
  return aliases;
}

function managedAliasId(agentId: string, modelId: string): string {
  return `${MANAGED_ALIAS_PREFIX}${agentId}:${modelId}`;
}

function isManagedAlias(alias: ExposedModelRoute): boolean {
  return alias.id.startsWith(MANAGED_ALIAS_PREFIX);
}

function displayName(modelId: string): string {
  if (modelId === 'codex-auto-review') return 'Codex Auto Review';
  return modelId
    .replace(/^gpt-/, 'GPT-')
    .replace(/-(codex|sol|terra|luna|mini|spark)/g, (_, word) => {
      const value = String(word);
      return ` ${value.charAt(0).toUpperCase()}${value.slice(1)}`;
    });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

@Injectable()
export class CodexAliasService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
    @InjectRepository(TenantProvider)
    private readonly providerRepo: Repository<TenantProvider>,
    @InjectRepository(ExposedModelRoute)
    private readonly aliasRepo: Repository<ExposedModelRoute>,
  ) {}

  async reconcileTenant(tenantId: string): Promise<void> {
    const agents = await this.agentRepo.find({
      where: { tenant_id: tenantId, agent_platform: 'codex' },
    });
    if (agents.length === 0) return;

    const enabled = await this.hasActiveChatGptSubscription(tenantId);
    await Promise.all(agents.map((agent) => this.reconcileAgentRows(agent.id, tenantId, enabled)));
  }

  async reconcileAgent(agentId: string, tenantId: string): Promise<void> {
    const agent = await this.agentRepo.findOne({
      where: { id: agentId, tenant_id: tenantId, agent_platform: 'codex' },
    });
    if (!agent) return;
    const enabled = await this.hasActiveChatGptSubscription(tenantId);
    await this.reconcileAgentRows(agentId, tenantId, enabled);
  }

  private async hasActiveChatGptSubscription(tenantId: string): Promise<boolean> {
    return !!(await this.providerRepo.findOne({
      where: {
        tenant_id: tenantId,
        provider: OPENAI_PROVIDER,
        auth_type: 'subscription',
        is_active: true,
      },
    }));
  }

  private async reconcileAgentRows(
    agentId: string,
    tenantId: string,
    subscriptionEnabled: boolean,
  ): Promise<void> {
    const existing = await this.aliasRepo.find({ where: { agent_id: agentId } });
    const managed = existing.filter(isManagedAlias);

    const desired = codexManagedAliases(subscriptionEnabled);
    const desiredIds = new Set(desired.map((alias) => managedAliasId(agentId, alias.modelId)));
    const stale = managed.filter((alias) => !desiredIds.has(alias.id));
    if (stale.length > 0) {
      await this.aliasRepo.delete({ id: In(stale.map((row) => row.id)) });
    }

    const byModelId = new Map(existing.map((alias) => [alias.model_id.toLowerCase(), alias]));
    const now = new Date().toISOString();
    const inserts: ExposedModelRoute[] = [];
    const updates: ExposedModelRoute[] = [];

    for (const desiredAlias of desired) {
      const existingAlias = byModelId.get(desiredAlias.modelId.toLowerCase());
      // A user-created alias is authoritative. Reconciliation only owns rows
      // carrying our deterministic id prefix.
      if (existingAlias && !isManagedAlias(existingAlias)) continue;

      const route = desiredAlias.route;
      if (existingAlias) {
        const name = displayName(desiredAlias.modelId);
        if (
          existingAlias.display_name === name &&
          existingAlias.enabled &&
          existingAlias.source_kind === desiredAlias.sourceKind &&
          existingAlias.source_key === desiredAlias.sourceKey &&
          existingAlias.route?.provider === route?.provider &&
          existingAlias.route?.authType === route?.authType &&
          existingAlias.route?.model === route?.model &&
          existingAlias.fallback_routes === null &&
          existingAlias.request_params === null &&
          existingAlias.response_mode === DEFAULT_RESPONSE_MODE
        ) {
          continue;
        }
        Object.assign(existingAlias, {
          display_name: name,
          enabled: true,
          source_kind: desiredAlias.sourceKind,
          source_key: desiredAlias.sourceKey,
          route,
          fallback_routes: null,
          request_params: null,
          response_mode: DEFAULT_RESPONSE_MODE,
          updated_at: now,
        });
        updates.push(existingAlias);
        continue;
      }

      inserts.push(
        Object.assign(new ExposedModelRoute(), {
          id: managedAliasId(agentId, desiredAlias.modelId),
          tenant_id: tenantId,
          agent_id: agentId,
          model_id: desiredAlias.modelId,
          display_name: displayName(desiredAlias.modelId),
          enabled: true,
          source_kind: desiredAlias.sourceKind,
          source_key: desiredAlias.sourceKey,
          route,
          fallback_routes: null,
          request_params: null,
          response_mode: DEFAULT_RESPONSE_MODE,
          created_at: now,
          updated_at: now,
        }),
      );
    }

    for (const row of inserts) {
      try {
        await this.aliasRepo.save(row);
      } catch (error) {
        // Provider refresh and connect callbacks can race. Deterministic ids and
        // the agent/model unique index make a concurrent winner equivalent.
        if (!isUniqueViolation(error)) throw error;
      }
    }
    for (const row of updates) await this.aliasRepo.save(row);
  }
}
