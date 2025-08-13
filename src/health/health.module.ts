import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DropboxModule } from '../dropbox/dropbox.module';

@Module({
  imports: [DropboxModule],
  controllers: [HealthController],
})
export class HealthModule {}
