import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min, Max, IsNotEmpty } from 'class-validator';

export class ModifierDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @IsOptional() @Matches(/^\d{1,8}(\.\d{1,2})?$/) priceDelta?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(999) displayOrder?: number;
}
