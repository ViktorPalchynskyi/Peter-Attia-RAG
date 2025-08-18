import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { DocumentsModule } from '../document/document.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [DocumentsModule, PrismaModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
