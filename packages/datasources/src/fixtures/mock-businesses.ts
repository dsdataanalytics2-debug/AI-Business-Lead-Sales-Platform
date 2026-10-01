/**
 * Deterministic Mock Business Fixtures for @leadmate/datasources
 *
 * EXACTLY 10 stable, fictional business fixtures covering all M1 domain edge cases:
 * 1. Dhaka business with valid local mobile + website (Branch A)
 * 2. Dhaka business with +880 mobile representation + website (Branch B sharing domain with 1)
 * 3. Chittagong/Chattogram business with Bengali digit phone representation
 * 4. Sylhet business
 * 5. Business with NO website
 * 6. Business with explicit publicly listed WhatsApp evidence (wa.me link)
 * 7. Facebook-only / social-presence business with no normal website
 * 8. Dhaka landline business (Motijheel)
 * 9. Business with malformed/invalid phone number
 * 10. Business with NO phone
 *
 * SAFETY & IMMUTABILITY:
 * - All data is purely fictional test fixtures (no personal PII, example-style domains).
 * - Provider name is 'MOCK'.
 * - External IDs are stable and deterministic.
 */

import {
  ContactType,
  PhoneType,
  WhatsAppStatus,
  EvidenceType
} from '@leadmate/shared';
import type { BusinessSearchResult } from '../types.js';

export const MOCK_PROVIDER_NAME = 'MOCK';

export const MOCK_BUSINESS_FIXTURES: readonly BusinessSearchResult[] = Object.freeze([
  // 1. Dhaka business with valid local mobile + website (Branch 1 sharing website domain)
  {
    externalId: 'mock-dhaka-dental-gulshan-001',
    provider: MOCK_PROVIDER_NAME,
    name: 'Mock Dhaka Dental Care Gulshan',
    category: 'Dental Clinic',
    description: 'Premier dental healthcare and cosmetic dentistry clinic in Gulshan.',
    address: 'House 12, Road 45, Gulshan-1',
    locality: 'Gulshan-1',
    city: 'Dhaka',
    region: 'Dhaka Division',
    country: 'BD',
    latitude: 23.7808,
    longitude: 90.4192,
    website: 'https://dhakadental.example.com/gulshan',
    rating: 4.6,
    reviewCount: 28,
    sourceUrl: 'https://directory.example.com/listings/mock-dhaka-dental-gulshan',
    contacts: [
      {
        type: ContactType.PHONE,
        rawValue: '01711000001',
        phoneType: PhoneType.MOBILE,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.LISTING_FIELD,
        snippet: 'Primary Reception: 01711000001'
      }
    ]
  },

  // 2. Dhaka business with +880 mobile representation (Branch 2 sharing website domain)
  {
    externalId: 'mock-dhaka-dental-dhanmondi-002',
    provider: MOCK_PROVIDER_NAME,
    name: 'Mock Dhaka Dental Care Dhanmondi',
    category: 'Dental Clinic',
    description: 'Specialized orthodontic and oral surgery branch in Dhanmondi.',
    address: 'House 8A, Road 27, Dhanmondi',
    locality: 'Dhanmondi',
    city: 'Dhaka',
    region: 'Dhaka Division',
    country: 'BD',
    latitude: 23.7535,
    longitude: 90.3768,
    website: 'https://dhakadental.example.com/dhanmondi',
    rating: 4.4,
    reviewCount: 15,
    sourceUrl: 'https://directory.example.com/listings/mock-dhaka-dental-dhanmondi',
    contacts: [
      {
        type: ContactType.PHONE,
        rawValue: '+8801722000002',
        phoneType: PhoneType.MOBILE,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.LISTING_FIELD,
        snippet: 'Appointments: +8801722000002'
      }
    ]
  },

  // 3. Chittagong / Chattogram business with Bengali digit phone representation
  {
    externalId: 'mock-ctg-steel-agrabad-003',
    provider: MOCK_PROVIDER_NAME,
    name: 'Mock Chattogram Steel Works',
    category: 'Manufacturing',
    description: 'Industrial structural steel and fabrication supplier in Chattogram Port area.',
    address: 'Plot 4, Commercial Area, Agrabad',
    locality: 'Agrabad',
    city: 'Chattogram',
    region: 'Chattogram Division',
    country: 'BD',
    latitude: 22.3275,
    longitude: 91.8123,
    website: 'https://ctgsteel.example.com',
    rating: 4.2,
    reviewCount: 9,
    sourceUrl: 'https://directory.example.com/listings/mock-ctg-steel-works',
    contacts: [
      {
        type: ContactType.PHONE,
        rawValue: '০১৮১-১০০০০০৩',
        phoneType: PhoneType.MOBILE,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.LISTING_FIELD,
        snippet: 'যোগাযোগ: ০১৮১-১০০০০০৩'
      }
    ]
  },

  // 4. Sylhet business
  {
    externalId: 'mock-sylhet-tea-zindabazar-004',
    provider: MOCK_PROVIDER_NAME,
    name: 'Mock Surma Valley Tea House',
    category: 'Tea & Coffee',
    description: 'Authentic organic tea garden retail and wholesale in Sylhet city.',
    address: 'City Center, Zindabazar',
    locality: 'Zindabazar',
    city: 'Sylhet',
    region: 'Sylhet Division',
    country: 'BD',
    latitude: 24.8949,
    longitude: 91.8687,
    website: 'https://surmatea.example.com',
    rating: 4.8,
    reviewCount: 42,
    sourceUrl: 'https://directory.example.com/listings/mock-surma-valley-tea',
    contacts: [
      {
        type: ContactType.PHONE,
        rawValue: '01733000004',
        phoneType: PhoneType.MOBILE,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.LISTING_FIELD,
        snippet: 'Order Line: 01733000004'
      }
    ]
  },

  // 5. Business with NO website
  {
    externalId: 'mock-dhaka-bakery-mirpur-005',
    provider: MOCK_PROVIDER_NAME,
    name: 'Mock Bengal Bakes Mirpur',
    category: 'Bakery & Sweets',
    description: 'Fresh local bakery serving traditional cakes, biscuits, and sweets.',
    address: 'Section 10, Block C, Mirpur',
    locality: 'Mirpur-10',
    city: 'Dhaka',
    region: 'Dhaka Division',
    country: 'BD',
    latitude: 23.8069,
    longitude: 90.3687,
    // website omitted intentionally
    rating: 4.1,
    reviewCount: 35,
    sourceUrl: 'https://directory.example.com/listings/mock-bengal-bakes-mirpur',
    contacts: [
      {
        type: ContactType.PHONE,
        rawValue: '01911000005',
        phoneType: PhoneType.MOBILE,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.LISTING_FIELD,
        snippet: 'Shop Counter: 01911000005'
      }
    ]
  },

  // 6. Business with explicit publicly listed WhatsApp evidence (wa.me link)
  {
    externalId: 'mock-dhaka-fashion-banani-006',
    provider: MOCK_PROVIDER_NAME,
    name: 'Mock Nabila Boutique Banani',
    category: 'Fashion & Clothing',
    description: 'Designer ethnic wear, sarees, and custom tailoring for women.',
    address: 'Road 11, Block D, Banani',
    locality: 'Banani',
    city: 'Dhaka',
    region: 'Dhaka Division',
    country: 'BD',
    latitude: 23.7937,
    longitude: 90.4043,
    website: 'https://nabilaboutique.example.com',
    rating: 4.7,
    reviewCount: 64,
    sourceUrl: 'https://directory.example.com/listings/mock-nabila-boutique-banani',
    contacts: [
      {
        type: ContactType.WHATSAPP,
        rawValue: '+8801755000006',
        phoneType: PhoneType.MOBILE,
        whatsappStatus: WhatsAppStatus.PUBLICLY_LISTED,
        evidenceType: EvidenceType.WA_ME_LINK,
        sourceUrl: 'https://wa.me/8801755000006',
        snippet: 'Direct WhatsApp Customer Service: https://wa.me/8801755000006'
      }
    ]
  },

  // 7. Facebook-only / social-presence business with no normal website
  {
    externalId: 'mock-dhaka-handicrafts-uttara-007',
    provider: MOCK_PROVIDER_NAME,
    name: 'Mock Bengal Crafts Uttara',
    category: 'Handicrafts & Gifts',
    description: 'Handmade jute products, clay pottery, and traditional crafts.',
    address: 'Sector 7, Jasimuddin Avenue, Uttara',
    locality: 'Uttara Sector 7',
    city: 'Dhaka',
    region: 'Dhaka Division',
    country: 'BD',
    latitude: 23.8682,
    longitude: 90.3995,
    // website omitted intentionally
    sourceUrl: 'https://facebook.com/mockbengalcraftsuttara',
    rating: 4.5,
    reviewCount: 19,
    contacts: [
      {
        type: ContactType.PHONE,
        rawValue: '01611000007',
        phoneType: PhoneType.MOBILE,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.OFFICIAL_PAGE_TEXT,
        snippet: 'Official Facebook Page Contact: 01611000007'
      }
    ]
  },

  // 8. Dhaka landline business
  {
    externalId: 'mock-dhaka-legal-motijheel-008',
    provider: MOCK_PROVIDER_NAME,
    name: 'Mock Rahman Legal Chambers',
    category: 'Legal Services',
    description: 'Corporate law, taxation advisory, and commercial litigation chamber.',
    address: 'Commercial Court, Motijheel C/A',
    locality: 'Motijheel',
    city: 'Dhaka',
    region: 'Dhaka Division',
    country: 'BD',
    latitude: 23.7334,
    longitude: 90.4178,
    website: 'https://rahmanlegal.example.com',
    rating: 4.0,
    reviewCount: 6,
    sourceUrl: 'https://directory.example.com/listings/mock-rahman-legal-motijheel',
    contacts: [
      {
        type: ContactType.PHONE,
        rawValue: '029876543',
        phoneType: PhoneType.LANDLINE,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.LISTING_FIELD,
        snippet: 'Chamber Office Landline: 02-9876543'
      }
    ]
  },

  // 9. Business with malformed / invalid phone
  {
    externalId: 'mock-dhaka-repair-farmgate-009',
    provider: MOCK_PROVIDER_NAME,
    name: 'Mock QuickFix Electronics Farmgate',
    category: 'Electronics Repair',
    description: 'Fast smartphone, laptop, and home appliance repairs.',
    address: 'Green Road, Farmgate',
    locality: 'Farmgate',
    city: 'Dhaka',
    region: 'Dhaka Division',
    country: 'BD',
    latitude: 23.7571,
    longitude: 90.3892,
    website: 'https://quickfix.example.com',
    rating: 3.8,
    reviewCount: 11,
    sourceUrl: 'https://directory.example.com/listings/mock-quickfix-farmgate',
    contacts: [
      {
        type: ContactType.PHONE,
        rawValue: '01234567890', // Invalid BD operator 012
        phoneType: PhoneType.UNKNOWN,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.LISTING_FIELD,
        snippet: 'Listing Phone: 01234567890'
      }
    ]
  },

  // 10. Business with NO phone
  {
    externalId: 'mock-dhaka-gallery-shahbagh-010',
    provider: MOCK_PROVIDER_NAME,
    name: 'Mock Shilpakala Heritage Gallery',
    category: 'Art Gallery & Exhibitions',
    description: 'Contemporary Bangladeshi fine art, sculptures, and cultural exhibitions.',
    address: 'Segunbagicha, Shahbagh',
    locality: 'Shahbagh',
    city: 'Dhaka',
    region: 'Dhaka Division',
    country: 'BD',
    latitude: 23.7381,
    longitude: 90.3958,
    website: 'https://shilpakaala.example.com',
    rating: 4.9,
    reviewCount: 52,
    sourceUrl: 'https://directory.example.com/listings/mock-shilpakala-gallery',
    contacts: [] // No phone
  }
]);
