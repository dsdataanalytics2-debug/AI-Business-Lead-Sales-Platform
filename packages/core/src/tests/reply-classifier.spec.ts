import { describe, it, expect } from 'vitest';
import { classifyInboundReply } from '../outreach/reply-classifier.js';

describe('ReplyClassifier', () => {
  describe('English Replies', () => {
    it('classifies UNSUBSCRIBE with highest priority and isOptOut=true', () => {
      const res = classifyInboundReply('Please unsubscribe me from this list and do not contact again.');
      expect(res.classification).toBe('UNSUBSCRIBE');
      expect(res.isOptOut).toBe(true);
      expect(res.confidence).toBe(1.0);
    });

    it('classifies ORDER_INTENT', () => {
      const res = classifyInboundReply('We are ready to place an order for 50 pieces. Send invoice.');
      expect(res.classification).toBe('ORDER_INTENT');
      expect(res.isOptOut).toBe(false);
    });

    it('classifies PRICE_REQUEST', () => {
      const res = classifyInboundReply('What is your best wholesale price per unit for 100 units?');
      expect(res.classification).toBe('PRICE_REQUEST');
    });

    it('classifies MOQ_REQUEST', () => {
      const res = classifyInboundReply('What is the MOQ for this lamp line? How many pieces minimum?');
      expect(res.classification).toBe('MOQ_REQUEST');
    });

    it('classifies PRODUCT_INFO_REQUEST', () => {
      const res = classifyInboundReply('Please send your full catalog, specification sheet and photos.');
      expect(res.classification).toBe('PRODUCT_INFO_REQUEST');
    });

    it('classifies FOLLOW_UP_LATER', () => {
      const res = classifyInboundReply('We are busy right now with stock audit, please follow up next week.');
      expect(res.classification).toBe('FOLLOW_UP_LATER');
    });

    it('classifies NOT_INTERESTED', () => {
      const res = classifyInboundReply('No thanks, we already have an exclusive supplier.');
      expect(res.classification).toBe('NOT_INTERESTED');
    });

    it('classifies INTERESTED', () => {
      const res = classifyInboundReply('Sounds good, let us discuss this further over a call.');
      expect(res.classification).toBe('INTERESTED');
    });

    it('classifies UNCLASSIFIED for ambiguous input', () => {
      const res = classifyInboundReply('Hello there ok.');
      expect(res.classification).toBe('UNCLASSIFIED');
    });
  });

  describe('Bangla Replies', () => {
    it('classifies UNSUBSCRIBE in Bangla with isOptOut=true', () => {
      const res1 = classifyInboundReply('আমাদের সাথে আর যোগাযোগ করবেন না');
      expect(res1.classification).toBe('UNSUBSCRIBE');
      expect(res1.isOptOut).toBe(true);

      const res2 = classifyInboundReply('দয়া করে মেসেজ করবেন না');
      expect(res2.classification).toBe('UNSUBSCRIBE');
      expect(res2.isOptOut).toBe(true);
    });

    it('classifies ORDER_INTENT in Bangla', () => {
      const res = classifyInboundReply('আমরা ১০০ পিসের অর্ডার দিতে চাই, চালান পাঠান');
      expect(res.classification).toBe('ORDER_INTENT');
    });

    it('classifies PRICE_REQUEST in Bangla', () => {
      const res = classifyInboundReply('পাইকারি দাম কত করে পরবে? রেট কত?');
      expect(res.classification).toBe('PRICE_REQUEST');
    });

    it('classifies MOQ_REQUEST in Bangla', () => {
      const res = classifyInboundReply('সর্বনিম্ন কত পিস নিতে হবে? মিনিমাম অর্ডার কত?');
      expect(res.classification).toBe('MOQ_REQUEST');
    });

    it('classifies PRODUCT_INFO_REQUEST in Bangla', () => {
      const res = classifyInboundReply('আপনাদের প্রোডাক্ট ক্যাটালগ ও ছবি দেখতে চাই');
      expect(res.classification).toBe('PRODUCT_INFO_REQUEST');
    });

    it('classifies FOLLOW_UP_LATER in Bangla', () => {
      const res = classifyInboundReply('এখন একটু ব্যস্ত আছি, আগামী সপ্তাহে জানান');
      expect(res.classification).toBe('FOLLOW_UP_LATER');
    });

    it('classifies NOT_INTERESTED in Bangla', () => {
      const res = classifyInboundReply('আমাদের এখন প্রয়োজন নেই, লাগবে না');
      expect(res.classification).toBe('NOT_INTERESTED');
    });

    it('classifies INTERESTED in Bangla', () => {
      const res = classifyInboundReply('আমরা আগ্রহী, কালকে একটু ফোন দিন');
      expect(res.classification).toBe('INTERESTED');
    });
  });
});
