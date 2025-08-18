import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private openai: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.openai = new OpenAI({
      apiKey: apiKey,
    });
  }

  /**
   * Generate embeddings for a single text using OpenAI's text-embedding-3-small model
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      this.logger.debug(`Generating embedding for text (${text.length} chars)`);

      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float',
      });

      if (!response.data || response.data.length === 0) {
        throw new Error('No embedding data received from OpenAI');
      }

      const embedding = response.data[0].embedding;
      
      this.logger.debug(`Generated embedding with ${embedding.length} dimensions`);
      return embedding;
    } catch (error: any) {
      this.logger.error(`Failed to generate embedding: ${error.message}`);
      throw new Error(`Embedding generation failed: ${error.message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      this.logger.debug(`Generating embeddings for ${texts.length} texts`);

      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts,
        encoding_format: 'float',
      });

      if (!response.data || response.data.length !== texts.length) {
        throw new Error(`Expected ${texts.length} embeddings, got ${response.data?.length || 0}`);
      }

      const embeddings = response.data.map(item => item.embedding);
      
      this.logger.debug(`Generated ${embeddings.length} embeddings`);
      return embeddings;
    } catch (error: any) {
      this.logger.error(`Failed to generate embeddings: ${error.message}`);
      throw new Error(`Batch embedding generation failed: ${error.message}`);
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  calculateCosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Check if OpenAI API is accessible
   */
  async healthCheck(): Promise<{ status: string; model: string }> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'health check',
        encoding_format: 'float',
      });

      return {
        status: 'connected',
        model: 'text-embedding-3-small',
      };
    } catch (error: any) {
      this.logger.error(`OpenAI health check failed: ${error.message}`);
      throw new Error(`OpenAI API not accessible: ${error.message}`);
    }
  }
}
