import { Module } from '@nestjs/common';
import { DocumentsController } from './document.controller';
import { DocumentsService } from './document.service';
import { ParsersService } from './parsers/parsers.service';
import { SearchService } from './services/search.service';
import { EmbeddingService } from './services/embedding.service';
import { RagService } from './services/rag.service';
import { DropboxModule } from '../dropbox/dropbox.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [DropboxModule, PrismaModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, ParsersService, SearchService, EmbeddingService, RagService],
  exports: [DocumentsService, ParsersService, SearchService, EmbeddingService, RagService],
})
export class DocumentsModule {}
