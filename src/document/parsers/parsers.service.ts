import { Injectable, Logger } from '@nestjs/common';
import * as pdf from 'pdf-parse';
import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth';
import * as StreamZip from 'node-stream-zip';

export interface ParsedDocument {
  content: string;
  metadata: {
    filename: string;
    type: string;
    pages?: number;
    sheets?: string[];
    size: number;
    extension: string;
    parseTime: number;
    wordCount: number;
  };
  rawContent?: any; // For complex documents
}

export interface ParseResult {
  success: boolean;
  document?: ParsedDocument;
  error?: string;
}

@Injectable()
export class ParsersService {
  private readonly logger = new Logger(ParsersService.name);

  async parseDocument(buffer: Buffer, filename: string): Promise<ParseResult> {
    const startTime = Date.now();
    const extension = this.getFileExtension(filename).toLowerCase();

    this.logger.log(`Starting to parse: ${filename} (${extension})`);

    try {
      let result: ParsedDocument;

      switch (extension) {
        case '.pdf':
          result = await this.parsePDF(buffer, filename);
          break;
        case '.xlsx':
        case '.xls':
          result = await this.parseExcel(buffer, filename);
          break;
        case '.docx':
          result = await this.parseDocx(buffer, filename);
          break;
        case '.doc':
          result = await this.parseDoc(buffer, filename);
          break;
        case '.txt':
          result = await this.parseText(buffer, filename);
          break;
        case '.zip':
          result = await this.parseZip(buffer, filename);
          break;
        default:
          throw new Error(`Unsupported file type: ${extension}`);
      }

      const parseTime = Date.now() - startTime;
      result.metadata.parseTime = parseTime;
      result.metadata.wordCount = this.countWords(result.content);

      this.logger.log(
        `Successfully parsed ${filename} in ${parseTime}ms (${result.metadata.wordCount} words)`,
      );

      return {
        success: true,
        document: result,
      };
    } catch (error) {
      const parseTime = Date.now() - startTime;
      this.logger.error(
        `Failed to parse ${filename} after ${parseTime}ms:`,
        error.message,
      );

      return {
        success: false,
        error: error.message,
      };
    }
  }

  private async parsePDF(
    buffer: Buffer,
    filename: string,
  ): Promise<ParsedDocument> {
    try {
      this.logger.debug(`Parsing PDF: ${filename}`);

      const data = await pdf(buffer, {
        // Remove invalid options for pdf-parse
        // normalizeWhitespace: true,
        // disableCombineTextItems: false,
      });

      return {
        content: data.text,
        metadata: {
          filename,
          type: 'pdf',
          pages: data.numpages,
          size: buffer.length,
          extension: '.pdf',
          parseTime: 0, // Will be set later
          wordCount: 0, // Will be set later
        },
        rawContent: {
          info: data.info,
          metadata: data.metadata,
          version: data.version,
        },
      };
    } catch (error) {
      throw new Error(`PDF parsing failed: ${error.message}`);
    }
  }

  private async parseExcel(
    buffer: Buffer,
    filename: string,
  ): Promise<ParsedDocument> {
    try {
      this.logger.debug(`Parsing Excel: ${filename}`);

      const workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
        cellNF: false,
        cellText: false,
      });

      const sheetNames = workbook.SheetNames;
      let content = '';
      const sheetData: any = {};

      sheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];

        // Convert to JSON for structured data
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
          blankrows: false,
        });

        sheetData[sheetName] = jsonData;

        // Convert to text for content search
        content += `\n=== Sheet: ${sheetName} ===\n`;
        jsonData.forEach((row: any[]) => {
          if (row.length > 0) {
            const rowText = row
              .map((cell) => cell?.toString().trim() || '')
              .filter((cell) => cell.length > 0)
              .join(' | ');

            if (rowText.length > 0) {
              content += rowText + '\n';
            }
          }
        });
      });

      return {
        content: content.trim(),
        metadata: {
          filename,
          type: 'excel',
          sheets: sheetNames,
          size: buffer.length,
          extension: this.getFileExtension(filename),
          parseTime: 0,
          wordCount: 0,
        },
        rawContent: {
          workbook: sheetData,
          sheetNames,
        },
      };
    } catch (error) {
      throw new Error(`Excel parsing failed: ${error.message}`);
    }
  }

  private async parseDocx(
    buffer: Buffer,
    filename: string,
  ): Promise<ParsedDocument> {
    try {
      this.logger.debug(`Parsing DOCX: ${filename}`);

      const result = await mammoth.extractRawText({ buffer });

      if (result.messages.length > 0) {
        this.logger.warn(
          `DOCX parsing warnings for ${filename}:`,
          result.messages,
        );
      }

      return {
        content: result.value,
        metadata: {
          filename,
          type: 'docx',
          size: buffer.length,
          extension: '.docx',
          parseTime: 0,
          wordCount: 0,
        },
      };
    } catch (error) {
      throw new Error(`DOCX parsing failed: ${error.message}`);
    }
  }

  private async parseDoc(
    buffer: Buffer,
    filename: string,
  ): Promise<ParsedDocument> {
    // For .doc files, we'll use a basic approach
    // In production, you might want to use a more sophisticated parser
    this.logger.warn(`Basic parsing for legacy DOC file: ${filename}`);

    try {
      // Try to extract text using mammoth (might work for some .doc files)
      const result = await mammoth.extractRawText({ buffer });
      return {
        content: result.value,
        metadata: {
          filename,
          type: 'doc',
          size: buffer.length,
          extension: '.doc',
          parseTime: 0,
          wordCount: 0,
        },
      };
    } catch (error) {
      // Fallback: treat as binary and extract readable text
      const text = buffer.toString('utf8').replace(/[^\x20-\x7E\n\r]/g, ' ');
      return {
        content: text.replace(/\s+/g, ' ').trim(),
        metadata: {
          filename,
          type: 'doc',
          size: buffer.length,
          extension: '.doc',
          parseTime: 0,
          wordCount: 0,
        },
      };
    }
  }

  private async parseText(
    buffer: Buffer,
    filename: string,
  ): Promise<ParsedDocument> {
    try {
      this.logger.debug(`Parsing text file: ${filename}`);

      const content = buffer.toString('utf8');

      return {
        content,
        metadata: {
          filename,
          type: 'text',
          size: buffer.length,
          extension: '.txt',
          parseTime: 0,
          wordCount: 0,
        },
      };
    } catch (error) {
      throw new Error(`Text parsing failed: ${error.message}`);
    }
  }

  private async parseZip(
    buffer: Buffer,
    filename: string,
  ): Promise<ParsedDocument> {
    try {
      this.logger.debug(`Parsing ZIP archive: ${filename}`);

      // Write buffer to temporary file for node-stream-zip
      const fs = require('fs');
      const path = require('path');
      const os = require('os');

      const tempFilePath = path.join(
        os.tmpdir(),
        `temp_${Date.now()}_${filename}`,
      );

      try {
        // Write buffer to temp file
        fs.writeFileSync(tempFilePath, buffer);

        const zip = new StreamZip.async({
          file: tempFilePath,
          storeEntries: true,
        });

        const entries = await zip.entries();
        let content = '';
        const extractedFiles: string[] = [];

        for (const entry of Object.values(entries)) {
          if (!entry.isDirectory) {
            const entryExtension = this.getFileExtension(
              entry.name,
            ).toLowerCase();

            // Only process supported file types
            if (
              ['.pdf', '.docx', '.doc', '.txt', '.xlsx', '.xls'].includes(
                entryExtension,
              )
            ) {
              try {
                this.logger.debug(`Extracting from ZIP: ${entry.name}`);

                const entryData = await zip.entryData(entry);
                const parsed = await this.parseDocument(entryData, entry.name);

                if (parsed.success && parsed.document) {
                  content += `\n=== File: ${entry.name} ===\n${parsed.document.content}\n`;
                  extractedFiles.push(entry.name);
                }
              } catch (error) {
                this.logger.warn(
                  `Failed to extract ${entry.name} from ZIP: ${error.message}`,
                );
              }
            } else {
              this.logger.debug(
                `Skipping unsupported file in ZIP: ${entry.name}`,
              );
            }
          }
        }

        await zip.close();

        return {
          content: content.trim(),
          metadata: {
            filename,
            type: 'zip',
            size: buffer.length,
            extension: '.zip',
            parseTime: 0,
            wordCount: 0,
          },
          rawContent: {
            extractedFiles,
            totalEntries: Object.keys(entries).length,
          },
        };
      } finally {
        // Clean up temp file
        try {
          fs.unlinkSync(tempFilePath);
        } catch (cleanupError) {
          this.logger.warn(
            `Failed to cleanup temp file: ${cleanupError.message}`,
          );
        }
      }
    } catch (error) {
      throw new Error(`ZIP parsing failed: ${error.message}`);
    }
  }

  private getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot) : '';
  }

  private countWords(text: string): number {
    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
  }

  // Text chunking for RAG
  chunkText(
    text: string,
    maxChunkSize: number = 1000,
    overlap: number = 200,
  ): string[] {
    if (text.length <= maxChunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    let startIndex = 0;

    while (startIndex < text.length) {
      let endIndex = Math.min(startIndex + maxChunkSize, text.length);

      // Try to break at sentence boundary
      if (endIndex < text.length) {
        const lastSentence = text.lastIndexOf('.', endIndex);
        const lastNewline = text.lastIndexOf('\n', endIndex);
        const breakPoint = Math.max(lastSentence, lastNewline);

        if (breakPoint > startIndex + maxChunkSize * 0.5) {
          endIndex = breakPoint + 1;
        }
      }

      const chunk = text.substring(startIndex, endIndex).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      startIndex = Math.max(endIndex - overlap, startIndex + 1);
    }

    return chunks.filter((chunk) => chunk.length > 50); // Remove very short chunks
  }

  getSupportedExtensions(): string[] {
    return ['.pdf', '.docx', '.doc', '.txt', '.xlsx', '.xls', '.zip'];
  }

  async batchParseDocuments(
    documents: Array<{ buffer: Buffer; filename: string }>,
  ): Promise<ParseResult[]> {
    this.logger.log(`Starting batch parsing of ${documents.length} documents`);

    const results: ParseResult[] = [];

    for (const doc of documents) {
      const result = await this.parseDocument(doc.buffer, doc.filename);
      results.push(result);
    }

    const successful = results.filter((r) => r.success).length;
    this.logger.log(
      `Batch parsing completed: ${successful}/${documents.length} successful`,
    );

    return results;
  }
}
