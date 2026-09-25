import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Payment methods are configured per branch (Settings → Payment methods). The method's own
 * settings decide whether it needs a reference, a screenshot and a second person's check.
 */

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
/** Accepts "12.50" or 12.5 from older clients, stores it as a string — never a float. */
const toMoneyString = ({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value);

export class CreatePaymentDto {
  @Matches(/^[A-Z][A-Z0-9_]{1,29}$/, { message: 'Unknown payment method' })
  method!: string;

  @Transform(toMoneyString)
  @Matches(MONEY, { message: 'tenderedAmount must be an amount like 100 or 99.50' })
  tenderedAmount!: string;

  @Transform(toMoneyString)
  @Matches(MONEY, { message: 'appliedAmount must be an amount like 100 or 99.50' })
  appliedAmount!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9\-_/ ]{4,64}$/, { message: 'Transaction reference looks wrong' })
  referenceNumber?: string;

  /** "Other bank / app": the bank or app the customer paid from. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  payerBank?: string;
}

/**
 * A waiter's phone records a transfer (sent as a multipart form with the photo, so every
 * field arrives as a string).
 */
export class ReportPaymentDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,29}$/)
  method!: string;

  /** How much of the bill this pays. */
  @Transform(toMoneyString)
  @Matches(MONEY, { message: 'appliedAmount must be an amount like 100 or 99.50' })
  appliedAmount!: string;

  /** What the customer actually sent, if more than the bill part (the waiter gives change). */
  @IsOptional()
  @Transform(toMoneyString)
  @Matches(MONEY, { message: 'sentAmount must be an amount like 100 or 99.50' })
  sentAmount?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9\-_/ ]{4,64}$/, { message: 'Transaction reference looks wrong' })
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  payerBank?: string;
}

export class ConfirmPaymentDto {}

export class SetReferenceDto {
  @IsString()
  @Matches(/^[A-Za-z0-9\-_/ ]{4,64}$/, { message: 'Transaction reference looks wrong' })
  referenceNumber!: string;
}

export class RejectPaymentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason!: string;
}
