import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppConfigService } from './config/app-config.service';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // API versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Input validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // OpenAPI/Swagger documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Wallet Microservice API')
    .setDescription(
      'Event-driven wallet microservice with saga orchestration, ' +
      'transactional outbox pattern, and comprehensive audit trails.',
    )
    .setVersion('1.0')
    .addTag('wallet', 'Wallet operations (deposit, withdraw, transfer)')
    .addTag('health', 'Health check endpoints')
    .addApiKey(
      { type: 'apiKey', name: 'X-Request-ID', in: 'header' },
      'idempotency-key',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  const configService = app.get(AppConfigService);

  // Initialize RabbitMQ connection is handled by EventPublisher onModuleInit
  logger.log('RabbitMQ connection initialized by EventPublisher');

  const port = configService.port;
  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`Swagger documentation: http://localhost:${port}/api`);
}

bootstrap();
