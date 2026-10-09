import { PrismaClient, Role, DataSourceRole, DataSourceStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database (idempotent)...');

  const adminEmail = process.env.SEED_SUPER_ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD || 'Admin12345!SecurePass';
  const defaultTimezone = process.env.DEFAULT_TIMEZONE || 'Asia/Dhaka';

  if (!adminPassword || adminPassword.length < 10) {
    throw new Error('SEED_SUPER_ADMIN_PASSWORD must be set in .env with at least 10 characters.');
  }

  // 1. Upsert default organization
  const defaultOrg = await prisma.organization.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {
      name: 'LeadMate Default Org',
      timezone: defaultTimezone
    },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'LeadMate Default Org',
      timezone: defaultTimezone,
      workingDays: [0, 1, 2, 3, 4],
      workStart: '10:00',
      workEnd: '18:00'
    }
  });

  // 2. Hash password with Argon2id
  const passwordHash = await argon2.hash(adminPassword, {
    type: argon2.argon2id
  });

  // 3. Upsert Super Admin User
  const superAdmin = await prisma.user.upsert({
    where: { email: adminEmail.toLowerCase() },
    update: {
      name: 'Super Admin',
      role: Role.SUPER_ADMIN,
      organizationId: defaultOrg.id,
      isActive: true
    },
    create: {
      email: adminEmail.toLowerCase(),
      passwordHash,
      name: 'Super Admin',
      role: Role.SUPER_ADMIN,
      organizationId: defaultOrg.id,
      isActive: true
    }
  });

  // 4. Upsert Default DataSourceConfigs (Mock & CSV)
  const existingMock = await prisma.dataSourceConfig.findFirst({
    where: { name: 'mock', organizationId: null }
  });
  if (existingMock) {
    await prisma.dataSourceConfig.update({
      where: { id: existingMock.id },
      data: {
        provider: 'mock',
        role: DataSourceRole.BOTH,
        status: DataSourceStatus.APPROVED,
        isEnabled: true
      }
    });
  } else {
    await prisma.dataSourceConfig.create({
      data: {
        name: 'mock',
        provider: 'mock',
        role: DataSourceRole.BOTH,
        status: DataSourceStatus.APPROVED,
        isEnabled: true,
        persistencePolicy: { persistFields: ['all'] },
        refreshPolicy: { refreshAfterDays: 30 },
        rateLimitConfig: { perSecond: 10, perDay: 1000 },
        pricing: { unitCostMinor: 0, currency: 'BDT' }
      }
    });
  }

  const existingCsv = await prisma.dataSourceConfig.findFirst({
    where: { name: 'csv', organizationId: null }
  });
  if (existingCsv) {
    await prisma.dataSourceConfig.update({
      where: { id: existingCsv.id },
      data: {
        provider: 'csv',
        role: DataSourceRole.DISCOVERY,
        status: DataSourceStatus.APPROVED,
        isEnabled: true
      }
    });
  } else {
    await prisma.dataSourceConfig.create({
      data: {
        name: 'csv',
        provider: 'csv',
        role: DataSourceRole.DISCOVERY,
        status: DataSourceStatus.APPROVED,
        isEnabled: true,
        persistencePolicy: { persistFields: ['all'] },
        refreshPolicy: {},
        rateLimitConfig: {},
        pricing: { unitCostMinor: 0, currency: 'BDT' }
      }
    });
  }


  console.log(`✓ Seed completed successfully: Organization "${defaultOrg.name}" and Super Admin (${superAdmin.email}) are configured.`);
}

main()
  .catch((e) => {
    console.error('Error during database seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
