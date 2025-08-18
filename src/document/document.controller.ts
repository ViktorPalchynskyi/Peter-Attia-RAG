import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { DocumentsService } from './document.service';
import { ParsersService } from './parsers/parsers.service';
import { SearchService } from './services/search.service';
import { EmbeddingService } from './services/embedding.service';
import { RagService } from './services/rag.service';
import { SearchDocumentsDto, SearchResponseDto } from './dto/search.dto';
import { RagQueryDto, RagResponseDto, RagAnalyticsDto } from './dto/rag.dto';

@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly parsersService: ParsersService,
    private readonly searchService: SearchService,
    private readonly embeddingService: EmbeddingService,
    private readonly ragService: RagService,
  ) {}

  @Post('process-all')
  @ApiOperation({
    summary: 'Process all documents from Dropbox (fast)',
    description:
      'Download, parse, and index all documents from Dropbox knowledge base using efficient iterative approach',
  })
  @ApiResponse({
    status: 200,
    description: 'Documents processed successfully',
    schema: {
      type: 'object',
      properties: {
        processed: { type: 'number' },
        failed: { type: 'number' },
        skipped: { type: 'number' },
        details: { type: 'array' },
      },
    },
  })
  async processAllDocuments() {
    try {
      this.logger.log('Starting bulk document processing...');
      const result = await this.documentsService.processAllDocuments();

      return {
        message: 'Document processing completed',
        ...result,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('Error in bulk processing:', error);
      throw new HttpException(
        `Failed to process documents: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('process-single/:fileName')
  @ApiOperation({
    summary: 'Process single document by name',
    description: 'Test processing of a single document (for debugging)',
  })
  async processSingleDocument(@Param('fileName') fileName: string) {
    try {
      this.logger.log(`Processing single document: ${fileName}`);
      
      // Find the file in Dropbox
      const dropboxService = this.documentsService['dropboxService'];
      const documents = await dropboxService.getAllDocuments();
      const targetFile = documents.find(doc => 
        doc.name.toLowerCase().includes(fileName.toLowerCase())
      );

      if (!targetFile) {
        throw new HttpException(
          `File not found: ${fileName}`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Download and process the file
      const fileContent = await dropboxService.downloadDocument(targetFile.path);
      const result = await this.documentsService.processDocument(fileContent);

      return {
        message: 'Single document processing completed',
        fileName: targetFile.name,
        result,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('Error in single document processing:', error);
      throw new HttpException(
        `Failed to process document: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('process-all-detailed')
  @ApiOperation({
    summary: 'Process all documents from Dropbox (detailed)',
    description:
      'Download, parse, and index all documents with detailed chunk and word count information (slower but more informative)',
  })
  @ApiResponse({
    status: 200,
    description: 'Documents processed successfully with detailed information',
    schema: {
      type: 'object',
      properties: {
        processed: { type: 'number' },
        failed: { type: 'number' },
        skipped: { type: 'number' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string' },
              status: { type: 'string', enum: ['success', 'failed', 'skipped'] },
              chunks: { type: 'number' },
              wordCount: { type: 'number' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
  })
  async processAllDocumentsDetailed() {
    try {
      this.logger.log('Starting detailed bulk document processing...');
      const result = await this.documentsService.processAllDocumentsDetailed();

      return {
        message: 'Detailed document processing completed',
        ...result,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('Error in detailed bulk processing:', error);
      throw new HttpException(
        `Failed to process documents: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  @ApiOperation({
    summary: 'Get all processed documents',
    description: 'Retrieve paginated list of all processed documents',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page' })
  @ApiResponse({
    status: 200,
    description: 'Documents retrieved successfully',
  })
  async getAllDocuments(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    try {
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      return await this.documentsService.getAllDocuments(pageNum, limitNum);
    } catch (error) {
      this.logger.error('Error retrieving documents:', error);
      throw new HttpException(
        `Failed to retrieve documents: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get processing statistics',
    description: 'Get overview of document processing statistics',
  })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
  })
  async getProcessingStats() {
    try {
      const stats = await this.documentsService.getProcessingStats();

      return {
        ...stats,
        supportedTypes: this.parsersService.getSupportedExtensions(),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Error getting stats:', error);
      throw new HttpException(
        `Failed to get statistics: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }



  @Get('by-type/:type')
  @ApiOperation({
    summary: 'Get documents by file type',
    description: 'Retrieve documents filtered by file type',
  })
  @ApiParam({ name: 'type', description: 'File type (e.g., .pdf, .docx)' })
  @ApiResponse({
    status: 200,
    description: 'Documents filtered by type',
  })
  async getDocumentsByType(@Param('type') type: string) {
    try {
      this.logger.log(`Getting documents of type: ${type}`);

      if (!type.startsWith('.')) {
        type = '.' + type;
      }

      const documents = await this.documentsService.getDocumentsByType(type);

      return {
        fileType: type,
        documents,
        count: documents.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Error getting documents by type:', error);
      throw new HttpException(
        `Failed to get documents: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get document by ID',
    description: 'Retrieve specific document with its chunks',
  })
  @ApiParam({ name: 'id', description: 'Document ID' })
  @ApiResponse({
    status: 200,
    description: 'Document retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Document not found',
  })
  async getDocumentById(@Param('id') id: string) {
    try {
      const document = await this.documentsService.getDocumentById(id);

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      return document;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Error getting document:', error);
      throw new HttpException(
        `Failed to get document: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete document',
    description: 'Delete document and all its chunks',
  })
  @ApiParam({ name: 'id', description: 'Document ID' })
  @ApiResponse({
    status: 200,
    description: 'Document deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Document not found',
  })
  async deleteDocument(@Param('id') id: string) {
    try {
      await this.documentsService.deleteDocument(id);

      return {
        message: 'Document deleted successfully',
        id,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Error deleting document:', error);
      throw new HttpException(
        `Failed to delete document: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('test/parser')
  @ApiOperation({
    summary: 'Test document parser',
    description:
      'Get information about supported file types and parser capabilities',
  })
  @ApiResponse({
    status: 200,
    description: 'Parser information',
  })
  async testParser() {
    return {
      supportedExtensions: this.parsersService.getSupportedExtensions(),
      capabilities: {
        pdf: 'Text extraction with metadata',
        docx: 'Full text extraction',
        doc: 'Basic text extraction (legacy format)',
        xlsx: 'Spreadsheet data with sheet separation',
        xls: 'Legacy spreadsheet support',
        txt: 'Plain text files',
        zip: 'Recursive extraction of supported files',
      },
      chunkingOptions: {
        defaultMaxSize: 1000,
        defaultOverlap: 200,
        boundaryDetection: 'sentence and paragraph aware',
      },
    };
  }

  // ==================== SEARCH ENDPOINTS ====================

  @Post('search')
  @ApiOperation({
    summary: 'Semantic search across all documents',
    description: 'Search for relevant content across all processed documents using vector similarity',
  })
  @ApiResponse({
    status: 200,
    description: 'Search completed successfully',
    type: SearchResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid search parameters',
  })
  @ApiResponse({
    status: 500,
    description: 'Search failed',
  })
  async searchDocuments(@Body() searchDto: SearchDocumentsDto): Promise<SearchResponseDto> {
    try {
      this.logger.log(`Semantic search request: "${searchDto.query}"`);
      return await this.searchService.searchDocuments(searchDto);
    } catch (error: any) {
      this.logger.error(`Search failed: ${error.message}`);
      throw new HttpException(
        `Search failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('search/similar/:chunkId')
  @ApiOperation({
    summary: 'Find similar chunks',
    description: 'Find chunks similar to a specific chunk (for related content)',
  })
  @ApiParam({
    name: 'chunkId',
    description: 'ID of the source chunk',
    example: 'chunk_123',
  })
  @ApiQuery({
    name: 'limit',
    description: 'Maximum number of results',
    required: false,
    example: 5,
  })
  @ApiQuery({
    name: 'threshold',
    description: 'Minimum similarity threshold (0.0 to 1.0)',
    required: false,
    example: 0.8,
  })
  async findSimilarChunks(
    @Param('chunkId') chunkId: string,
    @Query('limit') limit?: number,
    @Query('threshold') threshold?: number,
  ) {
    try {
      return await this.searchService.findSimilarChunks(
        chunkId,
        limit ? parseInt(limit.toString()) : 5,
        threshold ? parseFloat(threshold.toString()) : 0.8,
      );
    } catch (error: any) {
      this.logger.error(`Similar chunks search failed: ${error.message}`);
      throw new HttpException(
        `Similar chunks search failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('search/document/:documentId')
  @ApiOperation({
    summary: 'Search within a specific document',
    description: 'Search for content within a single document',
  })
  @ApiParam({
    name: 'documentId',
    description: 'ID of the document to search in',
    example: 'doc_123',
  })
  async searchInDocument(
    @Param('documentId') documentId: string,
    @Body() body: { query: string; limit?: number; threshold?: number },
  ) {
    try {
      return await this.searchService.searchInDocument(
        documentId,
        body.query,
        body.limit || 10,
        body.threshold || 0.7,
      );
    } catch (error: any) {
      this.logger.error(`Document search failed: ${error.message}`);
      throw new HttpException(
        `Document search failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('search/analytics')
  @ApiOperation({
    summary: 'Get search analytics',
    description: 'Retrieve search usage statistics and analytics',
  })
  async getSearchAnalytics() {
    try {
      return await this.searchService.getSearchAnalytics();
    } catch (error: any) {
      this.logger.error(`Failed to get search analytics: ${error.message}`);
      throw new HttpException(
        `Analytics retrieval failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== EMBEDDING MANAGEMENT ====================

  @Get('embeddings/health')
  @ApiOperation({
    summary: 'Check OpenAI embeddings service health',
    description: 'Test connection to OpenAI API for embeddings generation',
  })
  async checkEmbeddingsHealth() {
    try {
      return await this.embeddingService.healthCheck();
    } catch (error: any) {
      this.logger.error(`Embeddings health check failed: ${error.message}`);
      throw new HttpException(
        `OpenAI API health check failed: ${error.message}`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Post('embeddings/generate-all')
  @ApiOperation({
    summary: 'Generate embeddings for all chunks without embeddings',
    description: 'Process all document chunks that don\'t have embeddings yet and generate them using OpenAI',
  })
  @ApiResponse({
    status: 200,
    description: 'Embedding generation started',
  })
  async generateAllEmbeddings() {
    try {
      this.logger.log('Starting embedding generation for all chunks without embeddings');
      return await this.documentsService.generateMissingEmbeddings();
    } catch (error: any) {
      this.logger.error(`Embedding generation failed: ${error.message}`);
      throw new HttpException(
        `Embedding generation failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('embeddings/status')
  @ApiOperation({
    summary: 'Get embedding generation status',
    description: 'Check how many chunks have embeddings vs total chunks',
  })
  async getEmbeddingStatus() {
    try {
      return await this.documentsService.getEmbeddingStatus();
    } catch (error: any) {
      this.logger.error(`Failed to get embedding status: ${error.message}`);
      throw new HttpException(
        `Status check failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== RAG ENDPOINTS ====================

  @Post('ask')
  @ApiOperation({
    summary: 'Ask a question using RAG (Retrieval-Augmented Generation)',
    description: 'Get comprehensive answers based on Peter Attia\'s knowledge base using AI',
  })
  @ApiResponse({
    status: 200,
    description: 'Answer generated successfully',
    type: RagResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters',
  })
  @ApiResponse({
    status: 500,
    description: 'Answer generation failed',
  })
  async askQuestion(@Body() ragQuery: RagQueryDto): Promise<RagResponseDto> {
    try {
      this.logger.log(`RAG question: "${ragQuery.question}"`);
      return await this.ragService.generateAnswer(ragQuery);
    } catch (error: any) {
      this.logger.error(`RAG question failed: ${error.message}`);
      throw new HttpException(
        `Answer generation failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('ask/quick')
  @ApiOperation({
    summary: 'Ask a quick question (concise response)',
    description: 'Get a brief, concise answer to your question',
  })
  async askQuickQuestion(@Body() body: { question: string; userId?: string }) {
    try {
      const ragQuery: RagQueryDto = {
        question: body.question,
        responseMode: 'concise' as any,
        maxContextChunks: 3,
        similarityThreshold: 0.3,
        userId: body.userId,
      };
      
      return await this.ragService.generateAnswer(ragQuery);
    } catch (error: any) {
      this.logger.error(`Quick question failed: ${error.message}`);
      throw new HttpException(
        `Quick answer generation failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('ask/detailed')
  @ApiOperation({
    summary: 'Ask a detailed question (comprehensive response)',
    description: 'Get a detailed, comprehensive answer with full context',
  })
  async askDetailedQuestion(@Body() body: { question: string; userId?: string }) {
    try {
      const ragQuery: RagQueryDto = {
        question: body.question,
        responseMode: 'detailed' as any,
        maxContextChunks: 8,
        similarityThreshold: 0.2,
        userId: body.userId,
      };
      
      return await this.ragService.generateAnswer(ragQuery);
    } catch (error: any) {
      this.logger.error(`Detailed question failed: ${error.message}`);
      throw new HttpException(
        `Detailed answer generation failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('rag/analytics')
  @ApiOperation({
    summary: 'Get RAG system analytics',
    description: 'Retrieve usage statistics and performance metrics for the RAG system',
  })
  @ApiResponse({
    status: 200,
    description: 'Analytics retrieved successfully',
    type: RagAnalyticsDto,
  })
  async getRagAnalytics(): Promise<RagAnalyticsDto> {
    try {
      return await this.ragService.getRagAnalytics();
    } catch (error: any) {
      this.logger.error(`Failed to get RAG analytics: ${error.message}`);
      throw new HttpException(
        `Analytics retrieval failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('rag/health')
  @ApiOperation({
    summary: 'Check RAG system health',
    description: 'Test all components of the RAG system (search, embeddings, LLM)',
  })
  async checkRagHealth() {
    try {
      // Test search functionality
      const searchTest = await this.searchService.searchDocuments({
        query: 'health test',
        limit: 1,
        threshold: 0.1,
      });

      // Test embeddings
      const embeddingTest = await this.embeddingService.healthCheck();

      // Test simple RAG query
      const ragTest = await this.ragService.generateAnswer({
        question: 'What is health?',
        maxContextChunks: 1,
        similarityThreshold: 0.1,
        responseMode: 'concise' as any,
      });

      return {
        status: 'healthy',
        components: {
          search: {
            status: 'ok',
            resultsFound: searchTest.totalResults,
            responseTime: searchTest.processingTime,
          },
          embeddings: {
            status: embeddingTest.status,
            model: embeddingTest.model,
          },
          rag: {
            status: 'ok',
            responseGenerated: ragTest.answer.length > 0,
            totalTime: ragTest.totalTime,
            confidence: ragTest.confidence,
          },
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error(`RAG health check failed: ${error.message}`);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
