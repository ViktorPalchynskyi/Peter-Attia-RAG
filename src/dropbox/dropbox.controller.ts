import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DropboxService, DropboxFile } from './dropbox.service';

@ApiTags('Dropbox Knowledge Base')
@Controller('dropbox')
export class DropboxController {
  private readonly logger = new Logger(DropboxController.name);

  constructor(private readonly dropboxService: DropboxService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Get knowledge base status',
    description: 'Check if Dropbox knowledge base is configured and accessible',
  })
  @ApiResponse({
    status: 200,
    description: 'Knowledge base status',
  })
  async getStatus() {
    const isConfigured = this.dropboxService.isConfigured();
    let connectionTest: {
      connected: boolean;
      email?: string;
      error?: string;
    } | null = null;
    let documentsCount = 0;

    if (isConfigured) {
      connectionTest = await this.dropboxService.testConnection();

      if (connectionTest && connectionTest.connected) {
        try {
          const documents = await this.dropboxService.getAllDocuments();
          documentsCount = documents.length;
        } catch (error) {
          this.logger.error('Error counting documents:', error.message);
        }
      }
    }

    return {
      configured: isConfigured,
      connection: connectionTest,
      documentsCount,
      supportedTypes: this.dropboxService.getSupportedExtensions(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('documents')
  @ApiOperation({
    summary: 'List knowledge base documents',
    description: 'Get list of all documents available in the knowledge base',
  })
  @ApiResponse({
    status: 200,
    description: 'List of knowledge base documents',
  })
  async getKnowledgeBaseDocuments(): Promise<{
    documents: DropboxFile[];
    count: number;
    supportedTypes: string[];
  }> {
    try {
      this.logger.log('Retrieving knowledge base documents list');

      if (!this.dropboxService.isConfigured()) {
        this.logger.warn('Dropbox service not configured');
        return {
          documents: [],
          count: 0,
          supportedTypes: this.dropboxService.getSupportedExtensions(),
        };
      }

      const documents = await this.dropboxService.getAllDocuments();

      this.logger.log(`Found ${documents.length} documents in knowledge base`);

      return {
        documents,
        count: documents.length,
        supportedTypes: this.dropboxService.getSupportedExtensions(),
      };
    } catch (error) {
      this.logger.error('Error retrieving knowledge base documents:', error);
      throw new Error(`Failed to retrieve documents: ${error.message}`);
    }
  }

  @Get('debug')
  @ApiOperation({
    summary: 'Debug Dropbox connection',
    description: 'Get detailed debug information about Dropbox',
  })
  async debugDropbox() {
    try {
      this.logger.log('Starting Dropbox debug...');

      if (!this.dropboxService.isConfigured()) {
        return { error: 'Dropbox not configured' };
      }

      // Test basic connection
      const connectionTest = await this.dropboxService.testConnection();
      this.logger.log('Connection test result:', connectionTest);

      if (!connectionTest.connected) {
        return { error: 'Connection failed', details: connectionTest };
      }

      // Try to list root folders only (non-recursive)
      const rootResponse = await this.dropboxService['dropbox'].filesListFolder(
        {
          path: '',
          recursive: false,
          include_media_info: false,
          include_deleted: false,
        },
      );

      const rootEntries = rootResponse.result.entries.map((entry) => ({
        name: entry.name,
        tag: entry['.tag'],
        path: entry.path_lower,
      }));

      // Try to list specific folder
      let peterAttiaEntries: any[] = [];
      try {
        const peterResponse = await this.dropboxService[
          'dropbox'
        ].filesListFolder({
          path: '/Peter Attia RAG',
          recursive: false,
          include_media_info: false,
          include_deleted: false,
        });

        peterAttiaEntries = peterResponse.result.entries
          .slice(0, 10)
          .map((entry) => ({
            name: entry.name,
            tag: entry['.tag'],
            path: entry.path_lower,
            extension: entry.name.includes('.')
              ? entry.name.substring(entry.name.lastIndexOf('.'))
              : 'no extension',
          }));
      } catch (folderError) {
        this.logger.warn(
          'Could not access Peter Attia RAG folder:',
          folderError.message,
        );
      }

      return {
        connection: connectionTest,
        rootEntries: rootEntries,
        peterAttiaFolderEntries: peterAttiaEntries,
        supportedExtensions: this.dropboxService.getSupportedExtensions(),
      };
    } catch (error) {
      this.logger.error('Debug error:', error);
      return {
        error: 'Debug failed',
        message: error.message,
        errorDetails: error.error || null,
      };
    }
  }
}
