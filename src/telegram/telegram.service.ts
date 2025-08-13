import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as TelegramBot from 'node-telegram-bot-api';
import { TelegramWebhookDto } from './dto/telegram.dto';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: any;
  private readonly botToken: string;

  constructor(private configService: ConfigService) {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN') || '';

    if (!this.botToken) {
      this.logger.error(
        'TELEGRAM_BOT_TOKEN not found in environment variables',
      );
      throw new Error('TELEGRAM_BOT_TOKEN is required');
    }

    // Validate token format
    if (!this.isValidBotToken(this.botToken)) {
      this.logger.error(
        'Invalid TELEGRAM_BOT_TOKEN format. Expected format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
      );
      throw new Error('Invalid TELEGRAM_BOT_TOKEN format');
    }

    this.logger.log(`Bot token loaded: ${this.botToken.substring(0, 10)}...`);

    // Create bot without polling since we use webhooks
    this.bot = new TelegramBot(this.botToken, { polling: false });
  }

  private isValidBotToken(token: string): boolean {
    // Telegram bot token format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
    const tokenRegex = /^\d{8,10}:[A-Za-z0-9_-]{35}$/;
    return tokenRegex.test(token);
  }

  async onModuleInit() {
    try {
      this.logger.log('Initializing Telegram bot...');
      const botInfo = await this.bot.getMe();
      this.logger.log(
        `Telegram bot initialized successfully: @${botInfo.username} (${botInfo.first_name})`,
      );
    } catch (error) {
      this.logger.error('Error initializing Telegram bot:', error.message);
      this.logger.error('Please check your TELEGRAM_BOT_TOKEN in .env file');

      if (error.message.includes('404')) {
        this.logger.error(
          '404 error usually means invalid bot token. Please verify your token with @BotFather',
        );
      }
    }
  }

  async processWebhookUpdate(update: TelegramWebhookDto): Promise<void> {
    this.logger.debug(`Received update: ${JSON.stringify(update)}`);

    if (update.message && update.message.text) {
      await this.handleTextMessage(
        update.message.chat.id,
        update.message.from.first_name,
        update.message.text,
      );
    }
  }

  private async handleTextMessage(
    chatId: number,
    userName: string,
    messageText: string,
  ): Promise<void> {
    this.logger.log(
      `Message from ${userName} (chat: ${chatId}): ${messageText}`,
    );

    try {
      // For now, just reply with "I'm alive"
      await this.sendMessage(chatId, "I'm alive! 🤖");
    } catch (error) {
      this.logger.error('Error sending message:', error.message);
    }
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, text);
      this.logger.debug(`Message sent to chat ${chatId}: ${text}`);
    } catch (error) {
      this.logger.error(
        `Error sending message to chat ${chatId}:`,
        error.message,
      );
      throw error;
    }
  }

  async setWebhook(webhookUrl: string): Promise<boolean> {
    try {
      const result = await this.bot.setWebHook(webhookUrl);
      this.logger.log(`Webhook set: ${webhookUrl}`);
      return result;
    } catch (error) {
      this.logger.error('Error setting webhook:', error.message);
      throw error;
    }
  }

  async deleteWebhook(): Promise<boolean> {
    try {
      const result = await this.bot.deleteWebHook();
      this.logger.log('Webhook deleted');
      return result;
    } catch (error) {
      this.logger.error('Error deleting webhook:', error.message);
      throw error;
    }
  }

  async getWebhookInfo(): Promise<any> {
    try {
      const info = await this.bot.getWebHookInfo();
      this.logger.log(`Webhook info: ${JSON.stringify(info)}`);
      return info;
    } catch (error) {
      this.logger.error('Error getting webhook info:', error.message);
      throw error;
    }
  }

  async getBotInfo(): Promise<any> {
    try {
      const info = await this.bot.getMe();
      this.logger.log(`Bot info retrieved: @${info.username}`);
      return info;
    } catch (error) {
      this.logger.error('Error getting bot info:', error.message);
      throw error;
    }
  }
}
