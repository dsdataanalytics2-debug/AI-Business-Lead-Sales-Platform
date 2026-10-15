/**
 * Pure Outreach Personalization Composer
 *
 * Builds tailored B2B commercial outreach drafts using verified evidence and structured profiles.
 *
 * INVARIANTS:
 * - Pure Function: Zero side-effects, zero network calls, zero external APIs.
 * - Always DRAFT: Every generated draft is born with status DRAFT. Never auto-sent or auto-approved.
 * - Truth in Sourcing: Never claims buyer requested product unless explicit RFQ/procurement evidence exists.
 * - Related Needs: Always presented as suggestions, never verified commercial demand.
 * - PHONE != WHATSAPP: Never asserts recipient has WhatsApp without explicit wa.me / verified listing evidence.
 */

import type {
  OutreachDraftChannel,
  IdealBuyerProfile,
  SourceEvidence,
  EnrichedContact
} from '@leadmate/shared';

export interface PersonalizationProductInput {
  name: string;
  description?: string | null;
  category?: string | null;
  price?: number | string | null;
  moq?: number | string | null;
}

export interface PersonalizationBuyerInput {
  id?: string;
  businessName: string;
  category?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  website?: string | null;
  wholesaleIntent?: string | null;
  wholesaleIntentSignals?: string[] | null;
  suggestedRelatedNeeds?: string[] | null;
  sourceEvidences?: Array<Partial<SourceEvidence>> | null;
  enrichedContacts?: Array<Partial<EnrichedContact>> | null;
  whatsappStatus?: string | null;
  buyerScore?: number | null;
  priority?: string | null;
}

export interface PersonalizationComposerInput {
  product: PersonalizationProductInput;
  buyer: PersonalizationBuyerInput;
  idealBuyerProfile?: IdealBuyerProfile | null;
  channel?: OutreachDraftChannel;
  language?: 'EN' | 'BN';
}

export interface GeneratedOutreachDraft {
  channel: OutreachDraftChannel;
  status: 'DRAFT';
  language: 'EN' | 'BN';
  subject: string | null;
  body: string;
  aiContextSnapshot: {
    productName: string;
    productCategory?: string | null;
    buyerName: string;
    buyerCategory?: string | null;
    matchedPitchAngle?: string | null;
    citedEvidence?: string | null;
    citesRfqEvidence: boolean;
    relatedNeedsCited: string[];
    wholesaleIntent: string;
    whatsappVerified: boolean;
    buyerScore?: number | null;
    priority?: string | null;
  };
  warnings: string[];
}

export function composePersonalizedOutreach(
  input: PersonalizationComposerInput
): GeneratedOutreachDraft {
  const channel: OutreachDraftChannel = input.channel || 'EMAIL';
  const language = input.language || 'EN';
  const warnings: string[] = [];

  const { product, buyer, idealBuyerProfile } = input;
  const buyerName = buyer.businessName.trim();
  const buyerCity = buyer.city?.trim() || 'your area';

  // 1. Verify RFQ evidence to prevent false demand claims
  let hasRfqEvidence = false;
  let rfqSnippet: string | null = null;

  if (Array.isArray(buyer.sourceEvidences)) {
    for (const ev of buyer.sourceEvidences) {
      if (
        ev.evidenceType === 'PUBLIC_RFQ' ||
        (ev.snippet && /\b(?:rfq|procurement|tender|buying request)\b/i.test(ev.snippet))
      ) {
        hasRfqEvidence = true;
        rfqSnippet = ev.snippet || 'commercial procurement notice';
        break;
      }
    }
  }

  // 2. Select matching pitch angle from Ideal Buyer Profile
  let pitchAngle = 'reliable wholesale supply with consistent stock availability';
  if (idealBuyerProfile?.recommendedPitchAngles && idealBuyerProfile.recommendedPitchAngles.length > 0) {
    pitchAngle = idealBuyerProfile.recommendedPitchAngles[0];
  }

  // 3. Formulate Related Needs mention as an explicit suggestion
  const relatedNeeds = Array.isArray(buyer.suggestedRelatedNeeds) ? buyer.suggestedRelatedNeeds.slice(0, 3) : [];

  // 4. Check WhatsApp verification status
  const isWaVerified = buyer.whatsappStatus === 'EXPLICIT_VERIFIED';
  if (channel === 'WHATSAPP_DRAFT' && !isWaVerified) {
    warnings.push('WHATSAPP_UNVERIFIED: Phone number is not explicitly verified for WhatsApp on official channels. Draft prepared for manual verification.');
  }

  let subject: string | null = null;
  let body = '';

  if (language === 'BN') {
    // Bangla composition
    if (channel === 'EMAIL') {
      subject = hasRfqEvidence
        ? `পাইকারি সরবরাহ সংক্রান্ত প্রস্তাব: ${product.name} — ${buyerName}`
        : `${product.name} পাইকারি সরবরাহ ও ডিস্ট্রিবিউশন সংক্রান্ত প্রস্তাব`;

      body = `শ্রদ্ধেয় ${buyerName} টিম,\n\n`;
      body += `শুভেচ্ছা জানবেন। `;

      if (hasRfqEvidence) {
        body += `আমরা আপনার সাম্প্রতিক বাণিজ্যিক সংগ্রহ নোটিশ লক্ষ্য করেছি (${rfqSnippet})। `;
      } else {
        body += `${buyerCity}-তে আপনার ব্যবসা সম্পর্কে জেনে আমরা আনন্দিত। `;
      }

      body += `আমরা সরাসরি প্রস্তুতকারক/আমদানিকারক হিসেবে উচ্চমানের **${product.name}** পাইকারি সরবরাহের প্রস্তাব দিচ্ছি। ${product.description ? product.description + '\n\n' : '\n\n'}`;

      if (product.price || product.moq) {
        body += `বাণিজ্যিক বিবরণ:\n`;
        if (product.price) body += `- প্রারম্ভিক পাইকারি মূল্য: ${product.price} BDT\n`;
        if (product.moq) body += `- ন্যূনতম অর্ডার পরিমাণ (MOQ): ${product.moq} পিস\n`;
        body += `\n`;
      }

      if (relatedNeeds.length > 0) {
        body += `আপনার বর্তমান ইনভেন্টরির সাথে পরিপূরক হিসেবে আমরা ${relatedNeeds.join(', ')} সরবরাহ করতে সক্ষম (পরামর্শমূলক বিকল্প)।\n\n`;
      }

      body += `মূল সুবিধা: ${pitchAngle}।\n\n`;
      body += `আপনার সুবিধাজনক সময়ে একটি প্রোডাক্ট ক্যাটালগ ও স্যাম্পল পাঠানো কি সমীচীন হবে?\n\nধন্যবাদান্তে,\nসেলস টিম`;
    } else if (channel === 'WHATSAPP_DRAFT') {
      body = `সালাম ${buyerName} টিম, ${buyerCity}-তে আপনাদের ব্যবসার জন্য **${product.name}** পাইকারি সরবরাহে আমরা আগ্রহী। `;
      if (hasRfqEvidence) {
        body += `আপনাদের সাম্প্রতিক রিকোয়ারমেন্ট অনুযায়ী `;
      }
      body += `আমরা আকর্ষণীয় মার্জিনে সরাসরি সরবরাহ নিশ্চিত করছি। `;
      if (product.moq) body += `(MOQ: ${product.moq} পিস)। `;
      body += `একটি সংক্ষিপ্ত প্রোডাক্ট ক্যাটালগ পাঠাবো কি? ধন্যবাদ।`;
    } else if (channel === 'SMS_DRAFT') {
      body = `${buyerName}: ${product.name} পাইকারি সরবরাহে আকর্ষণীয় ডিলার রেট ও স্টক সুবিধা। ক্যাটালগ দেখতে উত্তর দিন।`;
    } else {
      // CALL_SCRIPT
      body = `[কল স্ক্রিপ্ট — ${buyerName}]\n1. শুভেচ্ছা: "সালাম, আমি কি ${buyerName}-এর পারচেজ/প্রোকিউরমেন্ট ম্যানেজারের সাথে কথা বলছি?"\n2. প্রসঙ্গ: "${product.name}-এর পাইকারি সরবরাহ ও ডিলারশিপ সংক্রান্ত।"\n3. মূল পয়েন্ট: "${pitchAngle}।"\n4. কল টু অ্যাকশন: "আমরা কি আপনাদের জন্য একটি স্যাম্পল এবং অফিশিয়াল রেট কার্ড পাঠাতে পারি?"`;
    }
  } else {
    // English composition
    if (channel === 'EMAIL') {
      subject = hasRfqEvidence
        ? `Wholesale Supply Proposal for ${buyerName}: ${product.name}`
        : `Wholesale Partnership Proposal: ${product.name} for ${buyerName}`;

      body = `Dear ${buyerName} Team,\n\n`;
      body += `Hope this email finds you well. `;

      if (hasRfqEvidence) {
        body += `We noted your public trade inquiry regarding wholesale supply (${rfqSnippet}). `;
      } else {
        body += `We came across your commercial operations in ${buyerCity} and wanted to reach out regarding wholesale inventory. `;
      }

      body += `We are a primary supplier offering bulk availability of **${product.name}**.\n\n`;
      if (product.description) {
        body += `${product.description}\n\n`;
      }

      if (product.price || product.moq) {
        body += `Commercial Terms:\n`;
        if (product.price) body += `- Wholesale Unit Pricing: ${product.price} BDT\n`;
        if (product.moq) body += `- Minimum Order Quantity (MOQ): ${product.moq} units\n`;
        body += `\n`;
      }

      if (relatedNeeds.length > 0) {
        body += `To complement your category range, we can also support related items such as ${relatedNeeds.join(', ')} (advisory catalog options).\n\n`;
      }

      body += `Key Advantage: ${pitchAngle}.\n\n`;
      body += `Would it be helpful to share our complete wholesale catalog and pricing sheet for your review?\n\nBest regards,\nCommercial Sales Team`;
    } else if (channel === 'WHATSAPP_DRAFT') {
      body = `Hello ${buyerName} team, reaching out regarding bulk supply of **${product.name}** for your ${buyerCity} operations. `;
      if (hasRfqEvidence) {
        body += `In reference to your wholesale requirement, `;
      }
      body += `we offer factory-direct wholesale pricing with fast stock fulfillment. `;
      if (product.moq) body += `(MOQ: ${product.moq} units). `;
      body += `May we share our product catalog and pricing sheet? Thanks!`;
    } else if (channel === 'SMS_DRAFT') {
      body = `${buyerName}: Bulk supply of ${product.name} with verified dealer pricing available. Reply for product catalog and price sheet.`;
    } else {
      // CALL_SCRIPT
      body = `[Call Script — ${buyerName}]\n1. Intro: "Hello, could I speak with the purchasing or store manager for ${buyerName}?"\n2. Context: "Calling regarding wholesale supply of ${product.name}."\n3. Value proposition: "${pitchAngle}."\n4. CTA: "May I email or message our pricing sheet and samples for your review?"`;
    }
  }

  return {
    channel,
    status: 'DRAFT',
    language,
    subject,
    body,
    aiContextSnapshot: {
      productName: product.name,
      productCategory: product.category,
      buyerName,
      buyerCategory: buyer.category,
      matchedPitchAngle: pitchAngle,
      citedEvidence: rfqSnippet,
      citesRfqEvidence: hasRfqEvidence,
      relatedNeedsCited: relatedNeeds,
      wholesaleIntent: buyer.wholesaleIntent || 'NONE',
      whatsappVerified: isWaVerified,
      buyerScore: buyer.buyerScore,
      priority: buyer.priority
    },
    warnings
  };
}
