import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { loginRateLimiter } from '../middleware/rate-limiter.js';

export const authRouter = Router();

authRouter.post('/login', loginRateLimiter, (req, res, next) => authController.login(req, res, next));
authRouter.post('/logout', requireAuth, (req, res, next) => authController.logout(req, res, next));
authRouter.get('/me', requireAuth, (req, res, next) => authController.me(req, res, next));
