import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const PERCENT = /^\d{1,2}(\.\d{1,2})?$|^100(\.0{1,2})?$/;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

export class UpdateBranchSettingsDto {
  /** The cafe's name: shown on every screen and printed on bills. */
  @IsOptional() @IsString() @MaxLength(80) cafeName?: string;
  @IsOptional() @IsString() @MaxLength(80) branchName?: string;
  @IsOptional() @Matches(PERCENT) taxRate?: string;
  @IsOptional() @IsBoolean() isTaxInclusive?: boolean;
  @IsOptional() @Matches(PERCENT) serviceChargeRate?: string;
  @IsOptional() @IsIn(['HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL']) roundingMode?: string;
  @IsOptional() @Matches(MONEY) varianceTolerance?: string;
  @IsOptional() @Matches(PERCENT) largeDiscountPercent?: string;
  @IsOptional() @Matches(MONEY) cashierRefundLimit?: string;
  @IsOptional() @IsInt() @Min(1) @Max(120) ticketWarnMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(180) ticketLateMinutes?: number;
  @IsOptional() @IsString() @MaxLength(40) tinNumber?: string;
  @IsOptional() @IsString() @MaxLength(200) receiptFooter?: string;
  @IsOptional() @IsBoolean() verifyBySecondPerson?: boolean;
  /** Waiters may record transfer payments (with a photo) on their phone. */
  @IsOptional() @IsBoolean() waiterPayments?: boolean;
  @IsOptional() @IsBoolean() waiterPhotoRequired?: boolean;
}

export class PurgeAuditDto {
  /** Keep this many most recent days; everything older is removed. */
  @IsIn([30, 90, 365]) olderThanDays!: number;
  @IsString() @MaxLength(256) password!: string;
}

export class ResetDataDto {
  @IsIn(['SALES', 'EVERYTHING']) scope!: 'SALES' | 'EVERYTHING';
  /** Must be exactly "DELETE <cafe name>". */
  @IsString() @MaxLength(120) confirmPhrase!: string;
  @IsString() @MaxLength(256) password!: string;
}
