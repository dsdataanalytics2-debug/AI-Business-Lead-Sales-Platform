import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CrmStage,
  CRM_STAGE_LABELS,
  ORDERED_CRM_STAGES,
  CrmActivityType,
  Permissions,
  type Permission,
  type AssigneeSummary,
  type CrmNote,
  type CrmActivity
} from '@leadmate/shared';
import { CrmCard } from '../components/leads/crm-card.js';
import { apiClient } from '../lib/api-client.js';

const mockLeadId = 'l0000000-0000-0000-0000-000000000001';

const mockAssignee: AssigneeSummary = {
  id: 'u0000000-0000-0000-0000-000000000001',
  name: 'Tanvir Sales',
  email: 'tanvir@leadmate.test'
};

const mockNotes: CrmNote[] = [
  {
    id: 'n0000000-0000-0000-0000-000000000001',
    leadId: mockLeadId,
    userId: 'u0000000-0000-0000-0000-000000000001',
    content: 'Spoke with CEO. Requested a custom demo proposal.',
    author: {
      id: 'u0000000-0000-0000-0000-000000000001',
      name: 'Tanvir Sales',
      email: 'tanvir@leadmate.test'
    },
    createdAt: '2026-10-02T14:30:00.000Z',
    updatedAt: '2026-10-02T14:30:00.000Z'
  }
];

const mockActivities: CrmActivity[] = [
  {
    id: 'act00000-0000-0000-0000-000000000001',
    leadId: mockLeadId,
    type: CrmActivityType.STAGE_CHANGED,
    metadata: {
      previousStage: CrmStage.NEW,
      newStage: CrmStage.QUALIFIED
    },
    actor: {
      id: 'u0000000-0000-0000-0000-000000000001',
      name: 'Tanvir Sales',
      email: 'tanvir@leadmate.test'
    },
    createdAt: '2026-10-02T14:30:00.000Z'
  },
  {
    id: 'act00000-0000-0000-0000-000000000002',
    leadId: mockLeadId,
    type: CrmActivityType.LEAD_ASSIGNED,
    metadata: {
      assignedUserId: 'u0000000-0000-0000-0000-000000000001'
    },
    actor: {
      id: 'u0000000-0000-0000-0000-000000000002',
      name: 'Admin Boss',
      email: 'admin@leadmate.test'
    },
    createdAt: '2026-10-02T12:00:00.000Z'
  }
];

describe('CrmCard UI & Permission Proofs (Component Spec)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('A. CRM Stage Display & Permissions', () => {
    const checkUserCanWrite = (permissions: Permission[]) =>
      permissions.includes(Permissions.LEADS_WRITE);

    it('renders initial stage badge with canonical label', () => {
      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          initialStage={CrmStage.QUALIFIED}
          canWrite={false}
          canAssign={false}
        />
      );

      expect(html).toContain('id="crm-stage-badge"');
      expect(html).toContain(CRM_STAGE_LABELS[CrmStage.QUALIFIED]);
    });

    it('renders editable select with all 7 stages when user HAS LEADS_WRITE permission', () => {
      const userPermissions: Permission[] = [Permissions.LEADS_READ, Permissions.LEADS_WRITE];
      const canWrite = checkUserCanWrite(userPermissions);

      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          initialStage={CrmStage.NEW}
          canWrite={canWrite}
          canAssign={false}
        />
      );

      expect(canWrite).toBe(true);
      expect(html).toContain('id="crm-stage-select"');
      for (const stage of ORDERED_CRM_STAGES) {
        expect(html).toContain(CRM_STAGE_LABELS[stage]);
      }
    });

    it('renders read-only notice and NO stage select when user LACKS LEADS_WRITE permission', () => {
      const userPermissions: Permission[] = [Permissions.LEADS_READ];
      const canWrite = checkUserCanWrite(userPermissions);

      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          initialStage={CrmStage.NEW}
          canWrite={canWrite}
          canAssign={false}
        />
      );

      expect(canWrite).toBe(false);
      expect(html).not.toContain('id="crm-stage-select"');
      expect(html).toContain('Read-only stage');
      expect(html).toContain('LEADS_WRITE');
    });
  });

  describe('B. Lead Assignment Display & Permissions', () => {
    const checkUserCanAssign = (permissions: Permission[]) =>
      permissions.includes(Permissions.LEADS_ASSIGN);

    it('renders assigned user badge when lead is assigned', () => {
      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          initialAssignedUserId={mockAssignee.id}
          initialAssignedUser={mockAssignee}
          initialAssignedAt="2026-10-02T10:00:00.000Z"
          canWrite={false}
          canAssign={false}
        />
      );

      expect(html).toContain('id="crm-assigned-user-badge"');
      expect(html).toContain(mockAssignee.name);
      expect(html).toContain(mockAssignee.email);
    });

    it('renders Unassigned badge when lead has no assignee', () => {
      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          initialAssignedUserId={null}
          initialAssignedUser={null}
          canWrite={false}
          canAssign={false}
        />
      );

      expect(html).toContain('id="crm-unassigned-badge"');
      expect(html).toContain('Unassigned');
    });

    it('renders assignment control when user HAS LEADS_ASSIGN permission', () => {
      const userPermissions: Permission[] = [Permissions.LEADS_READ, Permissions.LEADS_ASSIGN];
      const canAssign = checkUserCanAssign(userPermissions);

      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          initialAssignedUserId={null}
          canWrite={false}
          canAssign={canAssign}
        />
      );

      expect(canAssign).toBe(true);
      expect(html).toContain('id="crm-assignee-select"');
      expect(html).toContain('Unassigned');
    });

    it('renders read-only notice and NO assignment select when user LACKS LEADS_ASSIGN permission (even with LEADS_WRITE)', () => {
      const userPermissions: Permission[] = [Permissions.LEADS_READ, Permissions.LEADS_WRITE];
      const canAssign = checkUserCanAssign(userPermissions);

      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          initialAssignedUserId={null}
          canWrite={true}
          canAssign={canAssign}
        />
      );

      expect(canAssign).toBe(false);
      expect(html).not.toContain('id="crm-assignee-select"');
      expect(html).toContain('Read-only assignment');
      expect(html).toContain('LEADS_ASSIGN');
    });
  });

  describe('C. CRM Notes Feed & Composer', () => {
    it('renders note composer textarea and submit button when user HAS LEADS_WRITE permission', () => {
      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          canWrite={true}
          canAssign={false}
        />
      );

      expect(html).toContain('id="crm-note-textarea"');
      expect(html).toContain('id="crm-add-note-btn"');
      expect(html).toContain('Add Note');
    });

    it('renders read-only notice and NO textarea when user LACKS LEADS_WRITE permission', () => {
      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          canWrite={false}
          canAssign={false}
        />
      );

      expect(html).not.toContain('id="crm-note-textarea"');
      expect(html).not.toContain('id="crm-add-note-btn"');
      expect(html).toContain('Note composition requires LEADS_WRITE');
    });

    it('renders empty notes state when notes array is empty', () => {
      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          canWrite={true}
          canAssign={false}
        />
      );

      expect(html).toContain('id="crm-notes-empty"');
      expect(html).toContain('No CRM notes yet.');
    });
  });

  describe('D. Activity Timeline & Formats', () => {
    it('renders empty activity state initially', () => {
      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          canWrite={false}
          canAssign={false}
        />
      );

      expect(html).toContain('id="crm-activities-empty"');
      expect(html).toContain('No activity recorded yet.');
    });
  });

  describe('E. Accessibility & Layout', () => {
    it('provides accessible labels for all form inputs', () => {
      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          canWrite={true}
          canAssign={true}
        />
      );

      expect(html).toContain('for="crm-stage-select"');
      expect(html).toContain('for="crm-assignee-select"');
      expect(html).toContain('for="crm-note-textarea"');
    });

    it('renders main card container with id and semantic headings', () => {
      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          canWrite={true}
          canAssign={true}
        />
      );

      expect(html).toContain('id="crm-card"');
      expect(html).toContain('CRM &amp; Sales Pipeline');
      expect(html).toContain('CRM Notes');
      expect(html).toContain('Activity Timeline');
    });
  });
});
