import { IsBoolean } from 'class-validator';

export class UpdateKitchenStationDto {
  @IsBoolean() isActive!: boolean;
}
