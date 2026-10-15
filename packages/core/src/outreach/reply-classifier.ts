/**
 * Pure Reply Classification Engine
 *
 * Implements deterministic classification of inbound B2B customer replies.
 * Supports both English and Bangla expressions.
 *
 * INVARIANTS:
 * - Pure Function: Zero side-effects, zero network calls, zero LLMs.
 * - Deterministic: Same input string always produces the exact same classification.
 * - Categorization Hierarchy:
 *   1. UNSUBSCRIBE (Safety & Compliance highest priority)
 *   2. ORDER_INTENT
 *   3. PRICE_REQUEST
 *   4. MOQ_REQUEST
 *   5. PRODUCT_INFO_REQUEST
 *   6. FOLLOW_UP_LATER
 *   7. INTERESTED / NOT_INTERESTED
 *   8. UNCLASSIFIED (fallback for ambiguous or unrecognized text)
 */

import type { ReplyClassificationCategory } from '@leadmate/shared';

export interface ReplyClassificationResult {
  classification: ReplyClassificationCategory;
  confidence: number;
  matchedSignals: string[];
  isOptOut: boolean;
}

interface PatternRule {
  classification: ReplyClassificationCategory;
  confidence: number;
  pattern: RegExp;
  signalName: string;
}

// Ordered deterministic rules (evaluated from top to bottom)
const CLASSIFICATION_RULES: PatternRule[] = [
  // 1. UNSUBSCRIBE / DO-NOT-CONTACT (Highest Priority)
  {
    classification: 'UNSUBSCRIBE',
    confidence: 1.0,
    pattern: /\b(?:stop|unsubscribe|opt\s*out|remove\s+me|leave\s+me\s+alone|don'?t\s+(?:message|email|contact|call)|do\s+not\s+(?:contact|call|email|message))\b/i,
    signalName: 'EN_OPT_OUT'
  },
  {
    classification: 'UNSUBSCRIBE',
    confidence: 1.0,
    pattern: /(?:আর\s+যোগাযোগ\s+করবেন\s+না|মেসেজ\s+করবেন\s+না|মেসেজ\s+দিবেন\s+না|আনসাবস্ক্রাইব|বন্ধ\s+করুন|বিরক্তি\s+করবেন\s+না|বিরক্ত\s+করবেন\s+না|ডিলিট\s+করুন|ফোন\s+দিবেন\s+না)/,
    signalName: 'BN_OPT_OUT'
  },

  // 2. ORDER_INTENT (Explicit purchase/order/closing action)
  {
    classification: 'ORDER_INTENT',
    confidence: 0.95,
    pattern: /\b(?:place\s+(?:(?:an?|the|our)\s+)?(?:[a-z]+\s+)?order|confirm\s+(?:the\s+)?order|send\s+(?:(?:an?|the)\s+)?invoice|purchase\s+order|\bpo\b|want\s+to\s+(?:buy|order)|ready\s+to\s+order|ship\s+to|billing\s+details)\b/i,
    signalName: 'EN_ORDER_INTENT'
  },
  {
    classification: 'ORDER_INTENT',
    confidence: 0.95,
    pattern: /(?:অর্ডার\s+দিতে\s+চাই|অর্ডার\s+নিশ্চিত\s+করুন|চালান\s+পাঠান|ইনভয়েস\s+পাঠান|কিনতে\s+চাই|বুকিং\s+দিন|অর্ডার\s+নিবেন)/,
    signalName: 'BN_ORDER_INTENT'
  },

  // 3. PRICE_REQUEST (Asking for cost, quote, discounts, rate)
  {
    classification: 'PRICE_REQUEST',
    confidence: 0.9,
    pattern: /\b(?:price|pricing|quote|quotation|cost|rate|wholesale\s+price|bulk\s+price|discount|how\s+much)\b/i,
    signalName: 'EN_PRICE_REQUEST'
  },
  {
    classification: 'PRICE_REQUEST',
    confidence: 0.9,
    pattern: /(?:দাম\s+কত|প্রাইস\s+কত|রেট\s+কত|কোটেশন\s+পাঠান|পাইকারি\s+দাম\s+কত|পাইকারি\s+রেট|কত\s+টাকা|ডিসকাউন্ট\s+আছে)/,
    signalName: 'BN_PRICE_REQUEST'
  },

  // 4. MOQ_REQUEST (Asking for minimum order quantities or volume thresholds)
  {
    classification: 'MOQ_REQUEST',
    confidence: 0.9,
    pattern: /\b(?:moq|minimum\s+order|min\s+order|minimum\s+quantity|min\s+qty|how\s+many\s+pieces\s+minimum|minimum\s+pieces)\b/i,
    signalName: 'EN_MOQ_REQUEST'
  },
  {
    classification: 'MOQ_REQUEST',
    confidence: 0.9,
    pattern: /(?:সর্বনিম্ন\s+কত\s+পিস|ন্যূনতম\s+পরিমাণ|এমওকিউ|কত\s+পিস\s+নিতে\s+হবে|কমপক্ষে\s+কত|মিনিমাম\s+অর্ডার)/,
    signalName: 'BN_MOQ_REQUEST'
  },

  // 5. PRODUCT_INFO_REQUEST (Catalog, brochure, specs, samples, technical details)
  {
    classification: 'PRODUCT_INFO_REQUEST',
    confidence: 0.85,
    pattern: /\b(?:catalog|catalogue|brochure|specs|specification|details|pictures?|photos?|samples?|warranty|datasheet|product\s+list)\b/i,
    signalName: 'EN_PRODUCT_INFO_REQUEST'
  },
  {
    classification: 'PRODUCT_INFO_REQUEST',
    confidence: 0.85,
    pattern: /(?:ক্যাটালগ|ব্রোশিউর|বিস্তারিত\s+বিবরণ|ছবি\s+দেখতে\s+চাই|স্যাম্পল|নমুনা|স্পেসিফিকেশন|ওয়ারেন্টি\s+কতদিন|প্রোডাক্ট\s+লিস্ট)/,
    signalName: 'BN_PRODUCT_INFO_REQUEST'
  },

  // 6. FOLLOW_UP_LATER (Busy, postpone, timing postponement)
  {
    classification: 'FOLLOW_UP_LATER',
    confidence: 0.85,
    pattern: /\b(?:next\s+week|later|next\s+month|busy\s+(?:right\s+now|today)|call\s+(?:me\s+)?tomorrow|follow\s+up\s+later|contact\s+next\s+month|not\s+now)\b/i,
    signalName: 'EN_FOLLOW_UP_LATER'
  },
  {
    classification: 'FOLLOW_UP_LATER',
    confidence: 0.85,
    pattern: /(?:পরে\s+কথা\s+বলি|ব্যস্ত\s+আছি|আগামী\s+সপ্তাহে|কাল\s+ফোন\s+করুন|পরের\s+মাসে|এখন\s+না|পরে\s+জানাব)/,
    signalName: 'BN_FOLLOW_UP_LATER'
  },

  // 7. NOT_INTERESTED (Polite or direct decline)
  {
    classification: 'NOT_INTERESTED',
    confidence: 0.9,
    pattern: /\b(?:not\s+interested|no\s+thanks|don'?t\s+need|already\s+have\s+supplier|pass|no\s+interest)\b/i,
    signalName: 'EN_NOT_INTERESTED'
  },
  {
    classification: 'NOT_INTERESTED',
    confidence: 0.9,
    pattern: /(?:আগ্রহী\s+নই|প্রয়োজন\s+নেই|লাগবে\s+না|অন্য\s+সাপ্লায়ার\s+আছে|দরকার\s+নেই|ইন্টারেস্টেড\s+না)/,
    signalName: 'BN_NOT_INTERESTED'
  },

  // 8. INTERESTED (Commercial interest / openness to connect)
  {
    classification: 'INTERESTED',
    confidence: 0.8,
    pattern: /\b(?:interested|sounds\s+good|let'?s\s+discuss|call\s+me|meeting|let'?s\s+talk|tell\s+me\s+more|share\s+details)\b/i,
    signalName: 'EN_INTERESTED'
  },
  {
    classification: 'INTERESTED',
    confidence: 0.8,
    pattern: /(?:আগ্রহী|কথা\s+বলতে\s+চাই|ফোন\s+দিন|ভালো\s+লাগলো|আলোচনা\s+করা\s+যায়|জানান)/,
    signalName: 'BN_INTERESTED'
  }
];

export function classifyInboundReply(text: string): ReplyClassificationResult {
  const cleanText = (text || '').trim();
  if (!cleanText) {
    return {
      classification: 'UNCLASSIFIED',
      confidence: 0,
      matchedSignals: [],
      isOptOut: false
    };
  }

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(cleanText)) {
      return {
        classification: rule.classification,
        confidence: rule.confidence,
        matchedSignals: [rule.signalName],
        isOptOut: rule.classification === 'UNSUBSCRIBE'
      };
    }
  }

  return {
    classification: 'UNCLASSIFIED',
    confidence: 0.3,
    matchedSignals: [],
    isOptOut: false
  };
}
