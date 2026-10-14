import { describe, it, expect } from 'vitest';
import { deriveSuggestedRelatedNeeds } from '../analysis/related-needs-advisor.js';

describe('AI Suggested Related Needs Advisor', () => {
  it('predicts lighting and decor inventory needs for a home decor store selling mushroom lamps', () => {
    const needs = deriveSuggestedRelatedNeeds({
      productName: 'Mushroom Lamp',
      productCategory: 'Home Decor & Lighting',
      buyerCategory: 'Home Decor Store'
    });

    expect(needs).toContain('Decorative Lighting');
    expect(needs).toContain('Wall Lamp');
    expect(needs).toContain('Rechargeable Light');
    expect(needs).toContain('Gift Items');
  });

  it('predicts hospitality lighting needs for hotel / cafe buyers', () => {
    const needs = deriveSuggestedRelatedNeeds({
      productName: 'Ambient Bedside Lamp',
      buyerCategory: 'Boutique Hotel & Cafe'
    });

    expect(needs.some((n) => n.includes('Lighting') || n.includes('Lamps') || n.includes('Decor'))).toBe(true);
  });

  it('falls back to general commercial merchandise needs when category is unknown', () => {
    const needs = deriveSuggestedRelatedNeeds({
      productName: 'Custom Gadget',
      buyerCategory: 'General Retail Store'
    });

    expect(needs.length).toBeGreaterThan(0);
    expect(needs).toContain('Fast-moving Shelf Items');
  });

  it('produces purely deterministic predictions across repeated runs', () => {
    const input = {
      productName: 'Mini Portable Blender',
      productCategory: 'Kitchenware',
      buyerCategory: 'Kitchenware Store'
    };

    const run1 = deriveSuggestedRelatedNeeds(input);
    const run2 = deriveSuggestedRelatedNeeds(input);

    expect(run1).toEqual(run2);
  });
});
