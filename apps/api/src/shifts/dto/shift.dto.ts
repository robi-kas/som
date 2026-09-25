import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested, IsArray, ArrayMaxSize } from 'class-validator';
import { Transform, Type } from 'class-transformer';

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const toMoneyString = ({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value);

export class OpenShiftDto {
  // Branch ids are not always UUIDs (the seeded branch is "branch-default").
  @IsNotEmpty()
  @IsString()
  branchId!: string;

  @Transform(toMoneyString)
  @Matches(MONEY, { message: 'openingFloat must be an amount like 500 or 500.00' })
  openingFloat!: string;
}

export class CashMovementDto {
  @IsIn(['CASH_DEPOSIT', 'CASH_WITHDRAWAL'])
  type!: 'CASH_DEPOSIT' | 'CASH_WITHDRAWAL';

  @Transform(toMoneyString)
  @Matches(MONEY)
  amount!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;
}

export class DenominationCountDto {
  /** Note or coin value in birr, e.g. "200", "0.50". */
  @Transform(toMoneyString)
  @Matches(MONEY)
  value!: string;

  @IsInt()
  @Min(0)
  @Max(100000)
  count!: number;
}

export class CloseShiftDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => DenominationCountDto)
  cashCounts!: DenominationCountDto[];
}

export class ApproveVarianceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
