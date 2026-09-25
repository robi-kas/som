import { IsEnum } from 'class-validator';

export enum TableStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  WAITING_FOR_PAYMENT = 'WAITING_FOR_PAYMENT',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
}

export class UpdateTableStatusDto {
  @IsEnum(TableStatus) status!: TableStatus;
}
