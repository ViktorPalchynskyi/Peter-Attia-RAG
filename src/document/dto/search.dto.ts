import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchDocumentsDto {
  @ApiProperty({
    description: 'Search query text',
    example: 'What are the benefits of zone 2 training?',
  })
  @IsString()
  query: string;

  @ApiPropertyOptional({
    description: 'Maximum number of results to return',
    example: 5,
    minimum: 1,
    maximum: 20,
    default: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 5;

  @ApiPropertyOptional({
    description: 'Minimum similarity threshold (0.0 to 1.0)',
    example: 0.7,
    minimum: 0.0,
    maximum: 1.0,
    default: 0.7,
  })
  @IsOptional()
  @Min(0.0)
  @Max(1.0)
  threshold?: number = 0.7;
}

export class SearchResultDto {
  @ApiProperty({
    description: 'Document chunk content',
    example: 'Zone 2 training is a form of cardio exercise...',
  })
  content: string;

  @ApiProperty({
    description: 'Similarity score (0.0 to 1.0)',
    example: 0.85,
  })
  similarity: number;

  @ApiProperty({
    description: 'Source document filename',
    example: '#250 ‒ Training principles for longevity.pdf',
  })
  documentFilename: string;

  @ApiProperty({
    description: 'Chunk index within the document',
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

export class SearchResponseDto {
  @ApiProperty({
    description: 'Search results',
    type: [SearchResultDto],
  })
  results: SearchResultDto[];

  @ApiProperty({
    description: 'Total number of results found',
    example: 5,
  })
  totalResults: number;

  @ApiProperty({
    description: 'Query processing time in milliseconds',
    example: 150,
  })
  processingTime: number;

  @ApiProperty({
    description: 'Original search query',
    example: 'What are the benefits of zone 2 training?',
  })
  query: string;
}
