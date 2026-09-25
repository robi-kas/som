import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SetProductStatusDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['AVAILABLE', 'OUT_OF_STOCK', 'INACTIVE'])
  status!: string;
}
