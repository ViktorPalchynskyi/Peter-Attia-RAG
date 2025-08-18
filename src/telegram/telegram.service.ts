import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as TelegramBot from 'node-telegram-bot-api';
import { TelegramWebhookDto } from './dto/telegram.dto';
import { RagService } from '../document/services/rag.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ResponseMode } from '../document/dto/rag.dto';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: any;
  private readonly botToken: string;

  constructor(
    private configService: ConfigService,
    private ragService: RagService,
    private prisma: PrismaService,
  ) {
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
      // Handle bot commands
      if (messageText.startsWith('/')) {
        await this.handleCommand(chatId, userName, messageText);
        return;
      }

      // Handle regular questions with RAG
      await this.handleQuestion(chatId, userName, messageText);
    } catch (error) {
      this.logger.error('Error handling message:', error.message);
      await this.sendErrorMessage(chatId);
    }
  }

  private async handleCommand(
    chatId: number,
    userName: string,
    command: string,
  ): Promise<void> {
    const [cmd, ...args] = command.split(' ');
    
    switch (cmd.toLowerCase()) {
      case '/start':
        await this.sendWelcomeMessage(chatId, userName);
        break;
      case '/help':
        await this.sendHelpMessage(chatId);
        break;
      case '/quick':
        if (args.length > 0) {
          const question = args.join(' ');
          await this.handleQuestion(chatId, userName, question, 'quick');
        } else {
          await this.sendMessage(chatId, '❓ Пожалуйста, задайте вопрос после команды /quick\n\nПример: /quick Что такое зона 2?');
        }
        break;
      case '/detailed':
        if (args.length > 0) {
          const question = args.join(' ');
          await this.handleQuestion(chatId, userName, question, 'detailed');
        } else {
          await this.sendMessage(chatId, '❓ Пожалуйста, задайте вопрос после команды /detailed\n\nПример: /detailed Как тренировать зону 2?');
        }
        break;
      case '/stats':
        await this.sendUserStats(chatId);
        break;
      default:
        await this.sendMessage(chatId, '❓ Неизвестная команда. Используйте /help для списка команд.');
    }
  }

  private async handleQuestion(
    chatId: number,
    userName: string,
    question: string,
    mode: 'quick' | 'detailed' | 'auto' = 'auto',
  ): Promise<void> {
    // Show typing indicator
    await this.bot.sendChatAction(chatId, 'typing');

    const userId = `tg_${chatId}`;
    
    try {
      // Determine response mode
      let responseMode: ResponseMode;
      let maxContextChunks: number;
      let similarityThreshold: number;

      if (mode === 'quick') {
        responseMode = ResponseMode.CONCISE;
        maxContextChunks = 3;
        similarityThreshold = 0.3;
      } else if (mode === 'detailed') {
        responseMode = ResponseMode.DETAILED;
        maxContextChunks = 8;
        similarityThreshold = 0.2;
      } else {
        // Auto mode - determine based on question length
        if (question.length < 50) {
          responseMode = ResponseMode.CONCISE;
          maxContextChunks = 3;
          similarityThreshold = 0.3;
        } else {
          responseMode = ResponseMode.DETAILED;
          maxContextChunks = 5;
          similarityThreshold = 0.25;
        }
      }

      // Generate RAG response
      const ragResponse = await this.ragService.generateAnswer({
        question,
        responseMode,
        maxContextChunks,
        similarityThreshold,
        language: 'auto' as any,
        includeSources: true,
        userId,
      });

      // Format and send response
      await this.sendRagResponse(chatId, ragResponse, mode);

      // Log user interaction
      await this.logUserInteraction(userId, userName, question, ragResponse);

    } catch (error) {
      this.logger.error(`RAG generation failed for user ${userName}:`, error.message);
      await this.sendErrorMessage(chatId);
    }
  }

  private async sendRagResponse(
    chatId: number,
    ragResponse: any,
    mode: string,
  ): Promise<void> {
    let message = ragResponse.answer;

    // Add confidence indicator
    const confidenceEmoji = this.getConfidenceEmoji(ragResponse.confidence);
    
    // Add sources if available
    if (ragResponse.sources && ragResponse.sources.length > 0) {
      message += '\n\n📚 **Источники:**\n';
      ragResponse.sources.slice(0, 3).forEach((source: string, index: number) => {
        const shortName = source.replace('.pdf', '').replace(/^#/, '').substring(0, 60);
        message += `${index + 1}. ${shortName}...\n`;
      });
    }

    // Add metadata
    message += `\n\n${confidenceEmoji} Уверенность: ${Math.round(ragResponse.confidence * 100)}%`;
    message += ` | ⏱️ ${Math.round(ragResponse.totalTime / 1000)}с`;
    
    if (mode !== 'auto') {
      message += ` | 🎯 ${mode === 'quick' ? 'Быстро' : 'Подробно'}`;
    }

    await this.sendMessage(chatId, message);
  }

  private getConfidenceEmoji(confidence: number): string {
    if (confidence >= 0.8) return '🟢';
    if (confidence >= 0.6) return '🟡';
    return '🔴';
  }

  private async sendWelcomeMessage(chatId: number, userName: string): Promise<void> {
    const welcomeMessage = `
🎉 **Добро пожаловать, ${userName}!**

Я - AI ассистент по здоровью и долголетию, основанный на исследованиях **Питера Аттиа**.

**Что я умею:**
• Отвечаю на вопросы о здоровье, питании, тренировках
• Объясняю концепции долголетия и биохакинга
• Привожу научно обоснованную информацию

**Как пользоваться:**
• Просто задайте вопрос (например: "Что такое зона 2?")
• /quick [вопрос] - краткий ответ
• /detailed [вопрос] - подробный ответ
• /help - список всех команд

Задайте мне любой вопрос! 🚀
`;

    await this.sendMessage(chatId, welcomeMessage);
  }

  private async sendHelpMessage(chatId: number): Promise<void> {
    const helpMessage = `
📖 **Справка по командам:**

**Основные команды:**
• /start - приветствие и инструкции
• /help - эта справка

**Режимы ответов:**
• /quick [вопрос] - быстрый ответ (2-3 предложения)
• /detailed [вопрос] - подробный ответ с объяснениями

**Информация:**
• /stats - ваша статистика использования

**Примеры вопросов:**
• "Что такое зона 2 тренировок?"
• "Как улучшить сон?"
• "Какие добавки рекомендует Питер Аттиа?"
• "Как правильно голодать?"

**Совет:** Можете просто написать вопрос без команды - я автоматически выберу оптимальный режим ответа! 😊
`;

    await this.sendMessage(chatId, helpMessage);
  }

  private async sendUserStats(chatId: number): Promise<void> {
    const userId = `tg_${chatId}`;
    
    try {
      const stats = await this.prisma.searchLog.aggregate({
        where: { userId },
        _count: { id: true },
        _avg: { responseTime: true },
      });

      const recentQueries = await this.prisma.searchLog.findMany({
        where: { userId },
        select: { query: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      let statsMessage = `📊 **Ваша статистика:**\n\n`;
      statsMessage += `• Всего вопросов: ${stats._count.id}\n`;
      statsMessage += `• Среднее время ответа: ${Math.round((stats._avg.responseTime || 0) / 1000)}с\n\n`;

      if (recentQueries.length > 0) {
        statsMessage += `📝 **Последние вопросы:**\n`;
        recentQueries.forEach((query, index) => {
          const shortQuery = query.query.length > 40 
            ? query.query.substring(0, 40) + '...' 
            : query.query;
          statsMessage += `${index + 1}. ${shortQuery}\n`;
        });
      }

      await this.sendMessage(chatId, statsMessage);
    } catch (error) {
      this.logger.error('Error getting user stats:', error.message);
      await this.sendMessage(chatId, '❌ Не удалось получить статистику');
    }
  }

  private async sendErrorMessage(chatId: number): Promise<void> {
    const errorMessages = [
      '❌ Извините, произошла ошибка. Попробуйте еще раз.',
      '🔧 Что-то пошло не так. Пожалуйста, повторите запрос.',
      '⚠️ Технические неполадки. Попробуйте задать вопрос позже.',
    ];
    
    const randomMessage = errorMessages[Math.floor(Math.random() * errorMessages.length)];
    await this.sendMessage(chatId, randomMessage);
  }

  private async logUserInteraction(
    userId: string,
    userName: string,
    question: string,
    ragResponse: any,
  ): Promise<void> {
    try {
      // This could be extended to log to a separate user interactions table
      this.logger.log(
        `User ${userName} (${userId}) asked: "${question}" - Confidence: ${ragResponse.confidence.toFixed(2)}, Time: ${ragResponse.totalTime}ms`
      );
    } catch (error) {
      this.logger.warn('Failed to log user interaction:', error.message);
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
