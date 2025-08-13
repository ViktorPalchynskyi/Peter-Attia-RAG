import { Module } from '@nestjs/common';
import { DropboxController } from './dropbox.controller';
import { DropboxService } from './dropbox.service';

@Module({
  controllers: [DropboxController],
  providers: [DropboxService],
  exports: [DropboxService],
})
export class DropboxModule {}
