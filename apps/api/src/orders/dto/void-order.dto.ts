import { IsInt, Min, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class VoidOrderDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
