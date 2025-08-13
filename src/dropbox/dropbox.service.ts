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
    } catch (error) {
      this.logger.error(
        'Failed to connect to Dropbox knowledge base:',
        error.message,
      );
    }
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
    } catch (error) {
      this.logger.error('Error listing root folders:', error.message);
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

          return {
            id: entry.id,
            name: entry.name,
            path: entry.path_lower || '',
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

      const response = await this.dropbox.filesDownload({ path });

      // Type assertion for the response
      const result = response.result as any;
      const fileBlob = result.fileBinary;
      const metadata = result as {
        id: string;
        name: string;
        path_lower: string;
        size: number;
        client_modified: string;
      };

      // Convert to Buffer
      const arrayBuffer = await fileBlob.arrayBuffer();
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
        `Downloaded document: ${metadata.name} (${metadata.size} bytes)`,
      );
      return { file, content };
    } catch (error) {
      this.logger.error(`Error downloading document ${path}:`, error.message);
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
      } catch (error) {
        this.logger.error(`Failed to download ${doc.path}:`, error.message);
        // Continue with other documents
      }
    }

    this.logger.log(`Successfully downloaded ${results.length} documents`);
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
        error: error.message,
      };
    }
  }

  getSupportedExtensions(): string[] {
    return ['.pdf', '.docx', '.doc', '.txt', '.xlsx', '.xls'];
  }
}
