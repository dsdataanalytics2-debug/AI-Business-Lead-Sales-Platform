import pino from 'pino';
import pinoHttp from 'pino-http';
import { Request } from 'express';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["set-cookie"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.tokenHash',
      '*.rawToken',
      '*.secret',
      '*.leadmate_session'
    ],
    censor: '[REDACTED]'
  }
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req: Request) => req.id || 'unknown',
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode
      };
    }
  }
});
