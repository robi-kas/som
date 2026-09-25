import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ReprintReceiptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;
}
