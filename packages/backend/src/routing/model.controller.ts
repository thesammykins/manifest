import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { ResolveAgentService } from './routing-core/resolve-agent.service';
import { CustomProviderService } from './custom-provider/custom-provider.service';
import { ProviderParamSpecService } from './routing-core/provider-param-spec.service';
import { ModelDiscoveryService } from '../model-discovery/model-discovery.service';
import { AgentModelFilterService } from '../model-discovery/agent-model-filter.service';
import type { FilterableDiscoveredModel } from '../model-discovery/agent-model-filter.service';
import { OpencodeGoCatalogService } from '../model-discovery/opencode-go-catalog.service';
import { OllamaSyncService } from '../database/ollama-sync.service';
import { PricingSyncService } from '../database/pricing-sync.service';
import { ModelsDevSyncService } from '../database/models-dev-sync.service';
import { resolveProviderMetadataIdentity } from 'manifest-shared';
import {
  inputModalitiesFromCapabilities,
  mergeModelCapabilities,
  modelSupportsStreaming,
} from '../model-discovery/model-capabilities';
import {
  AgentNameParamDto,
  AgentProviderParamDto,
  RemoveProviderQueryDto,
} from './dto/routing.dto';
import { SetModelFilterDto } from './dto/model-filter.dto';

function formatModelSlug(slug: string): string {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayNameForModel(
  provider: string,
  modelId: string,
  displayName: string | null | undefined,
  metadataName: string | null | undefined,
): string | null {
  const trimmedDisplay = displayName?.trim();
  if (trimmedDisplay && trimmedDisplay !== modelId) return trimmedDisplay;

  const trimmedMetadata = metadataName?.trim();
  if (trimmedMetadata && trimmedMetadata !== modelId) return trimmedMetadata;

  const metadata = resolveProviderMetadataIdentity(provider, modelId);
  if (
    provider.toLowerCase() === 'bedrock' &&
    metadata.provider &&
    metadata.provider !== provider &&
    metadata.model !== modelId
  ) {
    return formatModelSlug(metadata.model);
  }

  return trimmedDisplay || null;
}

function finiteContextWindow(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function filterRowForModel(
  model: FilterableDiscoveredModel,
  metadataName: string | null | undefined,
) {
  const authType = model.authType ?? 'api_key';
  return {
    provider: model.provider,
    auth_type: authType,
    model_name: model.id,
    display_name: CustomProviderService.isCustom(model.provider)
      ? CustomProviderService.rawModelName(model.id)
      : displayNameForModel(model.provider, model.id, model.displayName, metadataName),
    context_window: finiteContextWindow(model.contextWindow),
    enabled: model.enabled,
  };
}

@Controller('api/v1/routing')
export class ModelController {
  constructor(
    private readonly discoveryService: ModelDiscoveryService,
    private readonly ollamaSync: OllamaSyncService,
    private readonly resolveAgentService: ResolveAgentService,
    private readonly customProviderService: CustomProviderService,
    private readonly pricingSync: PricingSyncService,
    private readonly providerParamSpecs: ProviderParamSpecService,
    private readonly modelsDevSync: ModelsDevSyncService,
    private readonly opencodeGoCatalog: OpencodeGoCatalogService,
    private readonly modelFilters: AgentModelFilterService,
  ) {}

  @Get('pricing-health')
  pricingHealth() {
    return {
      model_count: this.pricingSync.getAll().size,
      last_fetched_at: this.pricingSync.getLastFetchedAt()?.toISOString() ?? null,
    };
  }

  @Post('pricing/refresh')
  async refreshPricing() {
    const modelCount = await this.pricingSync.refreshCache();
    return {
      ok: modelCount > 0,
      model_count: modelCount,
      last_fetched_at: this.pricingSync.getLastFetchedAt()?.toISOString() ?? null,
    };
  }

  @Post(':agentName/refresh-models')
  async refreshModels(@TenantCtx() ctx: TenantContext, @Param() params: AgentNameParamDto) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName);
    await this.discoveryService.discoverAllForAgent(agent.tenant_id, { forceRefresh: true });
    return { ok: true };
  }

  @Post(':agentName/providers/:provider/refresh-models')
  async refreshProviderModels(
    @TenantCtx() ctx: TenantContext,
    @Param() params: AgentProviderParamDto,
    @Query() query: RemoveProviderQueryDto,
  ) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName);
    const result = await this.discoveryService.refreshProvider(
      agent.tenant_id,
      params.provider,
      query.authType,
    );
    return result;
  }

  @Post('ollama/sync')
  async syncOllama() {
    return this.ollamaSync.sync();
  }

  @Get(':agentName/available-models')
  async getAvailableModels(@TenantCtx() ctx: TenantContext, @Param() params: AgentNameParamDto) {
    // allowPlayground: true — the Playground frontend reads available models for the
    // reserved Playground agent; all other model.controller endpoints remain blocked.
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName, {
      allowPlayground: true,
    });
    const models = await this.discoveryService.getModelsForAgent(agent.tenant_id, agent.id);

    // Build display name map for custom providers (tenant-global)
    const customProviders = await this.customProviderService.list(agent.tenant_id);
    const cpNameMap = new Map<string, string>();
    for (const cp of customProviders) {
      cpNameMap.set(CustomProviderService.providerKey(cp.id), cp.name);
    }

    return Promise.all(
      models.map(async (m) => {
        const isCustom = CustomProviderService.isCustom(m.provider);
        const authType = m.authType ?? 'api_key';
        const capabilities = await this.providerParamSpecs.getCapabilities(
          m.provider,
          authType,
          m.id,
        );
        // Some routable ids proxy another provider's model namespace (gateway
        // ids, Bedrock vendor-prefixed ids). Resolve that provenance for
        // metadata only; the routable provider/model below stay unchanged.
        const capId = resolveProviderMetadataIdentity(m.provider, m.id);
        const capProvider = capId.provider ?? m.provider;
        const modelsDevEntry = this.modelsDevSync.lookupModel(capProvider, capId.model);
        const modelsDevCapabilities = modelsDevEntry?.capabilities;
        const modelCapabilities = mergeModelCapabilities(
          m.capabilities,
          modelsDevCapabilities,
          capabilities,
          modelSupportsStreaming(capProvider, capId.model) ? ['stream'] : undefined,
        );
        const inputModalities =
          modelsDevEntry?.inputModalities ??
          m.inputModalities ??
          inputModalitiesFromCapabilities(modelCapabilities);
        // OpenCode Go bills a per-request slice of its dollar quota rather than
        // per token, so surface that cost; other subscriptions stay flat-fee.
        const costPerRequest =
          m.provider === 'opencode-go'
            ? await this.opencodeGoCatalog.resolveCostPerRequest(m.id)
            : null;
        return {
          model_name: m.id,
          provider: m.provider,
          auth_type: authType,
          input_price_per_token: m.inputPricePerToken,
          output_price_per_token: m.outputPricePerToken,
          ...(costPerRequest != null ? { cost_per_request: costPerRequest } : {}),
          context_window: m.contextWindow,
          capability_reasoning: m.capabilityReasoning,
          capability_code: m.capabilityCode,
          ...(modelCapabilities ? { capabilities: modelCapabilities } : {}),
          input_modalities: inputModalities,
          output_modalities: ['text'],
          quality_score: m.qualityScore,
          display_name: isCustom
            ? CustomProviderService.rawModelName(m.id)
            : displayNameForModel(m.provider, m.id, m.displayName, modelsDevEntry?.name),
          ...(isCustom && {
            provider_display_name: cpNameMap.get(m.provider) ?? m.provider,
          }),
        };
      }),
    );
  }

  @Get(':agentName/model-filters')
  async getModelFilters(@TenantCtx() ctx: TenantContext, @Param() params: AgentNameParamDto) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName);
    return this.buildModelFilterRows(agent.tenant_id, agent.id);
  }

  @Patch(':agentName/model-filters')
  async patchModelFilter(
    @TenantCtx() ctx: TenantContext,
    @Param() params: AgentNameParamDto,
    @Body() body: SetModelFilterDto,
  ) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName);
    const models = await this.discoveryService.getModelsForAgentWithFilterState(
      agent.tenant_id,
      agent.id,
    );
    const model = models.find(
      (candidate) =>
        candidate.provider.toLowerCase() === body.provider.toLowerCase() &&
        (candidate.authType ?? 'api_key') === body.auth_type &&
        candidate.id.toLowerCase() === body.model_name.toLowerCase(),
    );
    if (!model) {
      throw new BadRequestException(
        `Model "${body.model_name}" is not available for provider "${body.provider}" (${body.auth_type}).`,
      );
    }

    await this.modelFilters.setModelEnabled(
      agent.tenant_id,
      agent.id,
      {
        provider: model.provider,
        authType: model.authType ?? 'api_key',
        modelId: model.id,
      },
      body.enabled,
    );
    this.discoveryService.invalidate(agent.id);

    const capId = resolveProviderMetadataIdentity(model.provider, model.id);
    const modelsDevEntry = this.modelsDevSync.lookupModel(
      capId.provider ?? model.provider,
      capId.model,
    );
    return filterRowForModel({ ...model, enabled: body.enabled }, modelsDevEntry?.name);
  }

  private async buildModelFilterRows(tenantId: string, agentId: string) {
    const models = await this.discoveryService.getModelsForAgentWithFilterState(tenantId, agentId);
    const rows = models.map((model) => {
      const capId = resolveProviderMetadataIdentity(model.provider, model.id);
      const modelsDevEntry = this.modelsDevSync.lookupModel(
        capId.provider ?? model.provider,
        capId.model,
      );
      return filterRowForModel(model, modelsDevEntry?.name);
    });
    return rows.sort((a, b) => {
      const provider = a.provider.localeCompare(b.provider);
      if (provider !== 0) return provider;
      const authType = a.auth_type.localeCompare(b.auth_type);
      if (authType !== 0) return authType;
      return a.model_name.localeCompare(b.model_name);
    });
  }
}
