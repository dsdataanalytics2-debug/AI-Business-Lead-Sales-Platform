import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import prisma, { Role } from '@leadmate/db';
import { ErrorCodes, Permissions } from '@leadmate/shared';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { resetLoginRateLimiter } from '../middleware/rate-limiter.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';

describe('Step 5 Behavioral Verification: AUTH, RBAC, Sessions & Rate Limiting', () => {
  let orgId: string;
  const testAdminEmail = 'admin@example.com';
  const testAdminPassword = 'Admin12345!SecurePass';

  const viewerEmail = 'viewer@example.com';
  const viewerPassword = 'Viewer12345!SecurePass';
  let viewerUserId: string;

  beforeAll(async () => {
    // Ensure default organization exists
    const org = await prisma.organization.upsert({
      where: { id: '00000000-0000-0000-0000-000000000001' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'LeadMate Default Org',
        timezone: 'Asia/Dhaka'
      }
    });
    orgId = org.id;

    // Create / ensure super admin user exists
    const adminHash = await hashPassword(testAdminPassword);
    await prisma.user.upsert({
      where: { email: testAdminEmail },
      update: { passwordHash: adminHash, role: Role.SUPER_ADMIN, organizationId: orgId, isActive: true },
      create: { email: testAdminEmail, passwordHash: adminHash, name: 'Super Admin', role: Role.SUPER_ADMIN, organizationId: orgId, isActive: true }
    });

    // Create a VIEWER user for RBAC testing
    const viewerHash = await hashPassword(viewerPassword);
    const viewer = await prisma.user.upsert({
      where: { email: viewerEmail },
      update: { passwordHash: viewerHash, role: Role.VIEWER, organizationId: orgId, isActive: true },
      create: { email: viewerEmail, passwordHash: viewerHash, name: 'Viewer User', role: Role.VIEWER, organizationId: orgId, isActive: true }
    });
    viewerUserId = viewer.id;
  });

  beforeEach(() => {
    resetLoginRateLimiter();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. Valid login -> 200 + httpOnly session cookie + sanitized user payload', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testAdminEmail, password: testAdminPassword });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.user.email).toBe(testAdminEmail);
    expect(res.body.data.user.role).toBe(Role.SUPER_ADMIN);
    expect(res.body.data.permissions).toContain(Permissions.USERS_MANAGE);
    expect(res.body.data.user.passwordHash).toBeUndefined();

    // Verify Cookie
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Lax');
  });

  it('2. Invalid credentials -> 401 UNAUTHENTICATED + standard error contract with requestId', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testAdminEmail, password: 'WrongPassword123!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    expect(res.body.error.message).toBe('Invalid email or password');
    expect(res.body.error.requestId).toBeDefined();
  });

  it('3. Missing session on protected route -> 401 UNAUTHENTICATED', async () => {
    const res = await request(app).get('/api/v1/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    expect(res.body.error.requestId).toBeDefined();
  });

  it('4. GET /api/v1/auth/me with valid session cookie -> 200 + current user & permissions', async () => {
    // Login first to get cookie
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testAdminEmail, password: testAdminPassword });

    const cookie = loginRes.headers['set-cookie'];

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.email).toBe(testAdminEmail);
    expect(meRes.body.data.user.role).toBe(Role.SUPER_ADMIN);
    expect(meRes.body.data.permissions).toContain(Permissions.USERS_MANAGE);
  });

  it('5. Insufficient RBAC permission -> 403 FORBIDDEN (Viewer accessing users:manage route)', async () => {
    // Login as VIEWER
    const viewerLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: viewerEmail, password: viewerPassword });

    const viewerCookie = viewerLogin.headers['set-cookie'];

    // Attempt to access user management endpoint (requires users:manage)
    const userListRes = await request(app)
      .get('/api/v1/users')
      .set('Cookie', viewerCookie);

    expect(userListRes.status).toBe(403);
    expect(userListRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    expect(userListRes.body.error.message).toContain('users:manage');
    expect(userListRes.body.error.requestId).toBeDefined();
  });

  it('6. Rate limiting exceeded -> 429 RATE_LIMITED after 5 attempts in 15 minutes', async () => {
    const testIp = '198.51.100.42';

    // Make 5 attempts (allowed)
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', testIp)
        .send({ email: 'fake@example.com', password: 'FakePassword123!' });
      expect(res.status).toBe(401);
    }

    // 6th attempt must be blocked by rate limiter
    const rateLimitedRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', testIp)
      .send({ email: 'fake@example.com', password: 'FakePassword123!' });

    expect(rateLimitedRes.status).toBe(429);
    expect(rateLimitedRes.body.error.code).toBe(ErrorCodes.RATE_LIMITED);
    expect(rateLimitedRes.headers['retry-after']).toBeDefined();
  });

  it('7. Logout -> server-side session deleted from PostgreSQL and cookie cleared', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testAdminEmail, password: testAdminPassword });

    const cookie = loginRes.headers['set-cookie'];
    const rawToken = cookie[0].split(';')[0].split('=')[1];
    const tokenHash = hashSessionToken(rawToken);

    // Verify session row exists in DB
    const sessionInDb = await prisma.session.findUnique({ where: { tokenHash } });
    expect(sessionInDb).toBeDefined();

    // Perform Logout
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.data.success).toBe(true);

    // Verify session row was deleted from DB
    const sessionAfterLogout = await prisma.session.findUnique({ where: { tokenHash } });
    expect(sessionAfterLogout).toBeNull();
  });

  it('8. Reused old cookie after logout -> 401 UNAUTHENTICATED', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testAdminEmail, password: testAdminPassword });

    const cookie = loginRes.headers['set-cookie'];

    // Logout
    await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);

    // Re-use same cookie on /auth/me
    const reusedRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookie);

    expect(reusedRes.status).toBe(401);
    expect(reusedRes.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
  });

  it('9. Expired session token in PostgreSQL -> 401 UNAUTHENTICATED', async () => {
    const rawToken = 'expired-test-token-value-1234567890';
    const tokenHash = hashSessionToken(rawToken);

    // Create intentionally expired session in PostgreSQL (expired yesterday)
    await prisma.session.create({
      data: {
        userId: viewerUserId,
        tokenHash,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${rawToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
  });

  it('10. Health check -> GET /health returns 200 with DB status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(res.body.db).toBe('connected');
    expect(res.body.uptime).toBeTypeOf('number');
  });
});
