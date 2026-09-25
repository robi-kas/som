import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export const METHOD_KINDS = ['CASH', 'CARD', 'MOBILE_MONEY', 'BANK_APP', 'OTHER'] as const;

export class CreatePaymentMethodDto {
  @IsString() @IsNotEmpty() branchId!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) name!: string;
  /** Optional; generated from the name if missing (e.g. "Zemen Bank" → ZEMEN_BANK). */
  @IsOptional() @Matches(/^[A-Z][A-Z0-9_]{1,29}$/) code?: string;
  @IsIn(METHOD_KINDS as unknown as string[]) kind!: string;
  @IsOptional() @IsBoolean() requiresReference?: boolean;
  @IsOptional() @IsBoolean() requiresProof?: boolean;
  @IsOptional() @IsBoolean() requiresVerification?: boolean;
  @IsOptional() @IsBoolean() askPayerBank?: boolean;
  @IsOptional() @IsString() @MaxLength(120) accountInfo?: string;
}

export class UpdatePaymentMethodDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(40) name?: string;
  @IsOptional() @IsBoolean() requiresReference?: boolean;
  @IsOptional() @IsBoolean() requiresProof?: boolean;
  @IsOptional() @IsBoolean() requiresVerification?: boolean;
  @IsOptional() @IsBoolean() askPayerBank?: boolean;
  @IsOptional() @IsString() @MaxLength(120) accountInfo?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(999) displayOrder?: number;
}
