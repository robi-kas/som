import { IsString, IsNotEmpty, MaxLength, IsDecimal } from 'class-validator';

export class ChangeProductPriceDto {
  @IsString()
  @IsNotEmpty()
  @IsDecimal({ decimal_digits: '0,2' })
  newPrice!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
