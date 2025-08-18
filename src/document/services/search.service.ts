import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { SearchDocumentsDto, SearchResultDto, SearchResponseDto } from '../dto/search.dto';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
  ) {}

  /**
   * Perform semantic search across all document chunks
   */
  async searchDocuments(searchDto: SearchDocumentsDto): Promise<SearchResponseDto> {
    const startTime = Date.now();
    
    try {
      this.logger.debug(`Searching for: "${searchDto.query}"`);

      // Step 1: Generate embedding for the search query
      const queryEmbedding = await this.embeddingService.generateEmbedding(searchDto.query);

      // Step 2: Perform vector similarity search
      const searchResults = await this.prisma.vectorSimilaritySearch(
        queryEmbedding,
        searchDto.limit || 5,
        searchDto.threshold || 0.7,
      );

      // Step 3: Transform results to DTO format
      const results: SearchResultDto[] = searchResults.map(result => ({
        content: result.content,
        similarity: Number(result.similarity),
        documentFilename: result.filename,
        chunkIndex: Number(result.chunk_index),
        documentId: result.document_id,
        chunkId: result.id,
      }));

      const processingTime = Date.now() - startTime;

      this.logger.debug(
        `Found ${results.length} results in ${processingTime}ms for query: "${searchDto.query}"`,
      );

      // Step 4: Log search for analytics
      await this.logSearch(searchDto.query, results.length, processingTime);

      return {
        results,
        totalResults: results.length,
        processingTime,
        query: searchDto.query,
      };
    } catch (error: any) {
      this.logger.error(`Search failed for query "${searchDto.query}": ${error.message}`);
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  /**
   * Get similar chunks to a specific chunk (for "related content" features)
   */
  async findSimilarChunks(
    chunkId: string,
    limit: number = 5,
    threshold: number = 0.8,
  ): Promise<SearchResultDto[]> {
    try {
      // Get the embedding of the source chunk using raw query (embedding field is Unsupported type)
      const sourceChunk = await this.prisma.$queryRaw`
        SELECT embedding, content 
        FROM document_chunks 
        WHERE id = ${chunkId}
      ` as Array<{ embedding: string; content: string }>;

      if (!sourceChunk || sourceChunk.length === 0 || !sourceChunk[0].embedding) {
        throw new Error('Source chunk not found or has no embedding');
      }

      // Parse the embedding vector
      const embeddingString = sourceChunk[0].embedding;
      const embedding = JSON.parse(embeddingString);

      // Find similar chunks
      const searchResults = await this.prisma.vectorSimilaritySearch(
        embedding,
        limit + 1, // +1 to exclude the source chunk itself
        threshold,
      );

      // Filter out the source chunk and transform results
      const results: SearchResultDto[] = searchResults
        .filter(result => result.id !== chunkId)
        .slice(0, limit)
        .map(result => ({
          content: result.content,
          similarity: Number(result.similarity),
          documentFilename: result.filename,
          chunkIndex: Number(result.chunk_index),
          documentId: result.document_id,
          chunkId: result.id,
        }));

      return results;
    } catch (error: any) {
      this.logger.error(`Failed to find similar chunks for ${chunkId}: ${error.message}`);
      throw new Error(`Similar chunks search failed: ${error.message}`);
    }
  }

  /**
   * Search within a specific document
   */
  async searchInDocument(
    documentId: string,
    query: string,
    limit: number = 10,
    threshold: number = 0.7,
  ): Promise<SearchResultDto[]> {
    try {
      // Generate embedding for the search query
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);

      // Search only within the specified document
      const results = await this.prisma.$queryRaw`
        SELECT 
          dc.id,
          dc.content,
          dc.document_id,
          dc.chunk_index,
          d.filename,
          d.file_type,
          (dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector) as distance,
          (1 - (dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector)) as similarity
        FROM document_chunks dc
        JOIN documents d ON dc.document_id = d.id
        WHERE dc.document_id = ${documentId}
          AND dc.embedding IS NOT NULL
          AND (dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector) <= ${1 - threshold}
        ORDER BY dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector
        LIMIT ${limit}
      ` as Array<{
        id: string;
        content: string;
        document_id: string;
        chunk_index: number;
        filename: string;
        file_type: string;
        distance: number;
        similarity: number;
      }>;

      return results.map(result => ({
        content: result.content,
        similarity: Number(result.similarity),
        documentFilename: result.filename,
        chunkIndex: Number(result.chunk_index),
        documentId: result.document_id,
        chunkId: result.id,
      }));
    } catch (error: any) {
      this.logger.error(`Document search failed: ${error.message}`);
      throw new Error(`Document search failed: ${error.message}`);
    }
  }

  /**
   * Log search queries for analytics
   */
  private async logSearch(query: string, resultsCount: number, processingTime: number): Promise<void> {
    try {
      await this.prisma.searchLog.create({
        data: {
          query,
          results: { count: resultsCount },
          responseTime: processingTime,
          createdAt: new Date(),
        },
      });
    } catch (error: any) {
      // Don't throw error for logging failures
      this.logger.warn(`Failed to log search: ${error.message}`);
    }
  }

  /**
   * Get search analytics
   */
  async getSearchAnalytics(): Promise<{
    totalSearches: number;
    averageProcessingTime: number;
    averageResultsCount: number;
    topQueries: Array<{ query: string; count: number }>;
  }> {
    try {
      const [stats, topQueries] = await Promise.all([
        this.prisma.searchLog.aggregate({
          _count: { id: true },
          _avg: {
            responseTime: true,
          },
        }),
        this.prisma.$queryRaw`
          SELECT query, COUNT(*) as count
          FROM search_logs
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY query
          ORDER BY count DESC
          LIMIT 10
        ` as unknown as Array<{ query: string; count: bigint }>,
      ]);

      return {
        totalSearches: stats._count.id,
        averageProcessingTime: Math.round(stats._avg.responseTime || 0),
        averageResultsCount: 0, // Не можем получить из текущей схемы
        topQueries: topQueries.map(item => ({
          query: item.query,
          count: Number(item.count),
        })),
      };
    } catch (error: any) {
      this.logger.error(`Failed to get search analytics: ${error.message}`);
      throw new Error(`Analytics retrieval failed: ${error.message}`);
    }
  }
}
