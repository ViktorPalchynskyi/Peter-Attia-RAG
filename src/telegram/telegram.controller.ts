import {
  Body,
  Controller,
  Post,
  Get,
  Logger,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { TelegramService } from './telegram.service';
import { TelegramWebhookDto } from './dto/telegram.dto';

@ApiTags('Telegram Bot')
@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(private readonly telegramService: TelegramService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook for receiving Telegram updates',
    description:
      'Endpoint for processing incoming messages from Telegram Bot API',
  })
  @ApiBody({
    type: TelegramWebhookDto,
    description: 'Webhook data from Telegram',
  })
  @ApiResponse({
    status: 200,
    description: 'Message processed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid webhook data',
  })
  async handleWebhook(
    @Body() update: TelegramWebhookDto,
  ): Promise<{ status: string }> {
    this.logger.debug(`Webhook received: ${JSON.stringify(update)}`);

    try {
      await this.telegramService.processWebhookUpdate(update);
      return { status: 'ok' };
    } catch (error) {
      this.logger.error('Error processing webhook:', error.message);
      throw error;
    }
  }

  @Post('set-webhook')
  @ApiOperation({
    summary: 'Set webhook URL for the bot',
    description: 'Sets the webhook URL for receiving updates from Telegram',
  })
  @ApiQuery({
    name: 'url',
    required: true,
    description: 'Webhook URL (must start with https://)',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook set successfully',
  })
  async setWebhook(
    @Query('url') webhookUrl: string,
  ): Promise<{ success: boolean; url: string }> {
    this.logger.log(`Setting webhook: ${webhookUrl}`);

    const success = await this.telegramService.setWebhook(webhookUrl);
    return { success, url: webhookUrl };
  }

  @Post('delete-webhook')
  @ApiOperation({
    summary: 'Delete webhook',
    description: 'Deletes the configured webhook',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook deleted successfully',
  })
  async deleteWebhook(): Promise<{ success: boolean }> {
    this.logger.log('Deleting webhook');

    const success = await this.telegramService.deleteWebhook();
    return { success };
  }

  @Get('webhook-info')
  @ApiOperation({
    summary: 'Get webhook information',
    description: 'Returns current webhook configuration information',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook information',
  })
  async getWebhookInfo(): Promise<any> {
    return await this.telegramService.getWebhookInfo();
  }

  @Get('test')
  @ApiOperation({
    summary: 'Test endpoint',
    description: 'Check if Telegram module is working',
  })
  @ApiResponse({
    status: 200,
    description: 'Module is working',
  })
  async test(): Promise<{ message: string; timestamp: string }> {
    this.logger.log('Telegram test endpoint called');
    return {
      message: 'Telegram Bot module is working!',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('bot-info')
  @ApiOperation({
    summary: 'Get bot information',
    description: 'Returns information about the configured bot',
  })
  @ApiResponse({
    status: 200,
    description: 'Bot information retrieved successfully',
  })
  async getBotInfo(): Promise<any> {
    try {
      return await this.telegramService.getBotInfo();
    } catch (error) {
      this.logger.error('Error getting bot info:', error.message);
      throw error;
    }
  }
}
