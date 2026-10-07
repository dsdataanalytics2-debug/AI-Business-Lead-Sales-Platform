import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { httpLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { NotFoundError } from './lib/errors.js';
import { authRouter } from './routes/auth.routes.js';
import { userRouter } from './routes/user.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { businessSearchRouter } from './routes/business-search.routes.js';
import { leadRouter } from './routes/lead.routes.js';
import { metaWhatsAppWebhookRouter } from './routes/meta-webhook.routes.js';

export function createApp(): Express {
  const app = express();

  // Basic security and parsing middlewares
  app.use(
    cors({
      origin: env.APP_BASE_URL,
      credentials: true
    })
  );
  app.use(cookieParser());
  // Request ID & Structured Logging
  app.use(requestIdMiddleware);
  app.use(httpLogger);

  // Dedicated Webhook routes (provider-specific route with dedicated raw-body parsing)
  app.use('/api/v1/webhooks/meta/whatsapp', metaWhatsAppWebhookRouter);

  // Application body parsing (normal JSON parser for application routes, WITHOUT rawBody attachment)
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health check routes
  app.use('/health', healthRouter);
  app.use('/api/v1/health', healthRouter);

  // API v1 module routes
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', userRouter);
  app.use('/api/v1/business-search', businessSearchRouter);
  app.use('/api/v1/leads', leadRouter);

  // 404 handler
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
  });

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
