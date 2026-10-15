import { describe, it, expect } from 'vitest';
import { composePersonalizedOutreach } from '../outreach/personalization-composer.js';

describe('PersonalizationComposer', () => {
  const sampleProduct = {
    name: 'Handcrafted Mushroom Lamp',
    description: 'Rechargeable wooden bedside ambient LED lamp',
    category: 'Home Decor & Lighting',
    price: 1200,
    moq: 10
  };

  const sampleBuyer = {
    id: 'buyer-001',
    businessName: 'Apex Lighting Solutions Ltd',
    category: 'Lighting Store',
    address: 'House 14, Road 7, Dhanmondi',
    city: 'Dhaka',
    phone: '01711000111',
    website: 'https://apexlighting.example.com',
    wholesaleIntent: 'HIGH',
    wholesaleIntentSignals: ['RFQ', 'bulk price'],
    suggestedRelatedNeeds: ['Lamp Dimmers', 'Packaging Boxes'],
    sourceEvidences: [
      {
        sourceType: 'PUBLIC_RFQ',
        sourceName: 'Procurement Tender Portal',
        observedAt: new Date(),
        evidenceType: 'PUBLIC_RFQ',
        snippet: 'Looking for bulk price and RFQ for modern bedside decorative lamps'
      }
    ],
    whatsappStatus: 'NOT_VERIFIED',
    buyerScore: 88,
    priority: 'HOT'
  };

  it('generates an outreach draft strictly with status DRAFT and cites RFQ evidence when present', () => {
    const draft = composePersonalizedOutreach({
      product: sampleProduct,
      buyer: sampleBuyer,
      channel: 'EMAIL',
      language: 'EN'
    });

    expect(draft.status).toBe('DRAFT');
    expect(draft.channel).toBe('EMAIL');
    expect(draft.subject).toContain('Apex Lighting Solutions Ltd');
    expect(draft.body).toContain('Handcrafted Mushroom Lamp');
    expect(draft.body).toContain('1200 BDT');
    expect(draft.body).toContain('10 units');
    // Verifies RFQ evidence citation
    expect(draft.aiContextSnapshot.citesRfqEvidence).toBe(true);
    expect(draft.body).toContain('public trade inquiry');
    // Verifies related needs as suggestions
    expect(draft.body).toContain('Lamp Dimmers');
    expect(draft.body).toContain('advisory catalog options');
  });

  it('never falsely claims buyer requested product when RFQ evidence is absent', () => {
    const buyerWithoutRfq = {
      ...sampleBuyer,
      sourceEvidences: [
        {
          sourceType: 'OPENSTREETMAP',
          sourceName: 'OSM Search',
          observedAt: new Date(),
          evidenceType: 'DISCOVERY_SEARCH'
        }
      ]
    };

    const draft = composePersonalizedOutreach({
      product: sampleProduct,
      buyer: buyerWithoutRfq,
      channel: 'EMAIL',
      language: 'EN'
    });

    expect(draft.aiContextSnapshot.citesRfqEvidence).toBe(false);
    expect(draft.body).not.toContain('public trade inquiry');
    expect(draft.body).toContain('came across your commercial operations in Dhaka');
  });

  it('enforces PHONE != WHATSAPP: warns when generating WhatsApp draft for unverified phone', () => {
    const draft = composePersonalizedOutreach({
      product: sampleProduct,
      buyer: {
        ...sampleBuyer,
        whatsappStatus: 'NOT_VERIFIED'
      },
      channel: 'WHATSAPP_DRAFT',
      language: 'EN'
    });

    expect(draft.channel).toBe('WHATSAPP_DRAFT');
    expect(draft.status).toBe('DRAFT');
    expect(draft.warnings).toContain(
      'WHATSAPP_UNVERIFIED: Phone number is not explicitly verified for WhatsApp on official channels. Draft prepared for manual verification.'
    );
  });

  it('generates natural Bangla draft without warnings when requested', () => {
    const draft = composePersonalizedOutreach({
      product: sampleProduct,
      buyer: sampleBuyer,
      channel: 'EMAIL',
      language: 'BN'
    });

    expect(draft.status).toBe('DRAFT');
    expect(draft.language).toBe('BN');
    expect(draft.subject).toContain('পাইকারি সরবরাহ');
    expect(draft.body).toContain('Apex Lighting Solutions Ltd');
    expect(draft.body).toContain('Handcrafted Mushroom Lamp');
    expect(draft.body).toContain('1200 BDT');
  });
});
