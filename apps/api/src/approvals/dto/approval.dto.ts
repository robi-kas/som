import { IsString, IsNotEmpty, Matches, MaxLength, IsIn } from 'class-validator';

/** Permissions that can be granted on the spot with a manager PIN. */
export const PIN_APPROVABLE_PERMISSIONS = [
  'order.void_item',
  'order.void',
  'order.discount_large',
  'refund.approve',
  'receipt.reprint',
  'shift.approve_variance',
] as const;

export class CreateApprovalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username!: string;

  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4–6 digits' })
  pin!: string;

  @IsIn(PIN_APPROVABLE_PERMISSIONS as unknown as string[])
  permission!: string;
}

export class SetPinDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword!: string;

  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4–6 digits' })
  pin!: string;
}
