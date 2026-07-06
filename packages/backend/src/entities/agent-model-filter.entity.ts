import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { AuthType } from 'manifest-shared';
import { timestampDefault, timestampType } from '../common/utils/postgres-sql';

@Entity('agent_model_filters')
@Index(['agent_id'])
export class AgentModelFilter {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  tenant_id!: string;

  @Column('varchar')
  agent_id!: string;

  @Column('varchar')
  provider!: string;

  @Column('varchar')
  auth_type!: AuthType;

  @Column('varchar')
  model_id!: string;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;
}
