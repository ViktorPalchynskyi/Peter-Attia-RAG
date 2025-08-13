import {
  IsString,
  IsNumber,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TelegramUser {
  @IsNumber()
  id: number;

  @IsString()
  first_name: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  language_code?: string;
}

export class TelegramChat {
  @IsNumber()
  id: number;

  @IsString()
  type: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;
}

export class TelegramMessage {
  @IsNumber()
  message_id: number;

  @ValidateNested()
  @Type(() => TelegramUser)
  from: TelegramUser;

  @ValidateNested()
  @Type(() => TelegramChat)
  chat: TelegramChat;

  @IsNumber()
  date: number;

  @IsOptional()
  @IsString()
  text?: string;
}

export class TelegramWebhookDto {
  @IsNumber()
  update_id: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramMessage)
  message?: TelegramMessage;
}
