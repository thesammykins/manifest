import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AUTH_TYPES, type AuthType } from 'manifest-shared';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class SetModelFilterDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => trimString(value))
  provider!: string;

  @IsIn(AUTH_TYPES)
  auth_type!: AuthType;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => trimString(value))
  model_name!: string;

  @IsBoolean()
  enabled!: boolean;
}

export class SetModelFilterBulkDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => trimString(value))
  provider?: string;

  @IsOptional()
  @IsIn(AUTH_TYPES)
  auth_type?: AuthType;

  @IsBoolean()
  enabled!: boolean;
}
