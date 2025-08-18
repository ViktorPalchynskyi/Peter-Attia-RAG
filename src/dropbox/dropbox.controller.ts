import { Controller, Get, Logger, Param } from '@nestjs/common';
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

  @Get('test-search-download/:fileName')
  @ApiOperation({
    summary: 'Test search-based download',
    description: 'Use Dropbox search API to find file and get correct ID',
  })
  async testSearchDownload(@Param('fileName') fileName: string) {
    try {
      if (!this.dropboxService.isConfigured()) {
        return { error: 'Dropbox not configured' };
      }

      // Find the file in our local list first
      const documents = await this.dropboxService.getAllDocuments();
      const targetFile = documents.find(doc => 
        doc.name.toLowerCase().includes(fileName.toLowerCase())
      );

      if (!targetFile) {
        return { 
          error: 'File not found in local list',
          searchTerm: fileName,
        };
      }

      this.logger.log(`Testing search-based download for: ${targetFile.name}`);

      try {
        const accessToken = this.dropboxService['accessToken'];

        // Step 1: Search for the file by name (avoids path issues)
        this.logger.log(`Step 1: Searching for file: ${targetFile.name}`);
        const searchResponse = await fetch(
          'https://api.dropboxapi.com/2/files/search_v2',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: targetFile.name.substring(0, 50), // Use part of filename
              options: {
                path: '/Peter Attia RAG', // Search within the folder
                max_results: 10,
                file_status: 'active',
                filename_only: true,
              },
            }),
          },
        );

        if (!searchResponse.ok) {
          const searchError = await searchResponse.text();
          return {
            success: false,
            step: 'search_failed',
            fileName: targetFile.name,
            searchStatus: searchResponse.status,
            searchError,
          };
        }

        const searchResults = await searchResponse.json();
        this.logger.log(`Search found ${searchResults.matches?.length || 0} results`);

        // Find exact match
        const exactMatch = searchResults.matches?.find((match: any) => 
          match.metadata?.metadata?.name === targetFile.name
        );

        if (!exactMatch) {
          return {
            success: false,
            step: 'no_exact_match',
            fileName: targetFile.name,
            searchResults: searchResults.matches?.map((m: any) => m.metadata?.metadata?.name) || [],
          };
        }

        const searchFileId = exactMatch.metadata.metadata.id;
        this.logger.log(`Found exact match with ID: ${searchFileId}`);

        // Step 2: Try downloading using the search-found ID
        const downloadResponse = await fetch(
          'https://content.dropboxapi.com/2/files/download',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Dropbox-API-Arg': JSON.stringify({ path: `id:${searchFileId}` }),
              'Content-Type': 'application/octet-stream',
            },
          },
        );

        if (downloadResponse.ok) {
          return {
            success: true,
            method: 'Search + ID download',
            fileName: targetFile.name,
            originalId: targetFile.id,
            searchId: searchFileId,
            fileSize: downloadResponse.headers.get('content-length'),
            idMatch: targetFile.id === searchFileId,
          };
        } else {
          const downloadError = await downloadResponse.text();
          return {
            success: false,
            step: 'download_failed',
            fileName: targetFile.name,
            originalId: targetFile.id,
            searchId: searchFileId,
            downloadStatus: downloadResponse.status,
            downloadError,
            idMatch: targetFile.id === searchFileId,
          };
        }

      } catch (error: any) {
        return {
          success: false,
          step: 'fetch_error',
          fileName: targetFile.name,
          error: (error as Error)?.message,
        };
      }
    } catch (error: any) {
      return {
        error: 'Test failed',
        message: (error as Error)?.message,
      };
    }
  }

  @Get('test-direct-api/:fileName')
  @ApiOperation({
    summary: 'Test direct API call with different methods',
    description: 'Test getting file metadata first, then downloading',
  })
  async testDirectApi(@Param('fileName') fileName: string) {
    try {
      if (!this.dropboxService.isConfigured()) {
        return { error: 'Dropbox not configured' };
      }

      // Find the file in the list
      const documents = await this.dropboxService.getAllDocuments();
      const targetFile = documents.find(doc => 
        doc.name.toLowerCase().includes(fileName.toLowerCase())
      );

      if (!targetFile) {
        return { 
          error: 'File not found',
          searchTerm: fileName,
        };
      }

      this.logger.log(`Testing direct API for: ${targetFile.name}`);

      try {
        const accessToken = this.dropboxService['accessToken'];

        // Step 1: Get file metadata using path
        this.logger.log(`Step 1: Getting metadata for path: ${targetFile.path}`);
        const metadataResponse = await fetch(
          'https://api.dropboxapi.com/2/files/get_metadata',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              path: targetFile.path,
              include_media_info: false,
              include_deleted: false,
            }),
          },
        );

        if (metadataResponse.ok) {
          const metadata = await metadataResponse.json();
          this.logger.log(`Got metadata with ID: ${metadata.id}`);

          // Step 2: Try downloading using the metadata ID
          const downloadResponse = await fetch(
            'https://content.dropboxapi.com/2/files/download',
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Dropbox-API-Arg': JSON.stringify({ path: `id:${metadata.id}` }),
                'Content-Type': 'application/octet-stream',
              },
            },
          );

          if (downloadResponse.ok) {
            return {
              success: true,
              method: 'Metadata + ID download',
              fileName: targetFile.name,
              originalId: targetFile.id,
              metadataId: metadata.id,
              fileSize: downloadResponse.headers.get('content-length'),
              idMatch: targetFile.id === metadata.id,
            };
          } else {
            const downloadError = await downloadResponse.text();
            return {
              success: false,
              step: 'download_failed',
              fileName: targetFile.name,
              originalId: targetFile.id,
              metadataId: metadata.id,
              downloadStatus: downloadResponse.status,
              downloadError,
              idMatch: targetFile.id === metadata.id,
            };
          }
        } else {
          const metadataError = await metadataResponse.text();
          return {
            success: false,
            step: 'metadata_failed',
            fileName: targetFile.name,
            originalId: targetFile.id,
            originalPath: targetFile.path,
            metadataStatus: metadataResponse.status,
            metadataError,
          };
        }

      } catch (error: any) {
        return {
          success: false,
          step: 'fetch_error',
          fileName: targetFile.name,
          error: (error as Error)?.message,
        };
      }
    } catch (error: any) {
      return {
        error: 'Test failed',
        message: (error as Error)?.message,
      };
    }
  }

  @Get('test-id-download/:fileName')
  @ApiOperation({
    summary: 'Test ID-based download only',
    description: 'Test downloading using only file ID (bypass path issues)',
  })
  async testIdDownload(@Param('fileName') fileName: string) {
    try {
      if (!this.dropboxService.isConfigured()) {
        return { error: 'Dropbox not configured' };
      }

      // Find the file in the list
      const documents = await this.dropboxService.getAllDocuments();
      const targetFile = documents.find(doc => 
        doc.name.toLowerCase().includes(fileName.toLowerCase())
      );

      if (!targetFile) {
        return { 
          error: 'File not found',
          searchTerm: fileName,
        };
      }

      this.logger.log(`Testing ID-based download: ${targetFile.id}`);

      // Test multiple ID formats
      const idsToTry = [
        targetFile.id,                    // Original ID
        `id:${targetFile.id}`,           // With id: prefix
        targetFile.id.replace('id:', ''), // Without id: prefix
      ];

      const results: Array<{
        id: string;
        status: number | string;
        success: boolean;
        error: string | null;
        contentLength?: string | null;
      }> = [];
      
      for (const idToTry of idsToTry) {
        try {
          const accessToken = this.dropboxService['accessToken'];
          const response = await fetch(
            'https://content.dropboxapi.com/2/files/download',
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Dropbox-API-Arg': JSON.stringify({ path: idToTry }),
                'Content-Type': 'application/octet-stream',
              },
            },
          );

          const errorText = response.ok ? null : await response.text();
          results.push({
            id: idToTry,
            status: response.status,
            success: response.ok,
            error: errorText,
            contentLength: response.headers.get('content-length'),
          });

          if (response.ok) {
            return {
              success: true,
              method: 'ID-based download',
              fileName: targetFile.name,
              workingId: idToTry,
              fileSize: response.headers.get('content-length'),
              allResults: results,
            };
          }
        } catch (error: any) {
          results.push({
            id: idToTry,
            status: 'fetch_error',
            success: false,
            error: (error as Error)?.message,
          });
        }
      }

      return {
        success: false,
        fileName: targetFile.name,
        originalFileData: {
          id: targetFile.id,
          path: targetFile.path,
          name: targetFile.name,
          size: targetFile.size,
        },
        allResults: results,
      };

    } catch (error: any) {
      return {
        error: 'Test failed',
        message: (error as Error)?.message,
      };
    }
  }

  @Get('debug-file/:fileName')
  @ApiOperation({
    summary: 'Debug specific file paths',
    description: 'Show all path variations tried for a specific file',
  })
  async debugFile(@Param('fileName') fileName: string) {
    try {
      if (!this.dropboxService.isConfigured()) {
        return { error: 'Dropbox not configured' };
      }

      // Find the file in the list
      const documents = await this.dropboxService.getAllDocuments();
      const targetFile = documents.find(doc => 
        doc.name.toLowerCase().includes(fileName.toLowerCase())
      );

      if (!targetFile) {
        return { 
          error: 'File not found',
          searchTerm: fileName,
          availableFiles: documents.slice(0, 20).map(d => d.name)
        };
      }

      // Show path analysis
      const originalPath = targetFile.path;
      
      // Simulate the same logic as downloadDocument
      const normalizedPath = this.dropboxService['normalizePath'](originalPath);
      
      const pathsToTry = [originalPath];
      
      if (normalizedPath !== originalPath) {
        pathsToTry.push(normalizedPath);
      }
      
      const encodedPath = encodeURI(originalPath);
      if (encodedPath !== originalPath && !pathsToTry.includes(encodedPath)) {
        pathsToTry.push(encodedPath);
      }
      
      const simplePath = originalPath
        .replace(/–/g, '-')
        .replace(/"/g, '"')
        .replace(/"/g, '"');
      if (simplePath !== originalPath && !pathsToTry.includes(simplePath)) {
        pathsToTry.push(simplePath);
      }

      // Test each path variation
      const pathTests: Array<{
        path: string;
        status: number | string;
        success: boolean;
        error: string | null;
      }> = [];
      for (const testPath of pathsToTry) {
        try {
          const accessToken = this.dropboxService['accessToken'];
          const response = await fetch(
            'https://content.dropboxapi.com/2/files/download',
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Dropbox-API-Arg': JSON.stringify({ path: testPath }),
                'Content-Type': 'application/octet-stream',
              },
            },
          );

          pathTests.push({
            path: testPath,
            status: response.status,
            success: response.ok,
            error: response.ok ? null : await response.text()
          });

          if (response.ok) break; // Stop on first success
        } catch (error: any) {
          pathTests.push({
            path: testPath,
            status: 'fetch_error',
            success: false,
            error: (error as Error)?.message
          });
        }
      }

      return {
        fileName: targetFile.name,
        originalPath,
        normalizedPath,
        fileId: targetFile.id,
        pathVariations: pathsToTry,
        testResults: pathTests,
        analysis: {
          hasSpecialChars: /[^\x00-\x7F]/.test(originalPath),
          hasLongDash: /[‒–—]/.test(originalPath),
          hasSmartQuotes: /[""'']/.test(originalPath),
        }
      };
    } catch (error: any) {
      return {
        error: 'Debug failed',
        message: (error as Error)?.message,
      };
    }
  }

  @Get('test-direct-api/:fileName')
  @ApiOperation({
    summary: 'Test direct API download',
    description: 'Test downloading using direct Dropbox API (bypassing SDK)',
  })
  async testDirectAPI(@Param('fileName') fileName: string) {
    try {
      if (!this.dropboxService.isConfigured()) {
        return { error: 'Dropbox not configured' };
      }

      // Find the file in the list
      const documents = await this.dropboxService.getAllDocuments();
      const targetFile = documents.find(doc => 
        doc.name.toLowerCase().includes(fileName.toLowerCase())
      );

      if (!targetFile) {
        return { 
          error: 'File not found',
          availableFiles: documents.slice(0, 10).map(d => d.name)
        };
      }

      this.logger.log(`Direct API test download of: ${targetFile.name}`);
      this.logger.log(`File path: ${targetFile.path}`);

      // Use direct fetch API
      try {
        const accessToken = this.dropboxService['accessToken'];
        const response = await fetch(
          'https://content.dropboxapi.com/2/files/download',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Dropbox-API-Arg': JSON.stringify({ path: targetFile.path }),
              'Content-Type': 'application/octet-stream',
            },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          this.logger.error(`Direct API failed: ${response.status} - ${errorText}`);
          
          // Try with file ID
          const idResponse = await fetch(
            'https://content.dropboxapi.com/2/files/download',
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Dropbox-API-Arg': JSON.stringify({ path: `id:${targetFile.id}` }),
                'Content-Type': 'application/octet-stream',
              },
            },
          );

          if (!idResponse.ok) {
            const idErrorText = await idResponse.text();
            return {
              success: false,
              fileName: targetFile.name,
              pathError: `${response.status}: ${errorText}`,
              idError: `${idResponse.status}: ${idErrorText}`,
            };
          }

          // ID method worked
          const contentLength = idResponse.headers.get('content-length');
          return {
            success: true,
            method: 'Direct API with ID',
            fileName: targetFile.name,
            fileSize: contentLength ? parseInt(contentLength) : 'unknown',
            usedId: targetFile.id,
          };
        }

        // Original path method worked
        const contentLength = response.headers.get('content-length');
        return {
          success: true,
          method: 'Direct API with path',
          fileName: targetFile.name,
          fileSize: contentLength ? parseInt(contentLength) : 'unknown',
          usedPath: targetFile.path,
        };

      } catch (fetchError: any) {
        this.logger.error('Fetch error:', fetchError);
        return {
          success: false,
          fileName: targetFile.name,
          error: (fetchError as Error)?.message,
        };
      }
    } catch (error: any) {
      this.logger.error('Direct API test error:', error);
      return {
        error: 'Test failed',
        message: (error as Error)?.message,
      };
    }
  }

  @Get('test-simple-download/:fileName')
  @ApiOperation({
    summary: 'Simple test download',
    description: 'Test downloading with minimal logic (for debugging)',
  })
  async testSimpleDownload(@Param('fileName') fileName: string) {
    try {
      if (!this.dropboxService.isConfigured()) {
        return { error: 'Dropbox not configured' };
      }

      // Find the file in the list
      const documents = await this.dropboxService.getAllDocuments();
      const targetFile = documents.find(doc => 
        doc.name.toLowerCase().includes(fileName.toLowerCase())
      );

      if (!targetFile) {
        return { 
          error: 'File not found',
          availableFiles: documents.slice(0, 10).map(d => d.name)
        };
      }

      this.logger.log(`Simple test download of: ${targetFile.name}`);
      this.logger.log(`File path: ${targetFile.path}`);
      this.logger.log(`File ID: ${targetFile.id}`);

      // Try direct SDK call with original path
      try {
        const dropbox = this.dropboxService['dropbox'];
        this.logger.log(`Attempting SDK download with path: ${targetFile.path}`);
        
        const response = await dropbox.filesDownload({ path: targetFile.path });
        
        return {
          success: true,
          method: 'SDK',
          fileName: response.result.name,
          fileSize: response.result.size,
          path: targetFile.path,
        };
      } catch (sdkError: any) {
        this.logger.error(`SDK failed:`, sdkError);
        
        // Try with ID
        try {
          const dropbox = this.dropboxService['dropbox'];
          this.logger.log(`Attempting SDK download with ID: id:${targetFile.id}`);
          
          const response = await dropbox.filesDownload({ path: `id:${targetFile.id}` });
          
          return {
            success: true,
            method: 'SDK with ID',
            fileName: response.result.name,
            fileSize: response.result.size,
            originalPath: targetFile.path,
            usedId: targetFile.id,
          };
        } catch (idError: any) {
          this.logger.error(`ID download failed:`, idError);
          
          return {
            success: false,
            fileName: targetFile.name,
            originalPath: targetFile.path,
            fileId: targetFile.id,
            sdkError: (sdkError as Error)?.message,
            idError: (idError as Error)?.message,
          };
        }
      }
    } catch (error: any) {
      this.logger.error('Simple test download error:', error);
      return {
        error: 'Test failed',
        message: (error as Error)?.message,
      };
    }
  }

  @Get('test-download/:fileName')
  @ApiOperation({
    summary: 'Test download single file',
    description: 'Test downloading a specific file by name (for debugging)',
  })
  async testDownload(@Param('fileName') fileName: string) {
    try {
      if (!this.dropboxService.isConfigured()) {
        return { error: 'Dropbox not configured' };
      }

      // Find the file in the list
      const documents = await this.dropboxService.getAllDocuments();
      const targetFile = documents.find(doc => 
        doc.name.toLowerCase().includes(fileName.toLowerCase())
      );

      if (!targetFile) {
        return { 
          error: 'File not found',
          availableFiles: documents.slice(0, 10).map(d => d.name)
        };
      }

      this.logger.log(`Testing download of: ${targetFile.name}`);

      try {
        const result = await this.dropboxService.downloadDocument(targetFile.path);
        return {
          success: true,
          fileName: result.file.name,
          fileSize: result.content.length,
          originalPath: targetFile.path,
          downloadedPath: result.file.path,
        };
      } catch (downloadError: any) {
        return {
          success: false,
          fileName: targetFile.name,
          originalPath: targetFile.path,
          error: (downloadError as Error)?.message,
        };
      }
    } catch (error: any) {
      this.logger.error('Test download error:', error);
      return {
        error: 'Test failed',
        message: (error as Error)?.message,
      };
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
      let problematicFiles: any[] = [];

      try {
        const peterResponse = await this.dropboxService[
          'dropbox'
        ].filesListFolder({
          path: '/Peter Attia RAG',
          recursive: true,
          include_media_info: false,
          include_deleted: false,
        });

        // Check each file for problematic characters
        peterResponse.result.entries.forEach((entry) => {
          if (entry['.tag'] === 'file') {
            const pathHasProblems =
              this.dropboxService.checkForProblematicCharacters(
                entry.path_lower || '',
              );
            const nameHasProblems =
              this.dropboxService.checkForProblematicCharacters(
                entry.name || '',
              );
            const hasProblems = pathHasProblems || nameHasProblems;

            const fileInfo = {
              name: entry.name,
              path: entry.path_display || entry.path_lower,
              extension: entry.name.includes('.')
                ? entry.name.substring(entry.name.lastIndexOf('.'))
                : 'no extension',
              hasProblematicChars: hasProblems,
              pathProblems: pathHasProblems,
              nameProblems: nameHasProblems,
            };

            if (hasProblems) {
              problematicFiles.push(fileInfo);
            } else {
              peterAttiaEntries.push(fileInfo);
            }
          }
        });
      } catch (folderError) {
        this.logger.warn(
          'Could not access Peter Attia RAG folder:',
          folderError.message,
        );
      }

      return {
        connection: connectionTest,
        rootEntries: rootEntries,
        cleanFiles: peterAttiaEntries.slice(0, 10),
        problematicFiles: problematicFiles.slice(0, 10),
        supportedExtensions: this.dropboxService.getSupportedExtensions(),
        totalCleanFiles: peterAttiaEntries.length,
        totalProblematicFiles: problematicFiles.length,
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
