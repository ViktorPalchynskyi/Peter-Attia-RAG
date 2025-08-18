import { IsString, IsOptional, IsInt, IsEnum, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ResponseMode {
  CONCISE = 'concise',
  DETAILED = 'detailed',
  BULLET_POINTS = 'bullet_points',
  ACADEMIC = 'academic',
}

export enum ResponseLanguage {
  ENGLISH = 'en',
  RUSSIAN = 'ru',
  AUTO = 'auto',
}

export class RagQueryDto {
  @ApiProperty({
    description: 'User question or query',
    example: 'What are the benefits of zone 2 training for longevity?',
  })
  @IsString()
  question: string;

  @ApiPropertyOptional({
    description: 'Maximum number of context chunks to retrieve',
    example: 5,
    minimum: 1,
    maximum: 20,
    default: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxContextChunks?: number = 5;

  @ApiPropertyOptional({
    description: 'Minimum similarity threshold for context chunks',
    example: 0.3,
    minimum: 0.0,
    maximum: 1.0,
    default: 0.3,
  })
  @IsOptional()
  @Min(0.0)
  @Max(1.0)
  similarityThreshold?: number = 0.3;

  @ApiPropertyOptional({
    description: 'Response style and format',
    enum: ResponseMode,
    default: ResponseMode.DETAILED,
  })
  @IsOptional()
  @IsEnum(ResponseMode)
  responseMode?: ResponseMode = ResponseMode.DETAILED;

  @ApiPropertyOptional({
    description: 'Response language',
    enum: ResponseLanguage,
    default: ResponseLanguage.AUTO,
  })
  @IsOptional()
  @IsEnum(ResponseLanguage)
  language?: ResponseLanguage = ResponseLanguage.AUTO;

  @ApiPropertyOptional({
    description: 'Include source citations in response',
    example: true,
    default: true,
  })
  @IsOptional()
  includeSources?: boolean = true;

  @ApiPropertyOptional({
    description: 'User ID for personalization and logging',
    example: 'user_123',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}

export class ContextChunk {
  @ApiProperty({
    description: 'Chunk content',
    example: 'Zone 2 training is a form of cardio exercise...',
  })
  content: string;

  @ApiProperty({
    description: 'Similarity score to query',
    example: 0.85,
  })
  similarity: number;

  @ApiProperty({
    description: 'Source document filename',
    example: '#250 ‒ Training principles for longevity.pdf',
  })
  documentFilename: string;

  @ApiProperty({
    description: 'Chunk index within document',
    example: 15,
  })
  chunkIndex: number;

  @ApiProperty({
    description: 'Document ID',
    example: 'doc_123',
  })
  documentId: string;

  @ApiProperty({
    description: 'Chunk ID',
    example: 'chunk_456',
  })
  chunkId: string;
}

export class RagResponseDto {
  @ApiProperty({
    description: 'Generated answer to the user question',
    example: 'Zone 2 training offers several key benefits for longevity: improved mitochondrial function, enhanced fat oxidation, and better cardiovascular health...',
  })
  answer: string;

  @ApiProperty({
    description: 'Original user question',
    example: 'What are the benefits of zone 2 training for longevity?',
  })
  question: string;

  @ApiProperty({
    description: 'Context chunks used to generate the answer',
    type: [ContextChunk],
  })
  context: ContextChunk[];

  @ApiProperty({
    description: 'Number of context chunks found',
    example: 5,
  })
  contextCount: number;

  @ApiProperty({
    description: 'Time taken to search for context (ms)',
    example: 150,
  })
  searchTime: number;

  @ApiProperty({
    description: 'Time taken to generate response (ms)',
    example: 2500,
  })
  generationTime: number;

  @ApiProperty({
    description: 'Total processing time (ms)',
    example: 2650,
  })
  totalTime: number;

  @ApiProperty({
    description: 'Confidence score of the answer (0-1)',
    example: 0.92,
  })
  confidence: number;

  @ApiProperty({
    description: 'List of source documents referenced',
    example: ['#250 ‒ Training principles for longevity.pdf', 'Zone 2 training guide.pdf'],
  })
  sources: string[];

  @ApiProperty({
    description: 'Response mode used',
    enum: ResponseMode,
  })
  responseMode: ResponseMode;

  @ApiProperty({
    description: 'Language of the response',
    enum: ResponseLanguage,
  })
  language: ResponseLanguage;

  @ApiProperty({
    description: 'Timestamp of the response',
    example: '2025-08-18T12:00:00Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Unique response ID for tracking',
    example: 'resp_abc123',
  })
  responseId: string;
}

export class RagAnalyticsDto {
  @ApiProperty({
    description: 'Total number of RAG queries processed',
    example: 1250,
  })
  totalQueries: number;

  @ApiProperty({
    description: 'Average response time in milliseconds',
    example: 2800,
  })
  averageResponseTime: number;

  @ApiProperty({
    description: 'Average confidence score',
    example: 0.87,
  })
  averageConfidence: number;

  @ApiProperty({
    description: 'Most popular response modes',
    example: [
      { mode: 'detailed', count: 850 },
      { mode: 'concise', count: 300 },
      { mode: 'bullet_points', count: 100 }
    ],
  })
  responseModeStats: Array<{ mode: string; count: number }>;

  @ApiProperty({
    description: 'Most frequently referenced documents',
    example: [
      { filename: '#250 ‒ Training principles for longevity.pdf', count: 45 },
      { filename: 'Zone 2 training guide.pdf', count: 32 }
    ],
  })
  topDocuments: Array<{ filename: string; count: number }>;

  @ApiProperty({
    description: 'Recent query topics',
    example: ['zone 2 training', 'longevity interventions', 'protein intake'],
  })
  recentTopics: string[];
}
