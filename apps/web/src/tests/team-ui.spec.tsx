import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Role, TeamSortBy, type TeamMemberSummary, type TeamMemberDetail } from '@leadmate/shared';
import { TeamMemberTable } from '../components/team/team-member-table.js';
import { TeamFilterBar } from '../components/team/team-filter-bar.js';
import { CreateMemberModal } from '../components/team/create-member-modal.js';
import { EditMemberModal } from '../components/team/edit-member-modal.js';
import { MemberDetailModal } from '../components/team/member-detail-modal.js';
import { DeactivateConfirmModal } from '../components/team/deactivate-confirm-modal.js';

describe('M7 Step 3: Team UI Components Static Markup & RBAC Rendering', () => {
  const mockMembers: TeamMemberSummary[] = [
    {
      id: 'user-sa-1',
      name: 'Alice SuperAdmin',
      email: 'alice@company.com',
      role: Role.SUPER_ADMIN,
      isActive: true,
      createdAt: '2026-10-01T10:00:00.000Z',
      workload: {
        assignedLeadsCount: 5,
        activeLeadsCount: 3,
        pendingFollowUpsCount: 2,
        overdueFollowUpsCount: 1
      }
    },
    {
      id: 'user-admin-1',
      name: 'Bob Admin',
      email: 'bob@company.com',
      role: Role.ADMIN,
      isActive: true,
      createdAt: '2026-10-02T10:00:00.000Z',
      workload: {
        assignedLeadsCount: 12,
        activeLeadsCount: 8,
        pendingFollowUpsCount: 4,
        overdueFollowUpsCount: 0
      }
    },
    {
      id: 'user-exec-1',
      name: 'Charlie Rep',
      email: 'charlie@company.com',
      role: Role.SALES_EXECUTIVE,
      isActive: false,
      createdAt: '2026-10-03T10:00:00.000Z',
      workload: {
        assignedLeadsCount: 20,
        activeLeadsCount: 0,
        pendingFollowUpsCount: 0,
        overdueFollowUpsCount: 0
      }
    }
  ];

  describe('TeamMemberTable', () => {
    it('renders members, friendly role labels, and workload metrics on desktop and mobile', () => {
      const html = renderToStaticMarkup(
        <TeamMemberTable
          members={mockMembers}
          currentUserId="user-sa-1"
          currentUserRole={Role.SUPER_ADMIN}
          hasUsersManage={true}
          onViewMember={vi.fn()}
          onEditMember={vi.fn()}
          onActivateMember={vi.fn()}
          onDeactivateMember={vi.fn()}
        />
      );

      // Names and emails
      expect(html).toContain('Alice SuperAdmin');
      expect(html).toContain('alice@company.com');
      expect(html).toContain('Bob Admin');
      expect(html).toContain('bob@company.com');
      expect(html).toContain('Charlie Rep');
      expect(html).toContain('charlie@company.com');

      // Role and status badges
      expect(html).toContain('Super Admin');
      expect(html).toContain('Admin');
      expect(html).toContain('Sales Executive');
      expect(html).toContain('Active');
      expect(html).toContain('Inactive');

      // Workload counts
      expect(html).toContain('5');
      expect(html).toContain('12');
      expect(html).toContain('20');

      // Self indicator
      expect(html).toContain('You');
    });

    it('renders mutation controls for USERS_MANAGE actors and hides Deactivate for self', () => {
      const html = renderToStaticMarkup(
        <TeamMemberTable
          members={mockMembers}
          currentUserId="user-sa-1"
          currentUserRole={Role.SUPER_ADMIN}
          hasUsersManage={true}
          onViewMember={vi.fn()}
          onEditMember={vi.fn()}
          onActivateMember={vi.fn()}
          onDeactivateMember={vi.fn()}
        />
      );

      // Self is user-sa-1: Deactivate button must NOT be rendered for self
      expect(html).not.toContain('aria-label="Deactivate Alice SuperAdmin"');

      // Other active member (Bob Admin): Deactivate button IS rendered for Super Admin
      expect(html).toContain('aria-label="Deactivate Bob Admin"');

      // Inactive member (Charlie Rep): Activate button IS rendered
      expect(html).toContain('aria-label="Activate Charlie Rep"');
    });

    it('hides all mutation controls (Edit/Activate/Deactivate) for USERS_READ-only actors', () => {
      const html = renderToStaticMarkup(
        <TeamMemberTable
          members={mockMembers}
          currentUserId="user-sm-1"
          currentUserRole={Role.SALES_MANAGER}
          hasUsersManage={false}
          onViewMember={vi.fn()}
          onEditMember={vi.fn()}
          onActivateMember={vi.fn()}
          onDeactivateMember={vi.fn()}
        />
      );

      // View button is present
      expect(html).toContain('aria-label="View Alice SuperAdmin"');

      // Mutation buttons are completely absent
      expect(html).not.toContain('aria-label="Edit Alice SuperAdmin"');
      expect(html).not.toContain('aria-label="Deactivate Bob Admin"');
      expect(html).not.toContain('aria-label="Activate Charlie Rep"');
    });

    it('prevents ADMIN from seeing mutation buttons for other ADMIN or SUPER_ADMIN members', () => {
      const html = renderToStaticMarkup(
        <TeamMemberTable
          members={mockMembers}
          currentUserId="user-admin-1"
          currentUserRole={Role.ADMIN}
          hasUsersManage={true}
          onViewMember={vi.fn()}
          onEditMember={vi.fn()}
          onActivateMember={vi.fn()}
          onDeactivateMember={vi.fn()}
        />
      );

      // Admin can view Super Admin, but CANNOT edit or deactivate Super Admin
      expect(html).toContain('aria-label="View Alice SuperAdmin"');
      expect(html).not.toContain('aria-label="Edit Alice SuperAdmin"');
      expect(html).not.toContain('aria-label="Deactivate Alice SuperAdmin"');

      // Admin can edit self (name edit)
      expect(html).toContain('aria-label="Edit Bob Admin"');
      // Admin cannot deactivate self
      expect(html).not.toContain('aria-label="Deactivate Bob Admin"');

      // Admin can activate/mutate non-admin (Charlie Rep)
      expect(html).toContain('aria-label="Activate Charlie Rep"');
      expect(html).toContain('aria-label="Edit Charlie Rep"');
    });
  });

  describe('TeamFilterBar', () => {
    it('renders search input, filter selects, and sort controls', () => {
      const html = renderToStaticMarkup(
        <TeamFilterBar
          filters={{
            search: 'test-query',
            role: Role.ADMIN,
            isActive: true,
            sortBy: TeamSortBy.NAME,
            sortOrder: 'asc'
          }}
          onFilterChange={vi.fn()}
          onReset={vi.fn()}
          isFiltered={true}
        />
      );

      expect(html).toContain('value="test-query"');
      expect(html).toContain('All Roles');
      expect(html).toContain('Super Admin');
      expect(html).toContain('Active');
      expect(html).toContain('Inactive');
      expect(html).toContain('Created Date');
      expect(html).toContain('Reset');
    });
  });

  describe('CreateMemberModal', () => {
    it('renders Name, Email, Role, and Temporary Password inputs with type="password"', () => {
      const html = renderToStaticMarkup(
        <CreateMemberModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          actorRole={Role.SUPER_ADMIN}
        />
      );

      expect(html).toContain('Add Team Member');
      expect(html).toContain('Full Name');
      expect(html).toContain('Email Address');
      expect(html).toContain('Role');
      expect(html).toContain('Temporary Password');
      expect(html).toContain('type="password"');
    });

    it('restricts role options for ADMIN to Sales Manager, Sales Exec, Viewer (no Admin or Super Admin)', () => {
      const html = renderToStaticMarkup(
        <CreateMemberModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          actorRole={Role.ADMIN}
        />
      );

      expect(html).toContain('Sales Manager');
      expect(html).toContain('Sales Executive');
      expect(html).toContain('Viewer');

      // Admin and Super Admin must NOT be options
      expect(html).not.toContain('<option value="ADMIN"');
      expect(html).not.toContain('<option value="SUPER_ADMIN"');
    });

    it('provides all 5 role options for SUPER_ADMIN', () => {
      const html = renderToStaticMarkup(
        <CreateMemberModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          actorRole={Role.SUPER_ADMIN}
        />
      );

      expect(html).toContain('<option value="SUPER_ADMIN"');
      expect(html).toContain('<option value="ADMIN"');
      expect(html).toContain('<option value="SALES_MANAGER"');
      expect(html).toContain('<option value="SALES_EXECUTIVE"');
      expect(html).toContain('<option value="VIEWER"');
    });
  });

  describe('EditMemberModal', () => {
    it('displays immutable email and locks role selector for self-edits', () => {
      const html = renderToStaticMarkup(
        <EditMemberModal
          isOpen={true}
          member={mockMembers[0]}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          currentUserId={mockMembers[0].id} // self edit
          actorRole={Role.SUPER_ADMIN}
        />
      );

      expect(html).toContain('Edit Team Member');
      expect(html).toContain(mockMembers[0].email);
      expect(html).toContain('Immutable');
      expect(html).toContain('Self-role locked');
      // Role select is replaced with locked badge
      expect(html).not.toContain('<select id="edit-member-role"');
    });

    it('renders role dropdown for editing another member with allowed options', () => {
      const html = renderToStaticMarkup(
        <EditMemberModal
          isOpen={true}
          member={mockMembers[2]} // editing Charlie
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          currentUserId="user-admin-1"
          actorRole={Role.ADMIN}
        />
      );

      expect(html).toContain('<select id="edit-member-role"');
      expect(html).toContain('Sales Manager');
      expect(html).not.toContain('<option value="SUPER_ADMIN"');
      expect(html).not.toContain('<option value="ADMIN"');
    });
  });

  describe('MemberDetailModal', () => {
    it('displays full member details and 4 sales workload metric cards', () => {
      const html = renderToStaticMarkup(
        <MemberDetailModal
          isOpen={true}
          member={mockMembers[0]}
          onClose={vi.fn()}
          hasUsersManage={true}
        />
      );

      expect(html).toContain('Alice SuperAdmin');
      expect(html).toContain('alice@company.com');
      expect(html).toContain('Sales Workload Summary');
      expect(html).toContain('Assigned Leads');
      expect(html).toContain('Active Pipeline');
      expect(html).toContain('Pending Follow-ups');
      expect(html).toContain('Overdue Follow-ups');
    });
  });

  describe('DeactivateConfirmModal', () => {
    it('displays clear warning explaining login revocation and historical assignment preservation', () => {
      const html = renderToStaticMarkup(
        <DeactivateConfirmModal
          isOpen={true}
          member={mockMembers[1]}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          isSubmitting={false}
        />
      );

      expect(html).toContain('Deactivate Member');
      expect(html).toContain('Bob Admin');
      expect(html).toContain('The member will no longer be able to sign in');
      expect(html).toContain('Historical assignments (leads and follow-ups) remain preserved');
      expect(html).toContain('Leads will not be automatically unassigned or reassigned');
    });
  });
});
