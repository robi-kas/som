import { IsBoolean } from 'class-validator';

export class UpdateCategoryDto {
  @IsBoolean() isActive!: boolean;
}
