import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import prisma, { Role } from '@leadmate/db';
import { ensureTestDatabase } from './helpers/test-db-guard.js';
import { app } from '../../../api/src/app.js';
import { hashPassword } from '../../../api/src/lib/crypto.js';
import { resetLoginRateLimiter } from '../../../api/src/middleware/rate-limiter.js';
import { apiClient, ApiClientError } from '../lib/api-client.js';

describe('Step 7 Behavioral & Integration Verification: Web Auth, API Client & Security', () => {
  let server: http.Server;
  let serverPort: number;
  let orgId: string;

  const adminEmail = 'admin@example.com';
  const adminPassword = 'Admin12345!SecurePass';

  beforeAll(async () => {
    // Strict Safety Guard: Confirm connected PostgreSQL database name ENDS WITH "_test"
    await ensureTestDatabase(prisma);

    // Start backend API server for live fetch tests
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          serverPort = addr.port;
          // Set environment variable for API client
          process.env.NEXT_PUBLIC_API_URL = `http://localhost:${serverPort}/api/v1`;
        }
        resolve();
      });
    });

    // Ensure default organization and admin user exist in PostgreSQL
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

    const adminHash = await hashPassword(adminPassword);
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash: adminHash, role: Role.SUPER_ADMIN, organizationId: orgId, isActive: true },
      create: { email: adminEmail, passwordHash: adminHash, name: 'Super Admin', role: Role.SUPER_ADMIN, organizationId: orgId, isActive: true }
    });
  });

  beforeEach(() => {
    resetLoginRateLimiter();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. Web Security Audit: Confirm zero localStorage/sessionStorage usage for tokens', () => {
    const webSrcDir = path.resolve(__dirname, '..');
    const allFiles: string[] = [];

    function scanDir(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '.next') {
            scanDir(fullPath);
          }
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js')) {
          allFiles.push(fullPath);
        }
      }
    }

    scanDir(webSrcDir);

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/localStorage\.setItem\s*\(\s*['"`](?:token|session|auth|jwt)/i);
      expect(content).not.toMatch(/sessionStorage\.setItem\s*\(\s*['"`](?:token|session|auth|jwt)/i);
      expect(content).not.toMatch(/document\.cookie/i);
    }
  });

  it('2. Web Security Audit: Confirm credentials: "include" is strictly configured in api-client', () => {
    const apiClientPath = path.resolve(__dirname, '../lib/api-client.ts');
    const content = fs.readFileSync(apiClientPath, 'utf-8');
    expect(content).toContain("credentials: 'include'");
  });

  it('3. Web Unicode / Bangla Support: Confirm UTF-8 Bangla strings exist without corruption', () => {
    const loginPagePath = path.resolve(__dirname, '../app/login/page.tsx');
    const dashboardPagePath = path.resolve(__dirname, '../app/dashboard/page.tsx');
    
    const loginContent = fs.readFileSync(loginPagePath, 'utf-8');
    const dashboardContent = fs.readFileSync(dashboardPagePath, 'utf-8');

    expect(loginContent).toContain('বাংলা / English');
    expect(dashboardContent).toContain('স্বাগতম');
  });

  it('4. API Client: Valid login -> returns user, role and permissions', async () => {
    // Perform login via live HTTP request using node fetch with cookie tracking
    const loginUrl = `http://localhost:${serverPort}/api/v1/auth/login`;
    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('leadmate_session=');
    expect(setCookie?.toLowerCase()).toContain('httponly');

    const json = (await res.json()) as any;
    expect(json.data.user.email).toBe(adminEmail);
    expect(json.data.user.role).toBe(Role.SUPER_ADMIN);
    expect(Array.isArray(json.data.permissions)).toBe(true);
    expect(json.data.permissions.length).toBeGreaterThan(0);
  });

  it('5. API Client: Invalid login credentials -> returns 401 with safe error and requestId', async () => {
    const loginUrl = `http://localhost:${serverPort}/api/v1/auth/login`;
    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'WrongPassword123!' })
    });

    expect(res.status).toBe(401);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe('UNAUTHENTICATED');
    expect(json.error.message).toBe('Invalid email or password');
    expect(json.error.requestId).toBeDefined();
  });

  it('6. Unauthenticated /auth/me bootstrap -> returns 401', async () => {
    const meUrl = `http://localhost:${serverPort}/api/v1/auth/me`;
    const res = await fetch(meUrl, { method: 'GET' });
    expect(res.status).toBe(401);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('7. Authenticated /auth/me bootstrap -> returns user payload with valid cookie', async () => {
    // 1. Login to get cookie
    const loginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    const cookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';
    expect(cookie).toContain('leadmate_session=');

    // 2. Call /auth/me with the session cookie
    const meRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/me`, {
      method: 'GET',
      headers: { Cookie: cookie }
    });

    expect(meRes.status).toBe(200);
    const meJson = (await meRes.json()) as any;
    expect(meJson.data.user.email).toBe(adminEmail);
    expect(meJson.data.user.role).toBe('SUPER_ADMIN');
    expect(meJson.data.permissions).toContain('users:manage');
  });

  it('8. Logout -> server session invalidated and old session rejected', async () => {
    // 1. Login
    const loginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    const cookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';

    // 2. Logout with that session cookie
    const logoutRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    expect(logoutRes.status).toBe(200);

    // 3. Attempt to access /auth/me with old session cookie -> MUST be 401
    const meRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/me`, {
      method: 'GET',
      headers: { Cookie: cookie }
    });
    expect(meRes.status).toBe(401);
    const meJson = (await meRes.json()) as any;
    expect(meJson.error.code).toBe('UNAUTHENTICATED');
  });
});
