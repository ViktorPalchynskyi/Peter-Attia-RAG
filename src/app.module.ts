import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { TelegramModule } from './telegram/telegram.module';
import { DropboxModule } from './dropbox/dropbox.module';
import { DocumentsModule } from './document/document.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    HealthModule,
    TelegramModule,
    DropboxModule,
    DocumentsModule,
  ],
})
export class AppModule {}
