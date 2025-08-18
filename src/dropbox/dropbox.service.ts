import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Dropbox } from 'dropbox';

export interface DropboxFile {
  id: string;
  name: string;
  path: string;
  size: number;
  modifiedTime: string;
  extension?: string;
}

export interface DropboxFileContent {
  file: DropboxFile;
  content: Buffer;
}

@Injectable()
export class DropboxService implements OnModuleInit {
  private readonly logger = new Logger(DropboxService.name);
  private dropbox: Dropbox;
  private readonly accessToken: string;

  constructor(private configService: ConfigService) {
    this.accessToken =
      this.configService.get<string>('DROPBOX_ACCESS_TOKEN') || '';

    if (!this.accessToken) {
      this.logger.warn(
        'DROPBOX_ACCESS_TOKEN not found - Dropbox knowledge base disabled',
      );
    }

    this.dropbox = new Dropbox({
      accessToken: this.accessToken,
      fetch: fetch,
      selectUser: undefined,
      selectAdmin: undefined,
    });
  }

  async onModuleInit() {
    if (!this.accessToken) {
      this.logger.warn('Dropbox service initialized without access token');
      return;
    }

    try {
      const account = await this.dropbox.usersGetCurrentAccount();
      this.logger.log(
        `Dropbox knowledge base connected: ${account.result.email}`,
      );

      // Try to list root folders to check structure
      await this.listRootFolders();
    } catch (error: any) {
      this.logger.error(
        'Failed to connect to Dropbox knowledge base:',
        (error as Error)?.message || 'Unknown error',
      );
    }
  }

  private hasProblematicCharacters(text: string): boolean {
    // Check for various problematic characters that cause ByteString issues
    const problematicPatterns = [
      /[\u0000-\u001F]/, // Control characters
      /[\uFFFD]/, // Replacement character (indicates encoding issues)
      /[‒–—]/, // Em dash, en dash, figure dash (causes ByteString errors)
      /[""'']/, // Smart quotes
      /[^\x00-\xFF]/, // Characters outside of extended ASCII (>255)
    ];

    const hasProblematic = problematicPatterns.some((pattern) =>
      pattern.test(text),
    );

    if (hasProblematic) {
      this.logger.debug(`Found problematic characters in: ${text}`);
      // Log which character codes are problematic
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const code = char.charCodeAt(0);
        if (code < 32 || code > 255 || code === 65533) {
          this.logger.debug(
            `Problematic char at position ${i}: '${char}' (code: ${code})`,
          );
        }
      }
    }

    return hasProblematic;
  }

  // New method: Normalize path for API calls
  private normalizePath(path: string): string {
    // Replace problematic characters with safe alternatives
    let normalized = path
      // Handle various types of dashes and quotes
      .replace(/[‒–—−]/g, '-') // Replace various dashes with standard dash
      .replace(/[""'']/g, '"') // Replace smart quotes with standard quotes
      .replace(/['']/g, "'") // Replace smart apostrophes
      .replace(/[\u2000-\u206F]/g, ' ') // Replace fancy spaces with regular space
      .replace(/[\u2E00-\u2E7F]/g, '') // Remove supplemental punctuation
      // Handle specific Unicode characters that cause issues
      .replace(/č/g, 'c') // Replace č with c (like in Pogačar)
      .replace(/ć/g, 'c') // Replace ć with c
      .replace(/š/g, 's') // Replace š with s
      .replace(/ž/g, 'z') // Replace ž with z
      .replace(/đ/g, 'd') // Replace đ with d
      // Remove or replace other problematic Unicode characters
      .replace(/[^\x00-\x7F]/g, (char) => {
        const code = char.charCodeAt(0);
        // Keep common extended ASCII characters
        if (code <= 255) return char;
        
        // Replace specific problem characters
        if (code === 8211 || code === 8212 || code === 8213) return '-'; // Various dashes
        if (code === 8220 || code === 8221) return '"'; // Smart quotes
        if (code === 8216 || code === 8217) return "'"; // Smart apostrophes
        if (code === 8230) return '...'; // Ellipsis
        
        // For other characters, try to remove or replace
        this.logger.debug(`Removing problematic character: '${char}' (code: ${code})`);
        return ''; // Remove unknown problematic characters
      })
      .trim();
      
    if (path !== normalized) {
      this.logger.debug(`Path normalization: "${path}" -> "${normalized}"`);
    }
    return normalized;
  }

  // Public method for debugging
  public checkForProblematicCharacters(text: string): boolean {
    return this.hasProblematicCharacters(text);
  }

  async listRootFolders(): Promise<void> {
    try {
      const response = await this.dropbox.filesListFolder({
        path: '',
        recursive: false, // Only top level
        include_media_info: false,
        include_deleted: false,
      });

      const folders = response.result.entries
        .filter((entry) => entry['.tag'] === 'folder')
        .map((entry) => entry.name);

      this.logger.log(`Root folders found: ${folders.join(', ')}`);
    } catch (error: any) {
      this.logger.error(
        'Error listing root folders:',
        (error as Error)?.message || 'Unknown error',
      );
    }
  }

  async getAllDocuments(): Promise<DropboxFile[]> {
    if (!this.accessToken) {
      this.logger.warn('Dropbox access token not configured');
      throw new Error('Dropbox access token not configured');
    }

    const supportedExtensions = [
      '.pdf',
      '.docx',
      '.doc',
      '.txt',
      '.xlsx',
      '.xls',
    ];

    try {
      this.logger.debug('Auto-scanning entire Dropbox for documents...');

      const response = await this.dropbox.filesListFolder({
        path: '',
        recursive: true, // Scan everything recursively
        include_media_info: false,
        include_deleted: false,
        include_has_explicit_shared_members: false,
        include_mounted_folders: false,
      });

      this.logger.debug(
        `Raw response contains ${response.result.entries.length} entries`,
      );

      const documents = response.result.entries
        .filter((entry) => {
          // Only files (not folders)
          if (entry['.tag'] === 'folder') {
            return false;
          }

          // Only supported file types
          const extension = this.getFileExtension(entry.name);
          const isSupported =
            extension && supportedExtensions.includes(extension.toLowerCase());

          if (isSupported) {
            this.logger.debug(
              `Found supported file: ${entry.name} (${extension}) in ${entry.path_lower}`,
            );
          }

          return isSupported;
        })
        .map((entry) => {
          // Type guard to ensure we're working with files
          if (entry['.tag'] !== 'file') {
            this.logger.error(`Expected file entry but got: ${entry['.tag']}`);
            throw new Error('Expected file entry');
          }

          const filePath = (entry as any).path_display || entry.path_lower || '';
          
          // Log path information for debugging
          this.logger.debug(`File: ${entry.name}`);
          this.logger.debug(`  path_display: ${(entry as any).path_display || 'undefined'}`);
          this.logger.debug(`  path_lower: ${entry.path_lower || 'undefined'}`);
          this.logger.debug(`  Using path: ${filePath}`);

          return {
            id: entry.id,
            name: entry.name,
            path: filePath,
            size: entry.size,
            modifiedTime: entry.client_modified,
            extension: this.getFileExtension(entry.name),
          };
        });

      this.logger.log(`Found ${documents.length} documents across all folders`);
      return documents;
    } catch (error) {
      this.logger.error('Error scanning knowledge base:', error);
      throw error;
    }
  }

  async getDocumentsByFolder(): Promise<Record<string, DropboxFile[]>> {
    if (!this.accessToken) {
      throw new Error('Dropbox access token not configured');
    }

    const documents = await this.getAllDocuments();
    const documentsByFolder: Record<string, DropboxFile[]> = {};

    // Group documents by their folder path
    documents.forEach((doc) => {
      const folderPath =
        doc.path.substring(0, doc.path.lastIndexOf('/')) || '/';

      if (!documentsByFolder[folderPath]) {
        documentsByFolder[folderPath] = [];
      }

      documentsByFolder[folderPath].push(doc);
    });

    this.logger.log(
      `Documents organized into ${Object.keys(documentsByFolder).length} folders`,
    );
    return documentsByFolder;
  }

  async getFolderStructure(): Promise<any[]> {
    if (!this.accessToken) {
      throw new Error('Dropbox access token not configured');
    }

    try {
      const response = await this.dropbox.filesListFolder({
        path: '',
        recursive: true,
        include_media_info: false,
        include_deleted: false,
      });

      const folders = new Set<string>();
      const supportedExtensions = [
        '.pdf',
        '.docx',
        '.doc',
        '.txt',
        '.xlsx',
        '.xls',
      ];

      // Extract all unique folder paths that contain supported files
      response.result.entries.forEach((entry) => {
        if (entry['.tag'] === 'file') {
          const extension = this.getFileExtension(entry.name);
          if (
            extension &&
            supportedExtensions.includes(extension.toLowerCase())
          ) {
            const folderPath =
              entry.path_lower?.substring(
                0,
                entry.path_lower.lastIndexOf('/'),
              ) || '/';
            folders.add(folderPath);
          }
        }
      });

      const folderStructure = Array.from(folders).map((folderPath) => {
        const filesInFolder = response.result.entries.filter((entry) => {
          if (entry['.tag'] !== 'file') return false;
          const entryFolder =
            entry.path_lower?.substring(0, entry.path_lower.lastIndexOf('/')) ||
            '/';
          return entryFolder === folderPath;
        });

        const supportedFiles = filesInFolder.filter((file) => {
          const extension = this.getFileExtension(file.name);
          return (
            extension && supportedExtensions.includes(extension.toLowerCase())
          );
        });

        return {
          path: folderPath,
          name: folderPath === '/' ? 'Root' : folderPath.split('/').pop(),
          totalFiles: filesInFolder.length,
          supportedFiles: supportedFiles.length,
          fileNames: supportedFiles.map((f) => f.name),
        };
      });

      return folderStructure.filter((folder) => folder.supportedFiles > 0);
    } catch (error) {
      this.logger.error('Error getting folder structure:', error);
      throw error;
    }
  }

  async downloadDocument(path: string): Promise<DropboxFileContent> {
    if (!this.accessToken) {
      throw new Error('Dropbox access token not configured');
    }

    try {
      this.logger.debug(`Downloading document: ${path}`);

      // Normalize path to handle special characters
      const normalizedPath = this.normalizePath(path);
      this.logger.debug(`Normalized path: ${normalizedPath}`);

      // Try multiple path variations
      const pathsToTry = [path];
      
      // Add normalized path if different
      if (normalizedPath !== path) {
        pathsToTry.push(normalizedPath);
      }
      
      // Add path with URL encoding
      const encodedPath = encodeURI(path);
      if (encodedPath !== path && !pathsToTry.includes(encodedPath)) {
        pathsToTry.push(encodedPath);
      }
      
      // Add path with simple character replacements
      const simplePath = path
        .replace(/–/g, '-')
        .replace(/"/g, '"')
        .replace(/"/g, '"');
      if (simplePath !== path && !pathsToTry.includes(simplePath)) {
        pathsToTry.push(simplePath);
      }
      
      this.logger.debug(`Will try ${pathsToTry.length} path variations for: ${path}`);
      
      // Get file ID from the original file metadata
      let fileId: string | null = null;
      try {
        // Extract file ID from the path - we should have it from getAllDocuments
        const documents = await this.getAllDocuments();
        const matchingFile = documents.find(doc => doc.path === path);
        if (matchingFile) {
          fileId = matchingFile.id;
          this.logger.debug(`Found file ID: ${fileId} for problematic path: ${path}`);
        }
      } catch (error) {
        this.logger.debug(`Could not get file ID: ${(error as Error)?.message}`);
      }

      let lastError: Error | null = null;

                // If we have file ID and the path has problematic characters, try ID first
          if (fileId && this.hasProblematicCharacters(path)) {
            try {
              this.logger.debug(`Trying ID-based download first for problematic path: ${fileId}`);

              // Try different ID formats based on our successful test
              const idsToTry = [
                fileId.startsWith('id:') ? fileId : `id:${fileId}`, // Ensure id: prefix
                fileId, // Original format
                fileId.replace('id:', ''), // Without prefix
              ];

              for (const idToTry of idsToTry) {
                try {
                  const response = await fetch(
                    'https://content.dropboxapi.com/2/files/download',
                    {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${this.accessToken}`,
                        'Dropbox-API-Arg': JSON.stringify({ path: idToTry }),
                        'Content-Type': 'application/octet-stream',
                      },
                    },
                  );

                  if (response.ok) {
                    const metadataHeader = response.headers.get('Dropbox-API-Result');
                    if (metadataHeader) {
                      interface DropboxMetadata {
                        id: string;
                        name: string;
                        path_lower: string;
                        size: number;
                        client_modified: string;
                      }

                      const metadata: DropboxMetadata = JSON.parse(metadataHeader);
                      const arrayBuffer = await response.arrayBuffer();
                      const content = Buffer.from(arrayBuffer);

                      const file: DropboxFile = {
                        id: metadata.id,
                        name: metadata.name,
                        path: metadata.path_lower || '',
                        size: metadata.size,
                        modifiedTime: metadata.client_modified,
                        extension: this.getFileExtension(metadata.name),
                      };

                      this.logger.debug(
                        `Downloaded document by ID (priority): ${metadata.name} (${content.length} bytes) using ID format: ${idToTry}`,
                      );
                      return { file, content };
                    }
                  } else {
                    this.logger.debug(`ID format ${idToTry} failed with status: ${response.status}`);
                  }
                } catch (idError: any) {
                  this.logger.debug(`ID format ${idToTry} failed: ${(idError as Error)?.message}`);
                }
              }
            } catch (idError: any) {
              this.logger.debug(
                `Priority ID download failed: ${(idError as Error)?.message}`,
              );
              lastError = idError;
            }
          }

      for (const currentPath of pathsToTry) {
        try {
          this.logger.debug(`Trying direct API download with path: ${currentPath}`);
          
          // Use direct API (SDK has issues with res.buffer)
          const response = await fetch(
            'https://content.dropboxapi.com/2/files/download',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${this.accessToken}`,
                'Dropbox-API-Arg': JSON.stringify({ path: currentPath }),
                'Content-Type': 'application/octet-stream',
              },
            },
          );

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `Direct API failed - HTTP ${response.status}: ${errorText}`,
            );
          }

          // Get file metadata from headers
          const metadataHeader = response.headers.get('Dropbox-API-Result');
          if (!metadataHeader) {
            throw new Error('No metadata found in response headers');
          }

          interface DropboxMetadata {
            id: string;
            name: string;
            path_lower: string;
            size: number;
            client_modified: string;
          }
          
          const metadata: DropboxMetadata = JSON.parse(metadataHeader);

          // Get file content as buffer
          const arrayBuffer = await response.arrayBuffer();
          const content = Buffer.from(arrayBuffer);

          const file: DropboxFile = {
            id: metadata.id,
            name: metadata.name,
            path: metadata.path_lower || '',
            size: metadata.size,
            modifiedTime: metadata.client_modified,
            extension: this.getFileExtension(metadata.name),
          };

          this.logger.debug(
            `Downloaded document via API: ${metadata.name} (${content.length} bytes)`,
          );
          return { file, content };

        } catch (apiError: any) {
          lastError = apiError;
          const errorMessage = (apiError as Error)?.message || '';
          
          this.logger.debug(
            `API download failed for path "${currentPath}": ${errorMessage}`,
          );
          
          // If it's a 401 error, the file might require special permissions
          if (errorMessage.includes('HTTP 401')) {
            this.logger.warn(`File may require special permissions: ${currentPath}`);
          }
          
          // Continue to next path variation
        }
      }

      // If all paths failed, try downloading by file ID
      if (fileId) {
        try {
          this.logger.debug(`Trying download by file ID: ${fileId}`);
          const response = await this.dropbox.filesDownload({ path: `id:${fileId}` });
          
          const resultWithBinary = response.result as any;
          if (response.result && resultWithBinary.fileBinary) {
            const content = Buffer.from(resultWithBinary.fileBinary as Uint8Array);
            const metadata = response.result;

            const file: DropboxFile = {
              id: metadata.id,
              name: metadata.name,
              path: metadata.path_lower || '',
              size: metadata.size,
              modifiedTime: metadata.client_modified,
              extension: this.getFileExtension(metadata.name),
            };

            this.logger.debug(
              `Downloaded document by ID: ${metadata.name} (${content.length} bytes)`,
            );
            return { file, content };
          }
        } catch (idError: any) {
          this.logger.debug(
            `Download by ID failed: ${(idError as Error)?.message}`,
          );
          lastError = idError;
        }
      }

      // If we get here, all methods failed
      throw lastError || new Error(`Failed to download file: ${path}`);
    } catch (error: any) {
      this.logger.error(
        `Error downloading document ${path}:`,
        (error as Error)?.message || 'Unknown error',
      );
      throw error;
    }
  }

  async downloadAllDocuments(): Promise<DropboxFileContent[]> {
    const documents = await this.getAllDocuments();
    const results: DropboxFileContent[] = [];

    this.logger.log(
      `Downloading ${documents.length} documents from knowledge base...`,
    );

    for (const doc of documents) {
      try {
        const content = await this.downloadDocument(doc.path);
        results.push(content);
        this.logger.debug(`Successfully downloaded: ${doc.name}`);
      } catch (error: any) {
        this.logger.error(
          `Failed to download ${doc.path}: ${(error as Error)?.message}`,
        );

        // Check if it's a Unicode encoding issue
        const errorMessage = (error as Error)?.message || '';
        if (
          errorMessage.includes('ByteString') ||
          errorMessage.includes('unsupported characters') ||
          errorMessage.includes('problematic characters')
        ) {
          this.logger.warn(`Skipping file with encoding issues: ${doc.name}`);
        }

        // Continue with other documents instead of stopping the whole process
        continue;
      }
    }

    this.logger.log(
      `Successfully downloaded ${results.length} out of ${documents.length} documents`,
    );
    return results;
  }

  // New method: Process documents one by one (more efficient)
  async processDocumentsIteratively(
    processor: (fileContent: DropboxFileContent) => Promise<void>,
  ): Promise<{
    processed: number;
    failed: number;
    skipped: number;
    details: Array<{
      filename: string;
      status: 'success' | 'failed' | 'skipped';
      error?: string;
    }>;
  }> {
    const documents = await this.getAllDocuments();
    const results = {
      processed: 0,
      failed: 0,
      skipped: 0,
      details: [] as Array<{
        filename: string;
        status: 'success' | 'failed' | 'skipped';
        error?: string;
      }>,
    };

    this.logger.log(
      `Processing ${documents.length} documents iteratively...`,
    );

    for (const doc of documents) {
      try {
        // Log if file has problematic characters, but still attempt processing
        if (
          this.hasProblematicCharacters(doc.path) ||
          this.hasProblematicCharacters(doc.name)
        ) {
          this.logger.debug(
            `File has problematic characters, but will attempt ID-based download: ${doc.name}`,
          );
        }

        // Download and process one document at a time
        const fileContent = await this.downloadDocument(doc.path);
        await processor(fileContent);
        
        results.processed++;
        results.details.push({
          filename: doc.name,
          status: 'success',
        });
        
        this.logger.debug(`Successfully processed: ${doc.name}`);
      } catch (error: any) {
        this.logger.error(
          `Failed to process ${doc.path}: ${error?.message || 'Unknown error'}`,
        );
        
        results.failed++;
        results.details.push({
          filename: doc.name,
          status: 'failed',
          error: (error as Error)?.message || 'Unknown error',
        });
      }
    }

    this.logger.log(
      `Processing completed: ${results.processed} processed, ${results.failed} failed, ${results.skipped} skipped`,
    );
    return results;
  }

  private getFileExtension(filename: string): string | undefined {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot) : undefined;
  }

  isConfigured(): boolean {
    return !!this.accessToken;
  }

  async testConnection(): Promise<{
    connected: boolean;
    email?: string;
    error?: string;
  }> {
    if (!this.accessToken) {
      return { connected: false, error: 'Access token not configured' };
    }

    try {
      const account = await this.dropbox.usersGetCurrentAccount();
      return {
        connected: true,
        email: account.result.email,
      };
    } catch (error) {
      return {
        connected: false,
        error: (error as Error)?.message || 'Unknown error',
      };
    }
  }

  getSupportedExtensions(): string[] {
    return ['.pdf', '.docx', '.doc', '.txt', '.xlsx', '.xls'];
  }
}
