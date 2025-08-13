import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: ['error', 'warn', 'info'],
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Connected to PostgreSQL database');

      // Test pgvector extension
      await this.testPgVector();
    } catch (error) {
      this.logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Disconnected from database');
  }

  private async testPgVector() {
    try {
      const result = await this.$queryRaw`
        SELECT extname, extversion 
        FROM pg_extension 
        WHERE extname = 'vector'
      `;

      if (Array.isArray(result) && result.length > 0) {
        this.logger.log(
          `pgvector extension loaded: version ${(result[0] as any).extversion}`,
        );
      } else {
        this.logger.warn('pgvector extension not found');
      }
    } catch (error) {
      this.logger.error('Error checking pgvector extension:', error.message);
    }
  }

  // Helper method for vector similarity search
  async vectorSimilaritySearch(
    queryEmbedding: number[],
    limit: number = 10,
    threshold: number = 0.5,
  ) {
    const vectorString = `[${queryEmbedding.join(',')}]`;

    return this.$queryRaw`
      SELECT 
        dc.id,
        dc.content,
        dc.document_id,
        d.filename,
        d.file_type,
        (dc.embedding <=> ${vectorString}::vector) as distance
      FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      WHERE dc.embedding IS NOT NULL
        AND (dc.embedding <=> ${vectorString}::vector) < ${threshold}
      ORDER BY dc.embedding <=> ${vectorString}::vector
      LIMIT ${limit}
    `;
  }

  // Helper method to insert embeddings
  async insertChunkWithEmbedding(
    documentId: string,
    content: string,
    chunkIndex: number,
    embedding: number[],
    startPosition: number = 0,
    endPosition: number = 0,
  ) {
    const vectorString = `[${embedding.join(',')}]`;

    return this.$queryRaw`
      INSERT INTO document_chunks (
        id, document_id, content, chunk_index, start_position, end_position, embedding, created_at, updated_at
      ) VALUES (
        gen_random_uuid()::text, 
        ${documentId}, 
        ${content}, 
        ${chunkIndex}, 
        ${startPosition}, 
        ${endPosition}, 
        ${vectorString}::vector,
        NOW(),
        NOW()
      )
    `;
  }
}
