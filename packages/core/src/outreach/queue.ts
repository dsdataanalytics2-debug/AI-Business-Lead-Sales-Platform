/**
 * Minimal BullMQ / in-memory job data contract for outreach delivery.
 *
 * STRICT EXCLUSION:
 * - NO organizationId
 * - NO recipient details or PII
 * - NO message bodies or snapshots
 * - NO provider configuration or API keys
 * - NO user credentials or sessions
 *
 * Background worker derives full context and authority by reloading
 * the OutreachDelivery record from PostgreSQL.
 */
export interface OutreachDeliveryJobPayload {
  readonly deliveryId: string;
}

export interface OutreachDeliveryQueueEnqueueResult {
  readonly jobId: string;
}

/**
 * Provider-agnostic queue interface for enqueuing outreach deliveries.
 */
export interface OutreachDeliveryQueue {
  enqueue(payload: OutreachDeliveryJobPayload): Promise<OutreachDeliveryQueueEnqueueResult>;
}

/**
 * In-memory deterministic queue implementation for offline unit tests and simulation.
 */
export class InMemoryOutreachDeliveryQueue implements OutreachDeliveryQueue {
  public jobs: Array<{ jobId: string; payload: OutreachDeliveryJobPayload }> = [];
  private shouldFailNext = false;
  private failError: Error | null = null;

  public async enqueue(payload: OutreachDeliveryJobPayload): Promise<OutreachDeliveryQueueEnqueueResult> {
    if (this.shouldFailNext) {
      this.shouldFailNext = false;
      throw this.failError ?? new Error('Simulated queue failure');
    }

    const jobId = payload.deliveryId;
    const existingIndex = this.jobs.findIndex((j) => j.jobId === jobId);
    if (existingIndex >= 0) {
      // Deduplicate by jobId
      this.jobs[existingIndex] = { jobId, payload };
    } else {
      this.jobs.push({ jobId, payload });
    }

    return { jobId };
  }

  public simulateFailure(error?: Error): void {
    this.shouldFailNext = true;
    this.failError = error ?? new Error('Simulated queue failure');
  }

  public clear(): void {
    this.jobs = [];
    this.shouldFailNext = false;
    this.failError = null;
  }
}
