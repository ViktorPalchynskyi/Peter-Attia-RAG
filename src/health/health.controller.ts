import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Health Check')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Service helath checkout' })
  @ApiResponse({
    status: 200,
    description: 'Service is working correctly',
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

  @Get('ping')
  @ApiOperation({ summary: 'Check' })
  @ApiResponse({ status: 200, description: 'Pong' })
  ping() {
    return { message: 'pong', timestamp: new Date().toISOString() };
  }
}
