import { Role } from './enums.js';

export const Permissions = {
  LEADS_READ: 'leads:read',
  LEADS_WRITE: 'leads:write',
  LEADS_EXPORT: 'leads:export',
  LEADS_ASSIGN: 'leads:assign',
  CAMPAIGNS_MANAGE: 'campaigns:manage',
  DEMOS_GENERATE: 'demos:generate',
  DEMOS_MANAGE: 'demos:manage',
  SUPPRESSION_MANAGE: 'suppression:manage',
  DATASOURCES_MANAGE: 'datasources:manage',
  SCORING_MANAGE: 'scoring:manage',
  COSTS_READ: 'costs:read',
  USERS_MANAGE: 'users:manage',
  INTEGRATIONS_MANAGE: 'integrations:manage',
  REPORTS_READ: 'reports:read',
  SALES_ASSISTANT_GENERATE: 'sales_assistant:generate',
  SALES_ASSISTANT_REVIEW: 'sales_assistant:review'
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permissions);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.SUPER_ADMIN]: ALL_PERMISSIONS,
  [Role.ADMIN]: ALL_PERMISSIONS.filter((p) => p !== Permissions.INTEGRATIONS_MANAGE),
  [Role.SALES_MANAGER]: [
    Permissions.LEADS_READ,
    Permissions.LEADS_WRITE,
    Permissions.LEADS_EXPORT,
    Permissions.LEADS_ASSIGN,
    Permissions.CAMPAIGNS_MANAGE,
    Permissions.DEMOS_GENERATE,
    Permissions.DEMOS_MANAGE,
    Permissions.SALES_ASSISTANT_GENERATE,
    Permissions.SALES_ASSISTANT_REVIEW,
    Permissions.SUPPRESSION_MANAGE,
    Permissions.REPORTS_READ,
    Permissions.COSTS_READ
  ],
  [Role.SALES_EXECUTIVE]: [
    Permissions.LEADS_READ,
    Permissions.LEADS_WRITE,
    Permissions.DEMOS_GENERATE,
    Permissions.SALES_ASSISTANT_GENERATE
  ],
  [Role.VIEWER]: [
    Permissions.LEADS_READ,
    Permissions.REPORTS_READ
  ]
};

export function hasPermission(userRole: Role, permission: Permission): boolean {
  const allowed = ROLE_PERMISSIONS[userRole];
  return allowed ? allowed.includes(permission) : false;
}
