import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SearchService } from './search.service';
import { EmbeddingService } from './embedding.service';
import { 
  RagQueryDto, 
  RagResponseDto, 
  ContextChunk, 
  ResponseMode, 
  ResponseLanguage,
  RagAnalyticsDto 
} from '../dto/rag.dto';
import OpenAI from 'openai';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private openai: OpenAI;

  constructor(
    private prisma: PrismaService,
    private searchService: SearchService,
    private embeddingService: EmbeddingService,
  ) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.openai = new OpenAI({
      apiKey: apiKey,
    });
  }

  /**
   * Generate a comprehensive answer using RAG pipeline
   */
  async generateAnswer(query: RagQueryDto): Promise<RagResponseDto> {
    const startTime = Date.now();
    const responseId = this.generateResponseId();
    
    try {
      this.logger.log(`RAG query: "${query.question}" (${responseId})`);

      // Step 1: Search for relevant context
      const searchStartTime = Date.now();
      const searchResults = await this.searchService.searchDocuments({
        query: query.question,
        limit: query.maxContextChunks || 5,
        threshold: query.similarityThreshold || 0.3,
      });
      const searchTime = Date.now() - searchStartTime;

      if (searchResults.results.length === 0) {
        return this.createNoContextResponse(query, responseId, searchTime);
      }

      // Step 2: Prepare context chunks
      const context: ContextChunk[] = searchResults.results.map(result => ({
        content: result.content,
        similarity: result.similarity,
        documentFilename: result.documentFilename,
        chunkIndex: result.chunkIndex,
        documentId: result.documentId,
        chunkId: result.chunkId,
      }));

      // Step 3: Generate response using LLM
      const generationStartTime = Date.now();
      const answer = await this.generateLLMResponse(query, context);
      const generationTime = Date.now() - generationStartTime;

      // Step 4: Calculate confidence and extract sources
      const confidence = this.calculateConfidence(searchResults.results);
      const sources = this.extractUniqueSources(context);

      const totalTime = Date.now() - startTime;

      const response: RagResponseDto = {
        answer,
        question: query.question,
        context,
        contextCount: context.length,
        searchTime,
        generationTime,
        totalTime,
        confidence,
        sources,
        responseMode: query.responseMode || ResponseMode.DETAILED,
        language: query.language || ResponseLanguage.AUTO,
        timestamp: new Date().toISOString(),
        responseId,
      };

      // Step 5: Log the interaction
      await this.logRagInteraction(query, response);

      this.logger.log(
        `RAG response generated (${responseId}): ${totalTime}ms total, confidence: ${confidence.toFixed(2)}`
      );

      return response;
    } catch (error: any) {
      this.logger.error(`RAG generation failed (${responseId}): ${error.message}`);
      throw new Error(`Answer generation failed: ${error.message}`);
    }
  }

  /**
   * Generate LLM response using OpenAI
   */
  private async generateLLMResponse(query: RagQueryDto, context: ContextChunk[]): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(query.responseMode, query.language);
    const userPrompt = this.buildUserPrompt(query.question, context);

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1, // Low temperature for consistent, factual responses
      max_tokens: this.getMaxTokensForMode(query.responseMode),
    });

    if (!response.choices || response.choices.length === 0) {
      throw new Error('No response generated from OpenAI');
    }

    return response.choices[0].message?.content || 'Unable to generate response';
  }

  /**
   * Build system prompt based on response mode and language
   */
  private buildSystemPrompt(mode?: ResponseMode, language?: ResponseLanguage): string {
    let basePrompt = `You are a knowledgeable health and longevity expert assistant based on Peter Attia's research and content. Your role is to provide accurate, evidence-based answers using only the provided context.

CRITICAL INSTRUCTIONS:
- Use ONLY the information provided in the context chunks
- If the context doesn't contain enough information to answer the question, say so clearly
- Always cite specific sources when making claims
- Be precise and avoid speculation
- Maintain scientific accuracy and nuance`;

    // Add response mode specific instructions
    switch (mode) {
      case ResponseMode.CONCISE:
        basePrompt += `\n- Provide concise, direct answers (2-3 sentences maximum)
- Focus on the most important points only`;
        break;
      case ResponseMode.DETAILED:
        basePrompt += `\n- Provide comprehensive, detailed explanations
- Include relevant background information and context
- Explain mechanisms and reasoning when available`;
        break;
      case ResponseMode.BULLET_POINTS:
        basePrompt += `\n- Format your response as clear bullet points
- Each point should be concise but informative
- Use bullet points for main ideas and sub-points for details`;
        break;
      case ResponseMode.ACADEMIC:
        basePrompt += `\n- Use academic tone and precise terminology
- Include specific references to studies or data when mentioned
- Maintain formal, scholarly language`;
        break;
    }

    // Add language instructions
    if (language === ResponseLanguage.RUSSIAN) {
      basePrompt += `\n- Respond in Russian language
- Use appropriate medical and scientific terminology in Russian`;
    } else if (language === ResponseLanguage.ENGLISH) {
      basePrompt += `\n- Respond in English language`;
    } else {
      basePrompt += `\n- Detect the language of the question and respond in the same language`;
    }

    return basePrompt;
  }

  /**
   * Build user prompt with question and context
   */
  private buildUserPrompt(question: string, context: ContextChunk[]): string {
    let prompt = `Question: ${question}\n\nContext from Peter Attia's content:\n\n`;

    context.forEach((chunk, index) => {
      prompt += `[Source ${index + 1}: ${chunk.documentFilename}]\n`;
      prompt += `${chunk.content}\n\n`;
    });

    prompt += `Based on the above context, please provide a comprehensive answer to the question. Remember to:
- Use only the information provided in the context
- Cite sources when making specific claims
- Be clear if the context doesn't provide sufficient information for certain aspects of the question`;

    return prompt;
  }

  /**
   * Get max tokens based on response mode
   */
  private getMaxTokensForMode(mode?: ResponseMode): number {
    switch (mode) {
      case ResponseMode.CONCISE:
        return 200;
      case ResponseMode.DETAILED:
        return 1000;
      case ResponseMode.BULLET_POINTS:
        return 600;
      case ResponseMode.ACADEMIC:
        return 800;
      default:
        return 800;
    }
  }

  /**
   * Calculate confidence score based on search results
   */
  private calculateConfidence(searchResults: any[]): number {
    if (searchResults.length === 0) return 0;

    const avgSimilarity = searchResults.reduce((sum, result) => sum + result.similarity, 0) / searchResults.length;
    const resultCount = Math.min(searchResults.length, 5);
    const countBonus = resultCount / 5 * 0.2; // Up to 20% bonus for having multiple results

    return Math.min(avgSimilarity + countBonus, 1.0);
  }

  /**
   * Extract unique source document names
   */
  private extractUniqueSources(context: ContextChunk[]): string[] {
    const uniqueSources = new Set(context.map(chunk => chunk.documentFilename));
    return Array.from(uniqueSources);
  }

  /**
   * Create response when no context is found
   */
  private createNoContextResponse(
    query: RagQueryDto, 
    responseId: string, 
    searchTime: number
  ): RagResponseDto {
    const answer = query.language === ResponseLanguage.RUSSIAN 
      ? "Извините, я не смог найти релевантную информацию в базе знаний Питера Аттиа для ответа на ваш вопрос. Попробуйте переформулировать вопрос или задать более конкретный вопрос о здоровье, долголетии, питании или тренировках."
      : "I'm sorry, I couldn't find relevant information in Peter Attia's knowledge base to answer your question. Please try rephrasing your question or ask something more specific about health, longevity, nutrition, or exercise.";

    return {
      answer,
      question: query.question,
      context: [],
      contextCount: 0,
      searchTime,
      generationTime: 0,
      totalTime: searchTime,
      confidence: 0,
      sources: [],
      responseMode: query.responseMode || ResponseMode.DETAILED,
      language: query.language || ResponseLanguage.AUTO,
      timestamp: new Date().toISOString(),
      responseId,
    };
  }

  /**
   * Generate unique response ID
   */
  private generateResponseId(): string {
    return `rag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log RAG interaction for analytics
   */
  private async logRagInteraction(query: RagQueryDto, response: RagResponseDto): Promise<void> {
    try {
      await this.prisma.searchLog.create({
        data: {
          query: query.question,
          userId: query.userId,
          results: {
            responseId: response.responseId,
            contextCount: response.contextCount,
            confidence: response.confidence,
            sources: response.sources,
            responseMode: response.responseMode,
            language: response.language,
          },
          responseTime: response.totalTime,
          createdAt: new Date(),
        },
      });
    } catch (error: any) {
      this.logger.warn(`Failed to log RAG interaction: ${error.message}`);
    }
  }

  /**
   * Get RAG analytics
   */
  async getRagAnalytics(): Promise<RagAnalyticsDto> {
    try {
      const [totalQueries, avgStats, responseModeStats, topDocuments] = await Promise.all([
        this.prisma.searchLog.count(),
        this.prisma.searchLog.aggregate({
          _avg: {
            responseTime: true,
          },
        }),
        this.prisma.$queryRaw`
          SELECT 
            results->>'responseMode' as mode,
            COUNT(*) as count
          FROM search_logs 
          WHERE results->>'responseMode' IS NOT NULL
          GROUP BY results->>'responseMode'
          ORDER BY count DESC
          LIMIT 5
        ` as unknown as Array<{ mode: string; count: bigint }>,
        this.prisma.$queryRaw`
          SELECT 
            jsonb_array_elements_text(results->'sources') as filename,
            COUNT(*) as count
          FROM search_logs 
          WHERE results->'sources' IS NOT NULL
          GROUP BY filename
          ORDER BY count DESC
          LIMIT 10
        ` as unknown as Array<{ filename: string; count: bigint }>,
      ]);

      const recentQueries = await this.prisma.searchLog.findMany({
        select: { query: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      return {
        totalQueries,
        averageResponseTime: Math.round(avgStats._avg.responseTime || 0),
        averageConfidence: 0.85, // Placeholder - would need to calculate from stored data
        responseModeStats: responseModeStats.map(stat => ({
          mode: stat.mode,
          count: Number(stat.count),
        })),
        topDocuments: topDocuments.map(doc => ({
          filename: doc.filename,
          count: Number(doc.count),
        })),
        recentTopics: recentQueries.map(q => q.query).slice(0, 10),
      };
    } catch (error: any) {
      this.logger.error(`Failed to get RAG analytics: ${error.message}`);
      throw new Error(`Analytics retrieval failed: ${error.message}`);
    }
  }
}
