import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, IsUUID, Matches, MaxLength, IsDecimal } from 'class-validator';

export class RefundItemDto {
  @IsUUID() orderItemId!: string;
  @IsString() @IsDecimal({ decimal_digits: '0,3' }) quantity!: string;
  @IsString() @IsDecimal({ decimal_digits: '0,2' }) refundedAmount!: string;
}

export class InitiateRefundDto {
  @IsUUID() paymentId!: string;
  @IsString() @IsDecimal({ decimal_digits: '0,2' }) amount!: string;
  @Matches(/^[A-Z][A-Z0-9_]{1,29}$/) method!: string; // must equal the original payment's method
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RefundItemDto)
  items?: RefundItemDto[];
}

