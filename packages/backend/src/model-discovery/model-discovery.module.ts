import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantProvider } from '../entities/tenant-provider.entity';
import { AgentEnabledProvider } from '../entities/agent-enabled-provider.entity';
import { CustomProvider } from '../entities/custom-provider.entity';
import { AgentModelFilter } from '../entities/agent-model-filter.entity';
import { ModelPricesModule } from '../model-prices/model-prices.module';
import { ProviderModelFetcherService } from './provider-model-fetcher.service';
import { ModelDiscoveryService } from './model-discovery.service';
import { OpencodeGoCatalogService } from './opencode-go-catalog.service';
import { CopilotTokenService } from '../routing/proxy/copilot-token.service';
import { AgentModelFilterService } from './agent-model-filter.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TenantProvider,
      AgentEnabledProvider,
      CustomProvider,
      AgentModelFilter,
    ]),
    ModelPricesModule,
  ],
  providers: [
    ProviderModelFetcherService,
    ModelDiscoveryService,
    OpencodeGoCatalogService,
    CopilotTokenService,
    AgentModelFilterService,
  ],
  exports: [
    ModelDiscoveryService,
    ProviderModelFetcherService,
    OpencodeGoCatalogService,
    AgentModelFilterService,
  ],
})
export class ModelDiscoveryModule {}
