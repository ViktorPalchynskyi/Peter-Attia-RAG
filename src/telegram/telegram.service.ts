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
    
    // Determine user language based on location
    const isRussian = await this.isRussianSpeakingUser(chatId);
    
    switch (cmd.toLowerCase()) {
      case '/start':
        await this.sendWelcomeMessage(chatId, userName, isRussian);
        break;
      case '/help':
        await this.sendHelpMessage(chatId, isRussian);
        break;
      case '/quick':
        if (args.length > 0) {
          const question = args.join(' ');
          await this.handleQuestion(chatId, userName, question, 'quick');
        } else {
          const msg = isRussian 
            ? '❓ Пожалуйста, задайте вопрос после команды /quick\n\nПример: /quick Что такое зона 2?'
            : '❓ Please ask a question after the /quick command\n\nExample: /quick What is zone 2?';
          await this.sendMessage(chatId, msg);
        }
        break;
      case '/detailed':
        if (args.length > 0) {
          const question = args.join(' ');
          await this.handleQuestion(chatId, userName, question, 'detailed');
        } else {
          const msg = isRussian 
            ? '❓ Пожалуйста, задайте вопрос после команды /detailed\n\nПример: /detailed Как тренировать зону 2?'
            : '❓ Please ask a question after the /detailed command\n\nExample: /detailed How to train zone 2?';
          await this.sendMessage(chatId, msg);
        }
        break;
      case '/stats':
        await this.sendUserStats(chatId, isRussian);
        break;
      default:
        const unknownMsg = isRussian 
          ? '❓ Неизвестная команда. Используйте /help для списка команд.'
          : '❓ Unknown command. Use /help for the list of commands.';
        await this.sendMessage(chatId, unknownMsg);
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

    // Detect language for interface elements
    const isRussian = this.detectRussianLanguage(ragResponse.question || '');
    
    // Add confidence indicator
    const confidenceEmoji = this.getConfidenceEmoji(ragResponse.confidence);
    
    // Add quotes section if available
    if (ragResponse.context && ragResponse.context.length > 0) {
      const quotesLabel = isRussian ? '💬 *Цитаты:*' : '💬 *Quotes:*';
      message += `\n\n${quotesLabel}\n`;
      
      // Extract up to 3 meaningful quotes from context
      const quotes = this.extractQuotes(ragResponse.context, ragResponse.question);
      quotes.slice(0, 3).forEach((quote, index) => {
        message += `${index + 1}. "${quote}"\n`;
      });
    }

    // Add sources if available
    if (ragResponse.sources && ragResponse.sources.length > 0) {
      const sourcesLabel = isRussian ? '📚 *Источники:*' : '📚 *Sources:*';
      message += `\n${sourcesLabel}\n`;
      ragResponse.sources.slice(0, 3).forEach((source: string, index: number) => {
        const enhancedSource = this.enhanceSourceReference(source);
        message += `${index + 1}. ${enhancedSource}\n`;
      });
    }

    // Add metadata with language-appropriate labels
    const confidenceLabel = isRussian ? 'Уверенность' : 'Confidence';
    const timeUnit = isRussian ? 'с' : 's';
    
    message += `\n\n${confidenceEmoji} ${confidenceLabel}: ${Math.round(ragResponse.confidence * 100)}%`;
    message += ` | ⏱️ ${Math.round(ragResponse.totalTime / 1000)}${timeUnit}`;
    
    if (mode !== 'auto') {
      const modeLabel = isRussian 
        ? (mode === 'quick' ? 'Быстро' : 'Подробно')
        : (mode === 'quick' ? 'Quick' : 'Detailed');
      message += ` | 🎯 ${modeLabel}`;
    }

    await this.sendMessage(chatId, message);
  }

  /**
   * Detect if text is primarily in Russian
   */
  private detectRussianLanguage(text: string): boolean {
    const cyrillicPattern = /[\u0400-\u04FF]/g;
    const cyrillicMatches = text.match(cyrillicPattern);
    const cyrillicRatio = cyrillicMatches ? cyrillicMatches.length / text.length : 0;
    return cyrillicRatio > 0.3; // If more than 30% Cyrillic characters, assume Russian
  }

  /**
   * Determine if user is from Russian-speaking region
   */
  private async isRussianSpeakingUser(chatId: number): Promise<boolean> {
    try {
      // Try to get user info from Telegram API
      const chatInfo = await this.bot.getChat(chatId);
      
      // Check if user has language code set
      if (chatInfo.language_code) {
        const russianLanguages = ['ru', 'uk', 'be', 'kk'];
        return russianLanguages.includes(chatInfo.language_code.toLowerCase());
      }
      
      // If no language code, assume Russian for safety (most of our users seem to be Russian-speaking)
      return true;
    } catch (error) {
      this.logger.debug(`Could not get chat info for ${chatId}, assuming Russian`);
      // Default to Russian if we can't determine
      return true;
    }
  }

  /**
   * Extract meaningful quotes from context chunks
   */
  private extractQuotes(context: any[], question: string): string[] {
    const quotes: string[] = [];
    const questionKeywords = question.toLowerCase().split(' ').filter(word => word.length > 3);
    
    for (const chunk of context) {
      if (quotes.length >= 3) break;
      
      const content = chunk.content || '';
      const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
      
      for (const sentence of sentences) {
        if (quotes.length >= 3) break;
        
        const lowerSentence = sentence.toLowerCase();
        
        // Check if sentence contains question keywords and looks like a quote
        const relevantKeywords = questionKeywords.filter(keyword => 
          lowerSentence.includes(keyword)
        );
        
        if (relevantKeywords.length > 0 && sentence.trim().length <= 150) {
          const cleanSentence = sentence.trim()
            .replace(/^\s*[-•]\s*/, '') // Remove bullet points
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/^[^A-Za-zА-Яа-я]*/, ''); // Remove leading non-letters
          
          if (cleanSentence.length > 30 && cleanSentence.length <= 150) {
            quotes.push(cleanSentence);
          }
        }
      }
    }
    
    // If no specific quotes found, take first meaningful sentences
    if (quotes.length === 0 && context.length > 0) {
      const firstChunk = context[0].content || '';
      const sentences = firstChunk.split(/[.!?]+/).filter(s => s.trim().length > 30);
      
      for (const sentence of sentences.slice(0, 2)) {
        const cleanSentence = sentence.trim().replace(/\s+/g, ' ');
        if (cleanSentence.length <= 150) {
          quotes.push(cleanSentence);
        }
      }
    }
    
    return quotes;
  }

  /**
   * Enhance source reference with better formatting and potential links
   */
  private enhanceSourceReference(source: string): string {
    // Remove .pdf extension and clean up
    let cleanSource = source.replace('.pdf', '');
    
    // Extract episode number if present (e.g., #306, #291-309)
    const episodeMatch = cleanSource.match(/^#?(\d+(?:-\d+)?)/);
    
    if (episodeMatch) {
      const episodeNumber = episodeMatch[1];
      // Truncate long titles
      const title = cleanSource.substring(episodeMatch[0].length).trim();
      const shortTitle = title.length > 50 ? title.substring(0, 50) + '...' : title;
      
      // Format as episode reference
      return `Episode #${episodeNumber}${shortTitle ? ': ' + shortTitle : ''}`;
    }
    
    // For non-episode content, just clean and truncate
    const shortName = cleanSource.length > 60 ? cleanSource.substring(0, 60) + '...' : cleanSource;
    return shortName;
  }

  private getConfidenceEmoji(confidence: number): string {
    if (confidence >= 0.8) return '🟢';
    if (confidence >= 0.6) return '🟡';
    return '🔴';
  }

  /**
   * Convert Markdown formatting to HTML for more reliable Telegram parsing
   */
  private convertToHtml(text: string): string {
    // Don't escape HTML characters if the text already contains HTML tags
    if (text.includes('<b>') || text.includes('<i>')) {
      // Text already contains HTML, just convert any remaining Markdown
      return text
        .replace(/\*([^*]+?)\*/g, '<i>$1</i>')
        .replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>');
    }

    // Escape HTML special characters first for regular text
    let htmlText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Convert our Markdown formatting to HTML
    htmlText = htmlText
      // Convert *italic* to <i>italic</i>
      .replace(/\*([^*]+?)\*/g, '<i>$1</i>')
      // Convert **bold** to <b>bold</b> (if any remain)
      .replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>');

    return htmlText;
  }

  private async sendWelcomeMessage(chatId: number, userName: string, isRussian: boolean = true): Promise<void> {
    const welcomeMessage = isRussian ? `
🎉 <b>Добро пожаловать, ${userName}!</b>

Я - AI ассистент по здоровью и долголетию, основанный на исследованиях <b>Питера Аттиа</b>.

<b>Что я умею:</b>
• Отвечаю на вопросы о здоровье, питании, тренировках
• Объясняю концепции долголетия и биохакинга
• Привожу научно обоснованную информацию

<b>Как пользоваться:</b>
• Просто задайте вопрос (например: "Что такое зона 2?")
• /quick [вопрос] - краткий ответ
• /detailed [вопрос] - подробный ответ
• /help - список всех команд

Задайте мне любой вопрос! 🚀
` : `
🎉 <b>Welcome, ${userName}!</b>

I'm an AI health and longevity assistant based on <b>Peter Attia's</b> research.

<b>What I can do:</b>
• Answer questions about health, nutrition, and exercise
• Explain longevity and biohacking concepts
• Provide scientifically-backed information

<b>How to use:</b>
• Simply ask a question (e.g., "What is zone 2 training?")
• /quick [question] - brief answer
• /detailed [question] - comprehensive answer
• /help - list of all commands

Ask me anything! 🚀
`;

    await this.sendMessage(chatId, welcomeMessage);
  }

  private async sendHelpMessage(chatId: number, isRussian: boolean = true): Promise<void> {
    const helpMessage = isRussian ? `
📖 <b>Справка по командам:</b>

<b>Основные команды:</b>
• /start - приветствие и инструкции
• /help - эта справка

<b>Режимы ответов:</b>
• /quick [вопрос] - быстрый ответ (2-3 предложения)
• /detailed [вопрос] - подробный ответ с объяснениями

<b>Информация:</b>
• /stats - ваша статистика использования

<b>Примеры вопросов:</b>
• "Что такое зона 2 тренировок?"
• "Как улучшить сон?"
• "Какие добавки рекомендует Питер Аттиа?"
• "Как правильно голодать?"

<b>Совет:</b> Можете просто написать вопрос без команды - я автоматически выберу оптимальный режим ответа! 😊
` : `
📖 <b>Command Reference:</b>

<b>Basic commands:</b>
• /start - welcome and instructions
• /help - this help

<b>Response modes:</b>
• /quick [question] - quick answer (2-3 sentences)
• /detailed [question] - detailed answer with explanations

<b>Information:</b>
• /stats - your usage statistics

<b>Example questions:</b>
• "What is zone 2 training?"
• "How to improve sleep?"
• "What supplements does Peter Attia recommend?"
• "How to fast properly?"

<b>Tip:</b> You can simply write a question without a command - I'll automatically choose the optimal response mode! 😊
`;

    await this.sendMessage(chatId, helpMessage);
  }

  private async sendUserStats(chatId: number, isRussian: boolean = true): Promise<void> {
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

      let statsMessage = isRussian 
        ? `📊 <b>Ваша статистика:</b>\n\n`
        : `📊 <b>Your Statistics:</b>\n\n`;
      
      const questionsLabel = isRussian ? 'Всего вопросов' : 'Total questions';
      const timeLabel = isRussian ? 'Среднее время ответа' : 'Average response time';
      const timeUnit = isRussian ? 'с' : 's';
      
      statsMessage += `• ${questionsLabel}: ${stats._count.id}\n`;
      statsMessage += `• ${timeLabel}: ${Math.round((stats._avg.responseTime || 0) / 1000)}${timeUnit}\n\n`;

      if (recentQueries.length > 0) {
        const recentLabel = isRussian ? 'Последние вопросы' : 'Recent questions';
        statsMessage += `📝 <b>${recentLabel}:</b>\n`;
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
      const errorMsg = isRussian 
        ? '❌ Не удалось получить статистику' 
        : '❌ Could not retrieve statistics';
      await this.sendMessage(chatId, errorMsg);
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
      // Convert Markdown formatting to HTML for more reliable parsing
      const htmlText = this.convertToHtml(text);
      
      // Send message with HTML formatting enabled
      await this.bot.sendMessage(chatId, htmlText, { 
        parse_mode: 'HTML',
        disable_web_page_preview: true 
      });
      this.logger.debug(`Message sent to chat ${chatId}: ${htmlText.substring(0, 100)}...`);
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
