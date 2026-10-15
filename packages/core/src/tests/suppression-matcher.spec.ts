import { describe, it, expect } from 'vitest';
import { checkSuppression, type SuppressionRecordCandidate } from '../outreach/suppression-matcher.js';

describe('SuppressionMatcher', () => {
  const suppressionRegistry: SuppressionRecordCandidate[] = [
    {
      id: 'sup-1',
      phone: '+8801711000111',
      reason: 'UNSUBSCRIBE'
    },
    {
      id: 'sup-2',
      email: 'optout@example.com',
      reason: 'DO_NOT_CONTACT'
    },
    {
      id: 'sup-3',
      domain: 'bannedstore.example.com',
      reason: 'LEGAL'
    },
    {
      id: 'sup-4',
      salesMissionBuyerId: 'buyer-explicit-blocked-44',
      reason: 'MANUAL_OPTOUT'
    },
    {
      id: 'sup-5',
      businessName: 'Blocked Corner Store',
      locality: 'Mirpur',
      reason: 'DO_NOT_CONTACT'
    }
  ];

  it('hard-blocks when phone matches (accounting for local vs E.164 normalization)', () => {
    // 01711000111 normalizes to +8801711000111
    const res = checkSuppression(
      { phone: '01711-000111', businessName: 'Clean Shop' },
      suppressionRegistry
    );
    expect(res.isSuppressed).toBe(true);
    expect(res.matchedKey).toBe('PHONE');
    expect(res.reviewStatus).toBe('HARD_SUPPRESSED');
  });

  it('hard-blocks when email matches case-insensitively', () => {
    const res = checkSuppression(
      { email: 'OPTOUT@EXAMPLE.COM', businessName: 'Clean Shop' },
      suppressionRegistry
    );
    expect(res.isSuppressed).toBe(true);
    expect(res.matchedKey).toBe('EMAIL');
    expect(res.reviewStatus).toBe('HARD_SUPPRESSED');
  });

  it('hard-blocks when domain matches', () => {
    const res = checkSuppression(
      { website: 'https://bannedstore.example.com/products/view', businessName: 'Clean Shop' },
      suppressionRegistry
    );
    expect(res.isSuppressed).toBe(true);
    expect(res.matchedKey).toBe('DOMAIN');
    expect(res.reviewStatus).toBe('HARD_SUPPRESSED');
  });

  it('hard-blocks when explicit buyer ID matches', () => {
    const res = checkSuppression(
      { id: 'buyer-explicit-blocked-44', businessName: 'Blocked Entity' },
      suppressionRegistry
    );
    expect(res.isSuppressed).toBe(true);
    expect(res.matchedKey).toBe('BUYER_ID');
    expect(res.reviewStatus).toBe('HARD_SUPPRESSED');
  });

  it('CRITICAL INVARIANT: name + locality match MUST NOT hard-block, only flags POSSIBLE_MATCH_REVIEW', () => {
    const res = checkSuppression(
      {
        businessName: 'Blocked Corner Store',
        locality: 'Mirpur',
        phone: '01999888777' // distinct unblocked phone
      },
      suppressionRegistry
    );

    // Must NOT be hard suppressed
    expect(res.isSuppressed).toBe(false);
    expect(res.reviewStatus).toBe('POSSIBLE_MATCH_REVIEW');
    expect(res.reviewNote).toContain('Flagged for operator review, not hard-blocked');
  });

  it('returns CLEAR when no keys match', () => {
    const res = checkSuppression(
      {
        id: 'buyer-clean-99',
        phone: '01888123456',
        email: 'hello@cleanbuyer.example.com',
        website: 'https://cleanbuyer.example.com',
        businessName: 'Dhaka Modern Furniture',
        locality: 'Gulshan'
      },
      suppressionRegistry
    );

    expect(res.isSuppressed).toBe(false);
    expect(res.reviewStatus).toBe('CLEAR');
  });
});
