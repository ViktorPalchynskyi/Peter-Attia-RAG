import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Health Check')
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Check service health status' })
  @ApiResponse({
    status: 200,
    description: 'Service is running correctly',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', example: '2025-01-15T10:30:00.000Z' },
        uptime: { type: 'number', example: 1234.567 },
        version: { type: 'string', example: '1.0.0' },
        environment: { type: 'string', example: 'development' },
        services: {
          type: 'object',
          properties: {
            database: { type: 'string', example: 'connected' },
            openai: { type: 'string', example: 'available' },
            telegram: { type: 'string', example: 'configured' },
          },
        },
      },
    },
  })
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: process.env.DATABASE_URL ? 'configured' : 'not configured',
        openai: process.env.OPENAI_API_KEY ? 'configured' : 'not configured',
        telegram: process.env.TELEGRAM_BOT_TOKEN
          ? 'configured'
          : 'not configured',
      },
    };
  }

  @Get('database')
  @ApiOperation({ summary: 'Check database connectivity' })
  @ApiResponse({ status: 200, description: 'Database is accessible' })
  async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      // Check pgvector
      const vectorCheck = await this.prisma.$queryRaw`
        SELECT extname, extversion 
        FROM pg_extension 
        WHERE extname = 'vector'
      `;

      return {
        status: 'connected',
        timestamp: new Date().toISOString(),
        pgvector:
          Array.isArray(vectorCheck) && vectorCheck.length > 0
            ? `enabled (${(vectorCheck[0] as any).extversion})`
            : 'not enabled',
      };
    } catch (error) {
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  @Get('ping')
  @ApiOperation({ summary: 'Simple availability check' })
  @ApiResponse({ status: 200, description: 'Pong' })
  ping() {
    return { message: 'pong', timestamp: new Date().toISOString() };
  }
}
