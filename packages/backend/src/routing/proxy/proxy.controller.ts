import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
  UseFilters,
  Logger,
  HttpException,
} from '@nestjs/common';
import { Request, Response as ExpressResponse } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { AgentKeyAuthGuard } from '../../otlp/guards/agent-key-auth.guard';
import { IngestionContext } from '../../otlp/interfaces/ingestion-context.interface';
import { ProxyService, type RoutingMeta } from './proxy.service';
import { ProxyRateLimiter } from './proxy-rate-limiter';
import { ProviderClient } from './provider-client';
import { ProxyMessageRecorder } from './proxy-message-recorder';
import { ThoughtSignatureCache } from './thought-signature-cache';
import { ThinkingBlockCache } from './thinking-block-cache';
import { ReasoningContentCache } from './reasoning-content-cache';
import { ModelAliasService } from '../model-aliases/model-alias.service';
import { ModelDiscoveryService } from '../../model-discovery/model-discovery.service';
import { ProviderParamSpecService } from '../routing-core/provider-param-spec.service';
import { classifyCaller } from './caller-classifier';
import { sanitizeRequestHeaders } from './request-headers';
import {
  buildMetaHeaders,
  buildOpenAiCompatibleError,
  handleProviderError,
  recordFallbackFailures,
  handleStreamResponse,
  handleNonStreamResponse,
  recordSuccess,
} from './proxy-response-handler';
import { ProxyExceptionFilter, isChatRenderingClient } from './proxy-exception.filter';
import { sendFriendlyResponse } from './proxy-friendly-response';
import { formatManifestError } from '../../common/errors/error-codes';
import { escapeHtml } from '../../common/utils/html-escape';
import type { ProxyApiMode } from './proxy-types';
import { ResponsesSseError } from './chatgpt-adapter';
import { sanitizeExceptionResponse } from './proxy-error-response';
import { redactInlineImageDataUrls } from './inline-image-redaction';
import { isReasoningEffortSuffix, openAiModelId } from './openai-model-id';
import type { ModelRoute, ProviderParamSpec } from 'manifest-shared';

const MAX_SEEN_TENANTS = 10_000;
const SEEN_TENANT_TTL_MS = 24 * 60 * 60 * 1000;
const MODEL_CREATED_UNKNOWN = 0;

interface OpenAiModelObject {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  display_name?: string;
  type?: 'model';
  manifest_params?: ManifestModelParam[];
}

interface ManifestModelParam {
  category: 'reasoning';
  path: string;
  label: string;
  values: string[];
  default?: string;
}

interface OpenAiModelList {
  object: 'list';
  data: OpenAiModelObject[];
}

@Controller(['v1', ''])
@Public()
@UseGuards(AgentKeyAuthGuard)
@UseFilters(ProxyExceptionFilter)
@SkipThrottle()
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);
  private readonly seenTenants = new Map<string, number>();

  constructor(
    private readonly proxyService: ProxyService,
    private readonly rateLimiter: ProxyRateLimiter,
    private readonly providerClient: ProviderClient,
    private readonly recorder: ProxyMessageRecorder,
    private readonly signatureCache: ThoughtSignatureCache,
    private readonly thinkingCache: ThinkingBlockCache,
    private readonly reasoningCache: ReasoningContentCache,
    private readonly modelAliasService: ModelAliasService,
    private readonly modelDiscovery: ModelDiscoveryService,
    private readonly providerParamSpecs: ProviderParamSpecService,
  ) {}

  @Get('models')
  async models(
    @Req() req: Request & { ingestionContext: IngestionContext },
  ): Promise<OpenAiModelList> {
    const includeManifestParams = wantsManifestParams(req);
    const [aliases, models] = await Promise.all([
      this.modelAliasService.listEnabled(req.ingestionContext.agentId),
      this.modelDiscovery.getModelsForAgent(
        req.ingestionContext.tenantId,
        req.ingestionContext.agentId,
      ),
    ]);
    const data: OpenAiModelObject[] = [
      {
        id: 'auto',
        object: 'model',
        created: MODEL_CREATED_UNKNOWN,
        owned_by: 'manifest',
        display_name: 'Manifest Auto',
      },
      {
        id: 'manifest/auto',
        object: 'model',
        created: MODEL_CREATED_UNKNOWN,
        owned_by: 'manifest',
        display_name: 'Manifest Auto',
      },
    ];
    const seen = new Set(data.map((model) => model.id.toLowerCase()));

    for (const alias of aliases) {
      const id = alias.model_id;
      const key = id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const row: OpenAiModelObject = {
        id,
        object: 'model',
        created: MODEL_CREATED_UNKNOWN,
        owned_by: 'manifest',
        display_name: alias.display_name ?? id,
      };
      if (includeManifestParams && alias.source_kind === 'direct' && alias.route) {
        addManifestParams(row, await this.manifestParamsForRoute(alias.route));
      }
      data.push(row);
    }

    for (const model of models) {
      const id = openAiModelId(model);
      const key = id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const route = model.authType
        ? {
            provider: model.provider,
            authType: model.authType,
            model: model.id,
          }
        : null;
      const params = route ? await this.manifestParamsForRoute(route) : [];
      const row: OpenAiModelObject = {
        id,
        object: 'model',
        created: MODEL_CREATED_UNKNOWN,
        owned_by: model.provider,
      };
      if (includeManifestParams) addManifestParams(row, params);
      data.push(row);
      addReasoningVariantRows(data, seen, row, params);
    }

    return {
      object: 'list',
      data,
    };
  }

  private async manifestParamsForRoute(route: ModelRoute): Promise<ManifestModelParam[]> {
    const specs = await this.providerParamSpecs.getSpecs(
      route.provider,
      route.authType,
      route.model,
    );
    return specs.filter(isReasoningEnumSpec).map((spec) => ({
      category: 'reasoning',
      path: spec.path,
      label: spec.label,
      values: spec.values?.filter((value): value is string => typeof value === 'string') ?? [],
      ...(typeof spec.default === 'string' ? { default: spec.default } : {}),
    }));
  }

  @Post('chat/completions')
  async chatCompletions(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    await this.handleProxyRequest(req, res, 'chat_completions');
  }

  @Post('responses')
  async responses(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    await this.handleProxyRequest(req, res, 'responses');
  }

  @Post('messages')
  async messages(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    await this.handleProxyRequest(req, res, 'messages');
  }

  private async handleProxyRequest(
    req: Request & { ingestionContext: IngestionContext },
    res: ExpressResponse,
    apiMode: ProxyApiMode,
  ): Promise<void> {
    const { tenantId } = req.ingestionContext;
    const body = req.body as Record<string, unknown>;
    const sessionKey = (req.headers['x-session-key'] as string) || 'default';
    const traceId = this.extractTraceId(req);
    const callerAttribution = classifyCaller(req.headers);
    const requestHeaders = sanitizeRequestHeaders(req.headers);
    const isStream = body.stream === true;
    let routingBody = body;
    let headersSent = false;
    let slotAcquired = false;
    let currentMeta: RoutingMeta | undefined;

    const clientAbort = new AbortController();
    res.once('close', () => clientAbort.abort());
    const startTime = Date.now();

    try {
      this.rateLimiter.checkLimit(tenantId);
      this.rateLimiter.checkIpLimit(req.ip ?? '');
      this.rateLimiter.acquireSlot(tenantId);
      slotAcquired = true;
      routingBody = redactInlineImageDataUrls(body);
      const specificityOverride = req.headers['x-manifest-specificity'] as string | undefined;
      const { forward, meta, failedFallbacks } = await this.proxyService.proxyRequest({
        agentId: req.ingestionContext.agentId,
        tenantId,
        // Attribution only — the recorder writes it to agent_messages.user_id.
        userId: req.ingestionContext.userId,
        body,
        routingBody,
        sessionKey,
        agentName: req.ingestionContext.agentName,
        signal: clientAbort.signal,
        specificityOverride,
        headers: req.headers,
        apiMode,
      });
      currentMeta = meta;

      this.trackFirstProxyRequest(tenantId);

      const metaHeaders = buildMetaHeaders(meta);
      const providerResponse = forward.response;

      if (!providerResponse.ok) {
        const errorBody = await providerResponse.text();
        await handleProviderError(
          res,
          req.ingestionContext,
          meta,
          metaHeaders,
          providerResponse.status,
          errorBody,
          failedFallbacks,
          this.recorder,
          traceId,
          callerAttribution,
          requestHeaders,
        );
        return;
      }

      const fallbackSuccessTs = recordFallbackFailures(
        req.ingestionContext,
        meta,
        failedFallbacks,
        this.recorder,
        callerAttribution,
        requestHeaders,
      );

      let streamUsage = null;

      const shouldStreamResponse = isStream || meta.response_mode === 'stream';

      if (shouldStreamResponse && providerResponse.body) {
        headersSent = true;
        streamUsage = await handleStreamResponse(
          res,
          forward,
          meta,
          metaHeaders,
          this.providerClient,
          this.signatureCache,
          sessionKey,
          this.thinkingCache,
          apiMode,
          this.reasoningCache,
        );
      } else {
        streamUsage = await handleNonStreamResponse(
          res,
          forward,
          meta,
          metaHeaders,
          this.providerClient,
          this.signatureCache,
          sessionKey,
          this.thinkingCache,
          apiMode,
          this.reasoningCache,
        );
      }

      recordSuccess(
        req.ingestionContext,
        meta,
        streamUsage,
        fallbackSuccessTs,
        this.recorder,
        traceId,
        sessionKey,
        startTime,
        callerAttribution,
        requestHeaders,
      );
    } catch (err: unknown) {
      this.handleProxyError(
        err,
        req,
        res,
        clientAbort,
        headersSent,
        traceId,
        callerAttribution,
        requestHeaders,
        currentMeta,
      );
    } finally {
      if (slotAcquired) this.rateLimiter.releaseSlot(tenantId);
    }
  }

  private handleProxyError(
    err: unknown,
    req: Request & { ingestionContext: IngestionContext },
    res: ExpressResponse,
    clientAbort: AbortController,
    headersSent: boolean,
    traceId: string | undefined,
    callerAttribution: ReturnType<typeof classifyCaller>,
    requestHeaders: ReturnType<typeof sanitizeRequestHeaders>,
    meta?: RoutingMeta,
  ): void {
    if (clientAbort.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    const status =
      err instanceof ResponsesSseError
        ? err.status
        : err instanceof HttpException
          ? err.getStatus()
          : 500;
    const providerErrorBody = err instanceof ResponsesSseError ? err.body : message;
    this.logger.error(`Proxy error: ${message}`);

    this.recorder
      .recordProviderError(req.ingestionContext, status, providerErrorBody, {
        ...(meta
          ? {
              model: meta.model,
              provider: meta.provider,
              tier: meta.tier,
              fallbackFromModel: meta.fallbackFromModel,
              fallbackIndex: meta.fallbackIndex,
              authType: meta.auth_type,
              reason: meta.reason,
              specificityCategory: meta.specificity_category,
              providerKeyLabel: meta.provider_key_label,
              tenantProviderId: meta.tenantProviderId,
              requestParams: meta.request_params,
              headerTierId: meta.header_tier_id,
              headerTierName: meta.header_tier_name,
              headerTierColor: meta.header_tier_color,
            }
          : {}),
        traceId,
        callerAttribution,
        requestHeaders,
      })
      .catch((e) => this.logger.warn(`Failed to record provider error: ${e}`));

    if (headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }

    if (err instanceof ResponsesSseError) {
      res.status(err.status).json({
        error: buildOpenAiCompatibleError(
          err.status,
          err.body,
          meta ? { provider: meta.provider, model: meta.model } : {},
        ),
      });
      return;
    }

    // Rate limit errors stay as HTTP 429 so clients can backoff
    if (status === 429) {
      const response = err instanceof HttpException ? err.getResponse() : message;
      res.status(429).json(sanitizeExceptionResponse(response));
      return;
    }

    const isStream = (req.body as Record<string, unknown>)?.stream === true;
    if (isChatRenderingClient(req)) {
      const clientMessage = status >= 500 ? formatManifestError('M500') : message;
      sendFriendlyResponse(res, clientMessage, isStream);
      return;
    }

    // Tool/monitor caller — surface the real HTTP status with a structured
    // envelope so CI pipelines can detect failures instead of treating the
    // friendly stub as success.
    const errorMessage =
      status >= 500
        ? 'Manifest encountered an internal error. Try again shortly.'
        : escapeHtml(message);
    res.status(status).json({
      error: {
        message: errorMessage,
        type: status >= 500 ? 'server_error' : 'invalid_request_error',
      },
    });
  }

  private extractTraceId(req: Request): string | undefined {
    const header = req.headers['traceparent'] as string | undefined;
    if (!header) return undefined;
    const parts = header.split('-');
    return parts.length >= 2 ? parts[1] : undefined;
  }

  private trackFirstProxyRequest(tenantId: string): void {
    const now = Date.now();
    if (this.seenTenants.has(tenantId)) return;
    this.evictExpiredTenants(now);
    if (this.seenTenants.size >= MAX_SEEN_TENANTS) {
      const oldest = this.seenTenants.keys().next().value as string;
      this.seenTenants.delete(oldest);
    }
    this.seenTenants.set(tenantId, now);
  }

  private evictExpiredTenants(now: number): void {
    for (const [key, timestamp] of this.seenTenants) {
      if (now - timestamp > SEEN_TENANT_TTL_MS) {
        this.seenTenants.delete(key);
      } else {
        break;
      }
    }
  }
}

function wantsManifestParams(req: Request): boolean {
  const value = req.query.manifest_params;
  if (Array.isArray(value)) return value.includes('1') || value.includes('true');
  return value === '1' || value === 'true';
}

function addManifestParams(row: OpenAiModelObject, params: ManifestModelParam[]): void {
  if (params.length > 0) row.manifest_params = params;
}

function addReasoningVariantRows(
  data: OpenAiModelObject[],
  seen: Set<string>,
  base: OpenAiModelObject,
  params: ManifestModelParam[],
): void {
  const efforts = params
    .flatMap((param) => param.values)
    .filter((value) => isReasoningEffortSuffix(value));
  for (const effort of [...new Set(efforts)]) {
    const id = `${base.id}-${effort.toLowerCase()}`;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    data.push({
      id,
      object: 'model',
      created: base.created,
      owned_by: base.owned_by,
      type: base.type,
    });
  }
}

function isReasoningEnumSpec(spec: ProviderParamSpec): boolean {
  if (spec.group !== 'reasoning' || spec.type !== 'enum') return false;
  if (!spec.values?.some((value) => typeof value === 'string')) return false;
  const path = spec.path.toLowerCase();
  if (path === 'reasoning_effort') return true;
  if (path.endsWith('.effort')) return true;
  if (path.endsWith('thinkinglevel')) return true;
  return spec.label.toLowerCase().includes('effort');
}
