import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DropboxService, DropboxFileContent } from '../dropbox/dropbox.service';
import { ParsersService } from './parsers/parsers.service';

export interface ProcessedDocument {
  id: string;
  filename: string;
  content: string;
  chunks: DocumentChunk[];
  metadata: any;
}

export interface DocumentChunk {
  content: string;
  chunkIndex: number;
  startPosition: number;
  endPosition: number;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private dropboxService: DropboxService,
    private parsersService: ParsersService,
  ) {}

  async processAllDocuments(): Promise<{
    processed: number;
    failed: number;
    skipped: number;
    details: Array<{
      filename: string;
      status: 'success' | 'failed' | 'skipped';
      chunks?: number;
      wordCount?: number;
      error?: string;
    }>;
  }> {
    this.logger.log('Starting to process all documents from Dropbox');

    if (!this.dropboxService.isConfigured()) {
      throw new Error('Dropbox service not configured');
    }

    try {
      // Use new iterative processing method
      const result = await this.dropboxService.processDocumentsIteratively(
        async (fileContent: DropboxFileContent) => {
          const processResult = await this.processDocument(fileContent);
          if (!processResult.success) {
            throw new Error(processResult.error || 'Unknown processing error');
          }
        }
      );

      // Convert the result format to match the expected interface
      const details = result.details.map(detail => {
        if (detail.status === 'success') {
          // For successful items, we don't have chunks/wordCount from the iterative processor
          // This is a limitation of the current approach - we could improve this later
          return {
            filename: detail.filename,
            status: detail.status as 'success',
            chunks: undefined, // Could be retrieved from DB if needed
            wordCount: undefined, // Could be retrieved from DB if needed
          };
        } else {
          return {
            filename: detail.filename,
            status: detail.status as 'failed' | 'skipped',
            error: detail.error,
          };
        }
      });

      this.logger.log(
        `Document processing completed: ${result.processed} successful, ${result.failed} failed, ${result.skipped} skipped`,
      );

      return {
        processed: result.processed,
        failed: result.failed,
        skipped: result.skipped,
        details,
      };
    } catch (error: any) {
      this.logger.error('Error processing documents:', error);
      throw error;
    }
  }

  // Alternative method: Process with detailed results (slower but more info)
  async processAllDocumentsDetailed(): Promise<{
    processed: number;
    failed: number;
    skipped: number;
    details: Array<{
      filename: string;
      status: 'success' | 'failed' | 'skipped';
      chunks?: number;
      wordCount?: number;
      error?: string;
    }>;
  }> {
    this.logger.log('Starting detailed processing of all documents from Dropbox');

    if (!this.dropboxService.isConfigured()) {
      throw new Error('Dropbox service not configured');
    }

    const documents = await this.dropboxService.getAllDocuments();
    const results = {
      processed: 0,
      failed: 0,
      skipped: 0,
      details: [] as Array<{
        filename: string;
        status: 'success' | 'failed' | 'skipped';
        chunks?: number;
        wordCount?: number;
        error?: string;
      }>,
    };

    this.logger.log(`Processing ${documents.length} documents with detailed results...`);

    for (const doc of documents) {
      try {
        // Log if file has problematic characters, but still attempt processing
        if (this.dropboxService.checkForProblematicCharacters(doc.path) || 
            this.dropboxService.checkForProblematicCharacters(doc.name)) {
          this.logger.debug(`File has problematic characters, but will attempt ID-based download: ${doc.name}`);
        }

        // Download and process document
        const fileContent = await this.dropboxService.downloadDocument(doc.path);
        const processResult = await this.processDocument(fileContent);

        if (processResult.success) {
          results.processed++;
          results.details.push({
            filename: doc.name,
            status: 'success',
            chunks: processResult.chunks,
            wordCount: processResult.wordCount,
          });
        } else {
          results.failed++;
          results.details.push({
            filename: doc.name,
            status: 'failed',
            error: processResult.error,
          });
        }
      } catch (error: any) {
        this.logger.error(`Failed to process ${doc.path}: ${error.message}`);
        results.failed++;
        results.details.push({
          filename: doc.name,
          status: 'failed',
          error: error.message,
        });
      }
    }

    this.logger.log(
      `Detailed processing completed: ${results.processed} successful, ${results.failed} failed, ${results.skipped} skipped`,
    );
    return results;
  }

  async processDocument(fileContent: DropboxFileContent): Promise<{
    success: boolean;
    chunks?: number;
    wordCount?: number;
    error?: string;
  }> {
    const { file, content } = fileContent;

    try {
      this.logger.debug(`Processing document: ${file.name}`);

      // Parse the document
      const parseResult = await this.parsersService.parseDocument(
        content,
        file.name,
      );

      if (!parseResult.success || !parseResult.document) {
        return {
          success: false,
          error: parseResult.error || 'Unknown parsing error',
        };
      }

      const parsedDoc = parseResult.document;

      // Check if document already exists
      const existingDoc = await this.prisma.document.findFirst({
        where: {
          filename: file.name,
          dropboxPath: file.path,
        },
      });

      let document;

      if (existingDoc) {
        // Update existing document
        document = await this.prisma.document.update({
          where: { id: existingDoc.id },
          data: {
            content: parsedDoc.content,
            metadata: parsedDoc.metadata,
            updatedAt: new Date(),
          },
        });

        // Delete old chunks
        await this.prisma.documentChunk.deleteMany({
          where: { documentId: existingDoc.id },
        });

        this.logger.debug(`Updated existing document: ${file.name}`);
      } else {
        // Create new document
        document = await this.prisma.document.create({
          data: {
            filename: file.name,
            fileType: parsedDoc.metadata.extension,
            content: parsedDoc.content,
            metadata: parsedDoc.metadata,
            dropboxPath: file.path,
          },
        });

        this.logger.debug(`Created new document: ${file.name}`);
      }

      // Create chunks
      const chunks = this.parsersService.chunkText(parsedDoc.content);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const startPos = parsedDoc.content.indexOf(chunk);
        const endPos = startPos + chunk.length;

        await this.prisma.documentChunk.create({
          data: {
            documentId: document.id,
            content: chunk,
            chunkIndex: i,
            startPosition: startPos,
            endPosition: endPos,
            // Note: embedding will be added later by embeddings service
          },
        });
      }

      this.logger.debug(
        `Created ${chunks.length} chunks for document: ${file.name}`,
      );

      return {
        success: true,
        chunks: chunks.length,
        wordCount: parsedDoc.metadata.wordCount,
      };
    } catch (error) {
      this.logger.error(`Error processing document ${file.name}:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async getDocumentById(id: string) {
    return this.prisma.document.findUnique({
      where: { id },
      include: {
        chunks: {
          take: 10, // Limit chunks in overview
          orderBy: { chunkIndex: 'asc' },
        },
      },
    });
  }

  async getAllDocuments(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [documents, total] = await Promise.all([
      this.prisma.document.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { chunks: true },
          },
        },
      }),
      this.prisma.document.count(),
    ]);

    return {
      documents,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getDocumentsByType(fileType: string) {
    return this.prisma.document.findMany({
      where: { fileType },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
    });
  }

  async searchDocuments(query: string) {
    return this.prisma.document.findMany({
      where: {
        OR: [
          { filename: { contains: query, mode: 'insensitive' } },
          { content: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
    });
  }

  async deleteDocument(id: string) {
    // Chunks will be deleted automatically due to cascade
    return this.prisma.document.delete({
      where: { id },
    });
  }

  async getProcessingStats() {
    const [totalDocs, totalChunks, typeStats] = await Promise.all([
      this.prisma.document.count(),
      this.prisma.documentChunk.count(),
      this.prisma.document.groupBy({
        by: ['fileType'],
        _count: {
          fileType: true,
        },
      }),
    ]);

    return {
      totalDocuments: totalDocs,
      totalChunks,
      averageChunksPerDocument:
        totalDocs > 0 ? Math.round(totalChunks / totalDocs) : 0,
      documentsByType: typeStats.reduce(
        (acc, stat) => {
          acc[stat.fileType] = stat._count.fileType;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }

  // ==================== EMBEDDING METHODS ====================

  /**
   * Generate embeddings for all chunks that don't have them yet
   */
  async generateMissingEmbeddings(): Promise<{
    message: string;
    totalChunks: number;
    chunksWithoutEmbeddings: number;
    processed: number;
    failed: number;
    estimatedTimeMinutes: number;
  }> {
    const startTime = Date.now();
    
    // Get chunks without embeddings
    const chunksWithoutEmbeddings = await this.prisma.$queryRaw`
      SELECT id, content, document_id, chunk_index
      FROM document_chunks
      WHERE embedding IS NULL
      ORDER BY created_at ASC
    ` as Array<{
      id: string;
      content: string;
      document_id: string;
      chunk_index: number;
    }>;

    const totalWithoutEmbeddings = chunksWithoutEmbeddings.length;
    
    if (totalWithoutEmbeddings === 0) {
      return {
        message: 'All chunks already have embeddings',
        totalChunks: 0,
        chunksWithoutEmbeddings: 0,
        processed: 0,
        failed: 0,
        estimatedTimeMinutes: 0,
      };
    }

    this.logger.log(`Found ${totalWithoutEmbeddings} chunks without embeddings. Starting generation...`);

    let processed = 0;
    let failed = 0;
    const batchSize = 10; // Process in small batches to avoid rate limits

    // Import EmbeddingService dynamically to avoid circular dependency
    const { EmbeddingService } = await import('./services/embedding.service');
    const embeddingService = new EmbeddingService();

    for (let i = 0; i < chunksWithoutEmbeddings.length; i += batchSize) {
      const batch = chunksWithoutEmbeddings.slice(i, i + batchSize);
      
      try {
        // Generate embeddings for the batch
        const contents = batch.map(chunk => chunk.content);
        const embeddings = await embeddingService.generateEmbeddings(contents);

        // Update database with embeddings
        for (let j = 0; j < batch.length; j++) {
          try {
            const embedding = embeddings[j];
            const vectorString = `[${embedding.join(',')}]`;

            await this.prisma.$queryRaw`
              UPDATE document_chunks 
              SET embedding = ${vectorString}::vector, updated_at = NOW()
              WHERE id = ${batch[j].id}
            `;
            
            processed++;
          } catch (error: any) {
            this.logger.error(`Failed to update embedding for chunk ${batch[j].id}: ${error.message}`);
            failed++;
          }
        }

        // Log progress every 100 chunks
        if ((i + batchSize) % 100 === 0 || i + batchSize >= chunksWithoutEmbeddings.length) {
          const progress = Math.round(((i + batchSize) / totalWithoutEmbeddings) * 100);
          this.logger.log(`Embedding progress: ${progress}% (${processed} processed, ${failed} failed)`);
        }

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error: any) {
        this.logger.error(`Failed to process batch starting at index ${i}: ${error.message}`);
        failed += batch.length;
      }
    }

    const processingTime = Date.now() - startTime;
    const estimatedTimeMinutes = Math.round(processingTime / 60000);

    this.logger.log(
      `Embedding generation completed: ${processed} processed, ${failed} failed in ${estimatedTimeMinutes} minutes`
    );

    return {
      message: 'Embedding generation completed',
      totalChunks: totalWithoutEmbeddings,
      chunksWithoutEmbeddings: totalWithoutEmbeddings - processed - failed,
      processed,
      failed,
      estimatedTimeMinutes,
    };
  }

  /**
   * Get status of embedding generation
   */
  async getEmbeddingStatus(): Promise<{
    totalChunks: number;
    chunksWithEmbeddings: number;
    chunksWithoutEmbeddings: number;
    completionPercentage: number;
  }> {
    const [totalResult, withEmbeddingsResult] = await Promise.all([
      this.prisma.$queryRaw`SELECT COUNT(*) as count FROM document_chunks` as Promise<Array<{ count: bigint }>>,
      this.prisma.$queryRaw`SELECT COUNT(*) as count FROM document_chunks WHERE embedding IS NOT NULL` as Promise<Array<{ count: bigint }>>,
    ]);

    const totalChunks = Number(totalResult[0].count);
    const chunksWithEmbeddings = Number(withEmbeddingsResult[0].count);
    const chunksWithoutEmbeddings = totalChunks - chunksWithEmbeddings;
    const completionPercentage = totalChunks > 0 ? Math.round((chunksWithEmbeddings / totalChunks) * 100) : 0;

    return {
      totalChunks,
      chunksWithEmbeddings,
      chunksWithoutEmbeddings,
      completionPercentage,
    };
  }
}
