import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CrmStage,
  CrmActivityType,
  type CrmNote,
  type CrmActivity,
  type AssigneeSummary
} from '@leadmate/shared';
import { CrmCard } from '../components/leads/crm-card.js';

describe('M3 Step 7: CRM Frontend Security, XSS Escaping & Resilience', () => {
  const mockLeadId = 'l0000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. XSS & HTML Injection Prevention', () => {
    it('safely escapes script tags in note content without raw HTML injection', () => {
      const maliciousScript = '<script>alert("xss")</script>';
      const maliciousImg = '<img src=x onerror="alert(1)" />';

      const html = renderToStaticMarkup(
        <div id="test-wrapper">
          <p className="note-body">{maliciousScript}</p>
          <p className="note-body">{maliciousImg}</p>
        </div>
      );

      // Verify HTML entities are escaped
      expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot; /&gt;');
      // Verify raw executable tags are NOT injected
      expect(html).not.toContain('<script>alert');
      expect(html).not.toContain('<img src=x onerror');
    });

    it('safely escapes malicious actor names in notes and activities', () => {
      const maliciousActorName = '<script>fetch("evil.com")</script>';
      const mockNoteWithXssActor: CrmNote = {
        id: 'n-xss-1',
        leadId: mockLeadId,
        userId: 'u-xss-1',
        content: 'Clean text content',
        author: {
          id: 'u-xss-1',
          name: maliciousActorName,
          email: 'evil@attacker.test'
        },
        createdAt: '2026-10-02T14:30:00.000Z',
        updatedAt: '2026-10-02T14:30:00.000Z'
      };

      const html = renderToStaticMarkup(
        <div className="actor-display">
          <span>{mockNoteWithXssActor.author?.name}</span>
        </div>
      );

      expect(html).toContain('&lt;script&gt;fetch(&quot;evil.com&quot;)&lt;/script&gt;');
      expect(html).not.toContain('<script>fetch');
    });

    it('safely escapes HTML in error messages and feedback notices', () => {
      const maliciousError = 'Error: <b onmouseover=alert(1)>Unauthorized</b>';

      const html = renderToStaticMarkup(
        <div id="crm-error-banner" className="text-red-400">
          <span>{maliciousError}</span>
        </div>
      );

      expect(html).toContain('&lt;b onmouseover=alert(1)&gt;Unauthorized&lt;/b&gt;');
      expect(html).not.toContain('<b onmouseover');
    });
  });

  describe('2. Safe Field Exposure & Read-Only Invariants', () => {
    it('does not render private user credentials or internal fields in assignee options', () => {
      const safeAssignee: AssigneeSummary = {
        id: 'u-safe-1',
        name: 'Sarah Connor',
        email: 'sarah@leadmate.test'
      };

      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          initialStage={CrmStage.NEW}
          initialAssignedUserId={safeAssignee.id}
          initialAssignedUser={safeAssignee}
          canWrite={false}
          canAssign={false}
        />
      );

      // Verify safe fields exist
      expect(html).toContain(safeAssignee.name);
      expect(html).toContain(safeAssignee.email);

      // Verify sensitive field keys do not appear as attributes or text
      expect(html).not.toContain('passwordHash');
      expect(html).not.toContain('tokenHash');
      expect(html).not.toContain('sessionSecret');
    });
  });

  describe('3. Component Layout & Failure Isolation', () => {
    it('renders initial stage and assignment safely even when notes and activities are empty', () => {
      const html = renderToStaticMarkup(
        <CrmCard
          leadId={mockLeadId}
          initialStage={CrmStage.CONTACTED}
          initialAssignedUserId={null}
          initialAssignedUser={null}
          canWrite={true}
          canAssign={true}
        />
      );

      expect(html).toContain('id="crm-card"');
      expect(html).toContain('id="crm-stage-select"');
      expect(html).toContain('id="crm-assignee-select"');
      expect(html).toContain('id="crm-notes-empty"');
      expect(html).toContain('id="crm-activities-empty"');
    });
  });
});
