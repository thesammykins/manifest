import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseFilters,
  Logger,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { Request, Response as ExpressResponse } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { v4 as uuid } from 'uuid';
import { Public } from '../../common/decorators/public.decorator';
import { AgentKeyAuthGuard } from '../../otlp/guards/agent-key-auth.guard';
import { IngestionContext } from '../../otlp/interfaces/ingestion-context.interface';
import { ProxyService, type RoutingMeta } from './proxy.service';
import { ProxyRateLimiter } from './proxy-rate-limiter';
import { ProviderClient } from './provider-client';
import { ProxyMessageRecorder, type ManifestBlockedRequestReason } from './proxy-message-recorder';
import { ThoughtSignatureCache } from './thought-signature-cache';
import { ThinkingBlockCache } from './thinking-block-cache';
import { ReasoningContentCache } from './reasoning-content-cache';
import { ModelAliasService } from '../model-aliases/model-alias.service';
import { ModelDiscoveryService } from '../../model-discovery/model-discovery.service';
import { ProviderParamSpecService } from '../routing-core/provider-param-spec.service';
import { ResolveService } from '../resolve/resolve.service';
import type { ExposedModelRoute } from '../../entities/exposed-model-route.entity';
import { ModelsDevSyncService } from '../../database/models-dev-sync.service';
import { resolveModelCapabilityMetadata } from '../../model-discovery/model-capabilities';
import { classifyCaller } from './caller-classifier';
import { ObservationReporter } from '../autofix/observation-reporter';
import type { AutofixRecord } from '../autofix/autofix.types';
import { sanitizeRequestHeaders } from './request-headers';
import { buildProxySessionScope } from './proxy-session-scope';
import {
  buildMetaHeaders,
  buildOpenAiCompatibleError,
  currentPrimaryAttemptNumber,
  handleProviderError,
  recordFallbackFailures,
  handleStreamResponse,
  handleNonStreamResponse,
  nextResponsesSequenceNumber,
  recordSuccess,
} from './proxy-response-handler';
import { ProxyExceptionFilter, isChatRenderingClient } from './proxy-exception.filter';
import { sendFriendlyResponse } from './proxy-friendly-response';
import { formatManifestError, type ManifestErrorCode } from '../../common/errors/error-codes';
import { escapeHtml } from '../../common/utils/html-escape';
import {
  MANIFEST_CODE_TO_REASON,
  ManifestError,
  isRecordableManifestCode,
} from '../../common/errors/manifest-error';
import type {
  ProviderAttemptRef,
  ProviderAttemptStart,
  ProxyApiMode,
  StartProviderAttempt,
} from './proxy-types';
import { ResponsesSseError } from './chatgpt-adapter';
import { sanitizeExceptionResponse } from './proxy-error-response';
import { redactInlineImageDataUrls } from './inline-image-redaction';
import { isReasoningEffortSuffix, openAiModelId } from './openai-model-id';
import type { ModelRoute, ProviderParamSpec } from 'manifest-shared';
import { PlanService } from '../../billing/plan.service';
import type { CodexModelInfo, DiscoveredModel } from '../../model-discovery/model-fetcher';
import { openAiModelCapabilities, type OpenAiModelCapabilities } from './openai-model-capabilities';
import { StreamFailure } from './stream-writer';
import { AgentRecordingCacheService } from '../../common/services/agent-recording-cache.service';
import { AttemptRecordingService } from './attempt-recording.service';
import {
  createAttemptRecordingCapture,
  recordingResponseFromText,
} from './attempt-recording-capture';

const MAX_SEEN_TENANTS = 10_000;
const SEEN_TENANT_TTL_MS = 24 * 60 * 60 * 1000;
const MODEL_CREATED_UNKNOWN = 0;
const CODEX_OPEN_REASONING_EFFORT_MIN_VERSION = [0, 138, 0] as const;
const LEGACY_CODEX_REASONING_EFFORTS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

interface OpenAiModelObject {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  context_window?: number;
  context_length?: number;
  display_name?: string;
  type?: 'model';
  manifest_params?: ManifestModelParam[];
  capabilities?: OpenAiModelCapabilities;
  cost?: OpenAiModelCost;
}

interface ManifestModelParam {
  category: 'reasoning';
  path: string;
  label: string;
  values: string[];
  default?: string;
}

interface OpenAiModelCost {
  /** USD per million input tokens. */
  input?: number;
  /** USD per million output tokens. */
  output?: number;
}

interface OpenAiModelList {
  object: 'list';
  data: OpenAiModelObject[];
}

interface CodexModelList {
  models: CodexModelInfo[];
}

type ModelListResponse = OpenAiModelList | CodexModelList;

function openAiModelCost(
  inputPricePerToken: number | null,
  outputPricePerToken: number | null,
): OpenAiModelCost | undefined {
  const input =
    inputPricePerToken != null && Number.isFinite(inputPricePerToken) && inputPricePerToken >= 0
      ? inputPricePerToken * 1_000_000
      : undefined;
  const output =
    outputPricePerToken != null && Number.isFinite(outputPricePerToken) && outputPricePerToken >= 0
      ? outputPricePerToken * 1_000_000
      : undefined;
  if (input === undefined && output === undefined) return undefined;
  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
  };
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
    private readonly resolveService: ResolveService,
    private readonly planService: PlanService,
    private readonly observationReporter: ObservationReporter,
    private readonly modelsDevSync: ModelsDevSyncService,
    @Optional()
    private readonly recordingCache?: AgentRecordingCacheService,
    @Optional()
    private readonly attemptRecording?: AttemptRecordingService,
  ) {}

  @Get('models')
  async models(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Query('capabilities') capabilities?: string,
    @Query('cost') cost?: string,
  ): Promise<ModelListResponse> {
    const clientVersion = codexClientVersion(req);
    if (clientVersion) return this.codexModels(req.ingestionContext, clientVersion);

    const includeCapabilities = capabilities === 'true';
    const includeCost = cost === 'true';
    const includeManifestParams = wantsManifestParams(req);
    const [aliases, models] = await Promise.all([
      this.modelAliasService.listEnabled(req.ingestionContext.agentId),
      this.modelDiscovery.getModelsForAgent(
        req.ingestionContext.tenantId,
        req.ingestionContext.agentId,
      ),
    ]);
    const autoContext = await this.autoContextWindow(
      req.ingestionContext.agentId,
      req.ingestionContext.tenantId,
      models,
    );
    const autoRow: OpenAiModelObject = {
      id: 'auto',
      object: 'model',
      created: MODEL_CREATED_UNKNOWN,
      owned_by: 'manifest',
      display_name: 'Manifest Auto',
    };
    const manifestAutoRow: OpenAiModelObject = {
      id: 'manifest/auto',
      object: 'model',
      created: MODEL_CREATED_UNKNOWN,
      owned_by: 'manifest',
      display_name: 'Manifest Auto',
    };
    addContextFields(autoRow, autoContext);
    addContextFields(manifestAutoRow, autoContext);
    const data: OpenAiModelObject[] = [autoRow, manifestAutoRow];
    const seen = new Set(data.map((model) => model.id.toLowerCase()));

    for (const alias of aliases) {
      const aliasMetadata = await this.aliasModelMetadata(
        req.ingestionContext.agentId,
        req.ingestionContext.tenantId,
        alias,
        models,
      );
      if (!aliasMetadata) continue;
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
      addContextFields(row, aliasMetadata.contextWindow);
      if (includeManifestParams && aliasMetadata.route) {
        addManifestParams(row, await this.manifestParamsForRoute(aliasMetadata.route));
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
      const entry: OpenAiModelObject = {
        id,
        object: 'model',
        created: MODEL_CREATED_UNKNOWN,
        owned_by: model.provider,
      };
      addContextFields(entry, model.contextWindow);
      if (includeManifestParams) addManifestParams(entry, params);
      if (includeCapabilities) {
        // Same resolution as the dashboard's model picker, so agents and the
        // routing UI report identical capability facts.
        const resolved = await resolveModelCapabilityMetadata(
          model,
          this.providerParamSpecs,
          this.modelsDevSync,
        );
        const modelCapabilities = openAiModelCapabilities({ ...model, ...resolved });
        if (modelCapabilities) entry.capabilities = modelCapabilities;
      }
      if (includeCost) {
        const modelCost = openAiModelCost(model.inputPricePerToken, model.outputPricePerToken);
        if (modelCost) entry.cost = modelCost;
      }
      data.push(entry);
      addReasoningVariantRows(data, seen, entry, params);
    }

    return {
      object: 'list',
      data,
    };
  }

  private async codexModels(
    context: IngestionContext,
    clientVersion: string,
  ): Promise<CodexModelList> {
    const [aliases, models] = await Promise.all([
      this.modelAliasService.listEnabled(context.agentId),
      this.modelDiscovery.getCodexModelsForAgent(context.tenantId, context.agentId),
    ]);
    const catalog: CodexModelInfo[] = [];
    const seen = new Set<string>();

    for (const alias of aliases) {
      if (alias.source_kind !== 'direct' || !alias.route) continue;
      const info = codexMetadataForRoute(alias.route, models);
      if (!info) continue;
      const key = alias.model_id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      catalog.push(
        codexModelInfoForClient(
          {
            ...info,
            slug: alias.model_id,
            display_name: alias.display_name ?? info.display_name,
            visibility: 'list',
            supported_in_api: true,
          },
          clientVersion,
        ),
      );
    }

    return { models: catalog };
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

  private async autoContextWindow(
    agentId: string,
    tenantId: string,
    models: Awaited<ReturnType<ModelDiscoveryService['getModelsForAgent']>>,
  ): Promise<number | null> {
    const routeChains = await this.resolveService.getAvailableRouteChains(agentId, tenantId);
    const routedContexts: number[] = [];
    for (const chain of routeChains) {
      const routeContext = contextForRouteChain(chain.primaryRoute, chain.fallbackRoutes, models);
      if (routeContext !== null) routedContexts.push(routeContext);
    }
    if (routeChains.length > 0) return minFiniteContext(routedContexts);
    return minFiniteContext(models.map((model) => model.contextWindow));
  }

  private async aliasModelMetadata(
    agentId: string,
    tenantId: string,
    alias: ExposedModelRoute,
    models: Awaited<ReturnType<ModelDiscoveryService['getModelsForAgent']>>,
  ): Promise<{ route: ModelRoute | null; contextWindow: number | null } | null> {
    try {
      const resolution = await this.modelAliasService.resolveModelRequest(
        agentId,
        tenantId,
        alias.model_id,
        { includeRawDirect: false },
      );
      if (resolution.kind !== 'resolved') return null;
      const route = resolution.resolved.route;
      const fallbackRoutes = resolution.resolved.fallback_routes;
      if (!route && (!fallbackRoutes || fallbackRoutes.length === 0)) return null;
      return {
        route,
        contextWindow: contextForRouteChain(route, fallbackRoutes, models),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(`Skipping unavailable model alias ${alias.model_id}: ${message}`);
      return null;
    }
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
    const { agentId, tenantId } = req.ingestionContext;
    const body = req.body as Record<string, unknown>;
    const sessionScope = buildProxySessionScope(tenantId, agentId, req.headers['x-session-key']);
    const { sessionKey } = sessionScope;
    const traceId = this.extractTraceId(req);
    const requestId = uuid();
    const callerAttribution = classifyCaller(req.headers);
    const requestHeaders = sanitizeRequestHeaders(req.headers);
    const isStream = body.stream === true;
    let routingBody = body;
    let headersSent = false;
    let slotAcquired = false;
    let currentMeta: RoutingMeta | undefined;
    let recordingEnabled = false;
    let currentAttempt: ProviderAttemptRef | undefined;
    let currentAttemptStart: ProviderAttemptStart | undefined;

    const clientAbort = new AbortController();
    res.once('close', () => clientAbort.abort());
    const startTime = Date.now();

    // The Request exists as pending from ingress, before Manifest routes it or
    // starts any provider call. A recording failure must not reject user traffic.
    await this.recorder
      .recordPendingRequest(req.ingestionContext, {
        requestId,
        timestamp: new Date(startTime).toISOString(),
        traceId,
        sessionKey,
        requestedModel: this.extractRequestedModel(body),
        callerAttribution,
        requestHeaders,
      })
      .catch((e) => this.logger.warn(`Failed to record pending Request: ${e}`));

    if (this.recordingCache && this.attemptRecording) {
      try {
        recordingEnabled =
          this.attemptRecording.available &&
          (await this.recordingCache.isRecording(req.ingestionContext.agentId));
      } catch (e) {
        recordingEnabled = false;
        this.logger.warn(`Failed to resolve attempt recording config: ${e}`);
      }
    }

    let attemptSequence = 0;
    const startProviderAttempt: StartProviderAttempt = (start) => {
      const startedAtMs = Date.now();
      const attempt: ProviderAttemptRef = {
        id: uuid(),
        attemptNumber: ++attemptSequence,
        startedAtMs,
        startedAt: new Date(startedAtMs).toISOString(),
        pendingWrite: Promise.resolve(false),
      };
      let recordingFinished = false;
      attempt.startRecording = ({ requestBody, wireFormat }) => {
        if (!recordingEnabled || !this.attemptRecording || attempt.recordingCapture) {
          return;
        }
        attempt.recordingCapture = createAttemptRecordingCapture(requestBody, wireFormat);
      };
      attempt.finishRecording = async (response) => {
        if (recordingFinished) return;
        const capture = attempt.recordingCapture;
        if (!capture || !this.attemptRecording) return;
        if (response?.type === 'stream') {
          capture.setRaw(response.raw_sse ?? '');
        } else if (response?.type === 'json') {
          capture.setJson(response.body);
        }
        recordingFinished = true;
        if (!(await attempt.pendingWrite.catch(() => false))) return;
        await this.attemptRecording
          .save(tenantId, requestId, attempt.id, capture.buildRecording())
          .catch((e) => this.logger.warn(`Failed to finish Provider Attempt recording: ${e}`));
      };
      currentAttempt = attempt;
      currentAttemptStart = start;
      attempt.pendingWrite = this.recorder
        .recordPendingProviderAttempt(req.ingestionContext, requestId, attempt, start)
        .catch((e) => {
          this.logger.warn(`Failed to record pending Provider Attempt: ${e}`);
          return false;
        });
      attempt.completeFailure = ({ status, errorBody, superseded }) =>
        this.recorder
          .completePendingProviderFailure(attempt, status, errorBody, superseded)
          .catch((e) => this.logger.warn(`Failed to complete Provider Attempt: ${e}`));
      return attempt;
    };

    // Plan request-limit gate. A 402 must reach ProxyExceptionFilter (friendly
    // upgrade message / real 402), but still gets a Manifest-policy row in
    // agent_messages so the Messages tab explains why the request never routed.
    // Billing counters exclude Manifest-origin rows, so this does not consume
    // quota or push the tenant further over the limit.
    try {
      await this.planService.assertWithinRequestLimit(req.ingestionContext);
    } catch (err: unknown) {
      if (err instanceof HttpException && err.getStatus() === HttpStatus.PAYMENT_REQUIRED) {
        this.recordManifestBlockedRequest(
          err,
          req,
          requestId,
          traceId,
          callerAttribution,
          requestHeaders,
          'plan_request_limit_exceeded',
          HttpStatus.PAYMENT_REQUIRED,
          'M204',
          Date.now() - startTime,
        );
        throw err;
      }
      await this.handleProxyError(
        err,
        req,
        res,
        clientAbort,
        headersSent,
        requestId,
        traceId,
        callerAttribution,
        requestHeaders,
        apiMode,
        undefined,
        undefined,
      );
      return;
    }

    try {
      // Each of these throws its own ManifestError (M201 per-user, M202 per-IP,
      // M203 concurrency), so handleProxyError records which limit actually
      // fired instead of collapsing all three into one reason.
      this.rateLimiter.checkLimit(tenantId);
      this.rateLimiter.checkIpLimit(req.ip ?? '');
      this.rateLimiter.acquireSlot(tenantId);
      slotAcquired = true;
      routingBody = redactInlineImageDataUrls(body);
      const specificityOverride = req.headers['x-manifest-specificity'] as string | undefined;
      const { forward, meta, failedFallbacks, autofix } = await this.proxyService.proxyRequest({
        agentId: req.ingestionContext.agentId,
        tenantId,
        // Attribution only — the recorder writes it to agent_messages.user_id.
        userId: req.ingestionContext.userId,
        body,
        routingBody,
        sessionKey,
        sessionCacheKey: sessionScope.cacheKey,
        providerCacheKey: sessionScope.providerCacheKey,
        sessionMomentumKey: sessionScope.momentumKey,
        agentName: req.ingestionContext.agentName,
        signal: clientAbort.signal,
        specificityOverride,
        headers: req.headers,
        apiMode,
        startProviderAttempt,
      });
      currentMeta = meta;

      this.trackFirstProxyRequest(tenantId);

      const metaHeaders = buildMetaHeaders(meta);
      const providerResponse = forward.response;
      const responseCapture = forward.attempt?.recordingCapture;

      if (!providerResponse.ok) {
        const errorBody = await providerResponse.text();
        await forward.attempt?.finishRecording?.(recordingResponseFromText(errorBody));
        // Evidence feed (AUTOFIX_REPORT_ALL_4XX). Auto-fix already hands Phoenix
        // the full body for the requests it heals; every other request-side 4xx
        // reaches Phoenix only via Peacock's hourly scrape, which carries the
        // model-parameter snapshot and not the messages. Report it live instead —
        // but only for agents that turned Auto-fix on (the reporter's own gate).
        //
        // `traceId` is the `traceparent` id Peacock's scrape reports for the same
        // row, so a scraped duplicate collapses onto this one in Phoenix's ledger.
        // Callers that send no `traceparent` get a fresh id, which the scrape
        // cannot match — those failures are recorded twice until the scrape is
        // retired for live traffic.
        //
        // Auto-fix reports the PRIMARY attempt itself. The fallback chain runs
        // after it, so when the response we're about to return came from a
        // fallback model it is a different provider/model failing and Phoenix has
        // never seen it — skipping on `autofix` alone would hide it.
        const alreadyReportedByAutofix = Boolean(autofix) && !meta.fallbackFromModel;
        const wireRequestBody = forward.wireRequestBody;
        const wireApiMode = forward.wireApiMode;
        const wireFormat = forward.wireFormat;
        if (!alreadyReportedByAutofix && meta.auth_type && wireRequestBody && wireFormat) {
          this.observationReporter.report({
            traceId: traceId ?? uuid(),
            tenantId,
            agentId: req.ingestionContext.agentId,
            provider: meta.provider,
            model: meta.model,
            authType: meta.auth_type,
            apiMode: wireApiMode ?? apiMode,
            requestBody: wireRequestBody,
            providerWire: {
              format: wireFormat,
              ...(forward.wireRequestUrl ? { url: forward.wireRequestUrl } : {}),
              body: wireRequestBody,
            },
            status: providerResponse.status,
            errorBody,
            responseTimeMs: Date.now() - startTime,
          });
        }
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
          autofix,
          requestId,
          Date.now() - startTime,
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
        autofix,
        requestId,
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
          sessionScope.cacheKey,
          this.thinkingCache,
          apiMode,
          this.reasoningCache,
          responseCapture,
        );
      } else {
        streamUsage = await handleNonStreamResponse(
          res,
          forward,
          meta,
          metaHeaders,
          this.providerClient,
          this.signatureCache,
          sessionScope.cacheKey,
          this.thinkingCache,
          apiMode,
          this.reasoningCache,
          responseCapture,
        );
      }

      await forward.attempt?.finishRecording?.();

      // A friendly stub (no provider key, no providers, usage limit) leaves the
      // proxy as an HTTP 200 assistant message, so it lands here — but it is a
      // Manifest failure, not a completion. Record it as one.
      if (meta.manifest_error_code) {
        this.recordManifestStub(
          req,
          meta,
          requestId,
          traceId,
          sessionKey,
          callerAttribution,
          requestHeaders,
          autofix,
          Date.now() - startTime,
        );
      } else {
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
          autofix,
          requestId,
          currentPrimaryAttemptNumber(autofix) +
            (meta.fallbackFromModel ? (failedFallbacks?.length ?? 0) + 1 : 0),
        );
      }
    } catch (err: unknown) {
      await this.handleProxyError(
        err,
        req,
        res,
        clientAbort,
        headersSent,
        requestId,
        traceId,
        callerAttribution,
        requestHeaders,
        apiMode,
        currentMeta,
        startTime,
        currentAttempt,
        currentAttemptStart,
      );
      await (currentMeta?.attempt ?? currentAttempt)?.finishRecording?.();
    } finally {
      if (slotAcquired) this.rateLimiter.releaseSlot(tenantId);
    }
  }

  /**
   * Record the HTTP-200 friendly stub Manifest returned in place of a completion.
   * `meta.manifest_error_message` is the rendered `[🦚 Manifest M100] …` text the
   * caller actually saw — persisting it verbatim (rather than a generic
   * "Provider API key missing") is what makes the row debuggable.
   */
  private recordManifestStub(
    req: Request & { ingestionContext: IngestionContext },
    meta: RoutingMeta,
    requestId: string,
    traceId: string | undefined,
    sessionKey: string | undefined,
    callerAttribution: ReturnType<typeof classifyCaller>,
    requestHeaders: ReturnType<typeof sanitizeRequestHeaders>,
    autofix: AutofixRecord | undefined,
    durationMs: number,
  ): void {
    const code = meta.manifest_error_code;
    if (!code || !isRecordableManifestCode(code)) return;
    this.recorder
      .recordManifestBlockedRequest(req.ingestionContext, {
        requestId,
        errorMessage: meta.manifest_error_message ?? formatManifestError(code),
        errorCode: code,
        reason: MANIFEST_CODE_TO_REASON[code],
        model: this.extractRequestedModel(req.body as Record<string, unknown> | undefined),
        traceId,
        sessionKey,
        callerAttribution,
        requestHeaders,
        // A failed heal attempt still stamps its Phoenix audit on the M row.
        autofix,
        attempt: meta.attempt,
        durationMs,
      })
      .catch((e) => this.logger.warn(`Failed to record Manifest stub: ${e}`));
  }

  private async handleProxyError(
    err: unknown,
    req: Request & { ingestionContext: IngestionContext },
    res: ExpressResponse,
    clientAbort: AbortController,
    headersSent: boolean,
    requestId: string,
    traceId: string | undefined,
    callerAttribution: ReturnType<typeof classifyCaller>,
    requestHeaders: ReturnType<typeof sanitizeRequestHeaders>,
    apiMode: ProxyApiMode,
    meta?: RoutingMeta,
    startTime?: number,
    currentAttempt?: ProviderAttemptRef,
    currentAttemptStart?: ProviderAttemptStart,
  ): Promise<void> {
    const capture = (meta?.attempt ?? currentAttempt)?.recordingCapture;
    if (clientAbort.signal.aborted) {
      await this.recorder
        .recordCancelledRequest(req.ingestionContext, {
          requestId,
          attempt: meta?.attempt ?? currentAttempt,
          attemptStart: currentAttemptStart,
          requestDurationMs: startTime == null ? undefined : Date.now() - startTime,
          traceId,
        })
        .catch((e) => this.logger.warn(`Failed to record cancelled Request: ${e}`));
      if (!res.writableEnded) res.end();
      return;
    }

    const message = this.extractErrorMessage(err);
    const status =
      err instanceof StreamFailure
        ? err.status
        : err instanceof ResponsesSseError
          ? err.status
          : err instanceof HttpException
            ? err.getStatus()
            : 500;
    const providerErrorBody = err instanceof ResponsesSseError ? err.body : message;
    this.logger.error(`Proxy error: ${message}`);

    // Who failed? A ManifestError says so explicitly. Pre-response dead sockets
    // and timeouts become synthetic 503/504 responses in proxy-transport. A
    // socket that dies after streaming starts is thrown as StreamFailure.
    // Other non-HTTP throws are Manifest's own bugs (M500).
    //
    // An unrecordable ManifestError (M001–M003, M005) writes NOTHING: it has no
    // tenant to attribute, and falling through to recordProviderError would blame
    // the provider for someone presenting a bad key.
    if (err instanceof ManifestError) {
      if (isRecordableManifestCode(err.code)) {
        this.recordManifestBlockedRequest(
          err,
          req,
          requestId,
          traceId,
          callerAttribution,
          requestHeaders,
          MANIFEST_CODE_TO_REASON[err.code],
          status,
          err.code,
          startTime == null ? undefined : Date.now() - startTime,
        );
      }
    } else if (
      !(err instanceof StreamFailure) &&
      !(err instanceof ResponsesSseError) &&
      !(err instanceof HttpException)
    ) {
      // A non-HTTP throw is Manifest's own bug, never a provider fault.
      this.recordManifestBlockedRequest(
        err,
        req,
        requestId,
        traceId,
        callerAttribution,
        requestHeaders,
        MANIFEST_CODE_TO_REASON.M500,
        status,
        'M500',
        startTime == null ? undefined : Date.now() - startTime,
      );
    } else {
      this.recorder
        .recordProviderError(req.ingestionContext, status, providerErrorBody, {
          requestId,
          ...(meta
            ? {
                attempt: meta.attempt,
                attemptNumber: meta.attempt?.attemptNumber,
                skipAttempt: meta.providerCallStarted === false,
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
          requestDurationMs: startTime == null ? undefined : Date.now() - startTime,
        })
        .catch((e) => this.logger.warn(`Failed to record provider error: ${e}`));
    }

    if (headersSent) {
      if (!res.writableEnded) {
        if (err instanceof StreamFailure) {
          this.writeStreamError(res, apiMode, err, meta);
        } else {
          res.end();
        }
      }
      return;
    }

    if (err instanceof ResponsesSseError) {
      const responseBody = {
        error: buildOpenAiCompatibleError(
          err.status,
          err.body,
          meta ? { provider: meta.provider, model: meta.model } : {},
        ),
      };
      capture?.setJson(responseBody);
      res.status(err.status).json(responseBody);
      return;
    }

    // Rate limit errors stay as HTTP 429 so clients can backoff
    if (status === 429) {
      // Never return the exception response object itself: framework and
      // provider exceptions can carry stack traces or markup. Manifest's
      // rate-limit messages come from our static catalogue; provider failures
      // use a stable public message.
      const rateLimitMessage =
        err instanceof ManifestError
          ? formatManifestError(err.code)
          : 'Rate limited by upstream provider';
      const responseBody = {
        error: { message: rateLimitMessage, type: 'rate_limit_error' },
      };
      const safeResponse = sanitizeExceptionResponse(responseBody);
      capture?.setJson(safeResponse);
      res.status(429).json(safeResponse);
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
    const responseBody = {
      error: {
        message: errorMessage,
        type: status >= 500 ? 'server_error' : 'invalid_request_error',
      },
    };
    capture?.setJson(responseBody);
    res.status(status).json(responseBody);
  }

  private writeStreamError(
    res: ExpressResponse,
    apiMode: ProxyApiMode,
    streamError: StreamFailure,
    meta: RoutingMeta | undefined,
  ): void {
    const error = buildOpenAiCompatibleError(streamError.status, streamError.message, {
      source: 'provider',
      code: streamError.reason,
      provider: meta?.provider,
      model: meta?.model,
    });
    error.message = streamError.message;

    if (apiMode === 'messages') {
      res.write(
        `event: error\ndata: ${JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: streamError.message },
        })}\n\n`,
      );
    } else if (apiMode === 'responses') {
      res.write(
        `event: error\ndata: ${JSON.stringify({
          type: 'error',
          code: error.code ?? 'server_error',
          message: streamError.message,
          param: null,
          sequence_number: nextResponsesSequenceNumber(res),
        })}\n\n`,
      );
    } else {
      res.write(`data: ${JSON.stringify({ error })}\n\ndata: [DONE]\n\n`);
    }
    res.end();
  }

  private extractTraceId(req: Request): string | undefined {
    const header = req.headers['traceparent'] as string | undefined;
    if (!header) return undefined;
    const parts = header.split('-');
    return parts.length >= 2 ? parts[1] : undefined;
  }

  private extractSessionKey(req: Request & { ingestionContext: IngestionContext }): string {
    return buildProxySessionScope(
      req.ingestionContext.tenantId,
      req.ingestionContext.agentId,
      req.headers['x-session-key'],
    ).sessionKey;
  }

  private extractRequestedModel(body: Record<string, unknown> | undefined): string | undefined {
    const model = body?.model;
    return typeof model === 'string' && model.length > 0 ? model : undefined;
  }

  private extractErrorMessage(err: unknown): string {
    if (err instanceof ResponsesSseError) return err.body;
    if (err instanceof HttpException) {
      const response = err.getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object') {
        const record = response as Record<string, unknown>;
        const message = record.message;
        if (typeof message === 'string') return message;
        if (Array.isArray(message)) return message.filter((m) => typeof m === 'string').join(', ');
        const error = record.error;
        if (typeof error === 'string') return error;
        if (error && typeof error === 'object') {
          const nested = (error as Record<string, unknown>).message;
          if (typeof nested === 'string') return nested;
        }
        const code = record.code;
        if (code === 'PLAN_LIMIT_REQUESTS') return 'Free plan monthly request limit reached';
        if (typeof code === 'string') return code;
      }
    }
    return err instanceof Error ? err.message : String(err);
  }

  private recordManifestBlockedRequest(
    err: unknown,
    req: Request & { ingestionContext: IngestionContext },
    requestId: string,
    traceId: string | undefined,
    callerAttribution: ReturnType<typeof classifyCaller>,
    requestHeaders: ReturnType<typeof sanitizeRequestHeaders>,
    reason: ManifestBlockedRequestReason,
    httpStatus?: number,
    errorCode?: ManifestErrorCode,
    durationMs?: number,
  ): void {
    const body = req.body as Record<string, unknown> | undefined;
    this.recorder
      .recordManifestBlockedRequest(req.ingestionContext, {
        requestId,
        httpStatus: httpStatus ?? (err instanceof HttpException ? err.getStatus() : 500),
        // The raw internal message, not the friendly M500 text the caller saw —
        // the dashboard row is where you go to find out what actually broke.
        errorMessage: this.extractErrorMessage(err),
        errorCode,
        reason,
        model: this.extractRequestedModel(body),
        traceId,
        sessionKey: this.extractSessionKey(req),
        callerAttribution,
        requestHeaders,
        durationMs,
      })
      .catch((e) => this.logger.warn(`Failed to record Manifest-blocked request: ${e}`));
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

function codexClientVersion(req: Request): string | null {
  const value = req.query.client_version;
  if (typeof value !== 'string') return null;
  const version = value.trim();
  return version.length > 0 ? version : null;
}

function codexModelInfoForClient(info: CodexModelInfo, clientVersion: string): CodexModelInfo {
  // Codex 0.135-0.137 decode reasoning effort as a closed enum. Codex 0.138
  // introduced a custom-string fallback, so newer effort names are safe there.
  if (codexAcceptsOpenReasoningEfforts(clientVersion)) return info;

  const supported = (info.supported_reasoning_levels ?? []).filter((level) =>
    LEGACY_CODEX_REASONING_EFFORTS.has(level.effort.toLowerCase()),
  );
  const currentDefault = info.default_reasoning_level;
  const normalizedDefault = currentDefault?.toLowerCase();
  let compatibleDefault = currentDefault;
  if (normalizedDefault && !LEGACY_CODEX_REASONING_EFFORTS.has(normalizedDefault)) {
    compatibleDefault =
      (normalizedDefault === 'max' || normalizedDefault === 'ultra'
        ? supported.at(-1)?.effort
        : supported.find((level) => level.effort === 'medium')?.effort) ??
      supported[Math.floor((supported.length - 1) / 2)]?.effort ??
      null;
  }

  return {
    ...info,
    default_reasoning_level: compatibleDefault,
    supported_reasoning_levels: supported,
  };
}

function codexAcceptsOpenReasoningEfforts(clientVersion: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:$|[-+])/.exec(clientVersion);
  if (!match) return false;
  const version = match.slice(1, 4).map(Number);
  for (let index = 0; index < CODEX_OPEN_REASONING_EFFORT_MIN_VERSION.length; index++) {
    const difference = version[index] - CODEX_OPEN_REASONING_EFFORT_MIN_VERSION[index];
    if (difference !== 0) return difference > 0;
  }
  return true;
}

function codexMetadataForRoute(
  route: ModelRoute,
  models: DiscoveredModel[],
): CodexModelInfo | null {
  return (
    models.find(
      (model) =>
        model.provider.toLowerCase() === route.provider.toLowerCase() &&
        model.authType === route.authType &&
        model.id === route.model &&
        !!model.codexModelInfo,
    )?.codexModelInfo ?? null
  );
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
      context_window: base.context_window,
      context_length: base.context_length,
      type: base.type,
    });
  }
}

function addContextFields(row: OpenAiModelObject, value: number | null | undefined): void {
  const context = finiteContext(value);
  if (context === null) return;
  row.context_window = context;
  row.context_length = context;
}

function contextForRouteChain(
  primaryRoute: ModelRoute | null,
  fallbackRoutes: ModelRoute[] | null,
  models: Awaited<ReturnType<ModelDiscoveryService['getModelsForAgent']>>,
): number | null {
  const contexts = [primaryRoute, ...(fallbackRoutes ?? [])]
    .map((route) => (route ? contextForRoute(route, models) : null))
    .filter((value): value is number => value !== null);
  return minFiniteContext(contexts);
}

function contextForRoute(
  route: ModelRoute,
  models: Awaited<ReturnType<ModelDiscoveryService['getModelsForAgent']>>,
): number | null {
  const model = models.find(
    (candidate) =>
      candidate.provider.toLowerCase() === route.provider.toLowerCase() &&
      (!route.authType || candidate.authType === route.authType) &&
      candidate.id === route.model,
  );
  return finiteContext(model?.contextWindow);
}

function minFiniteContext(values: Array<number | null | undefined>): number | null {
  const finite = values.map(finiteContext).filter((value): value is number => value !== null);
  return finite.length > 0 ? Math.min(...finite) : null;
}

function finiteContext(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
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
