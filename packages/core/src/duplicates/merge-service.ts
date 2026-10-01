/**
 * Transactional Merge Service
 *
 * Executes a deterministic merge plan inside a PostgreSQL / Prisma transaction.
 */

import type { PrismaClient, Prisma } from '@leadmate/db';
import { planMerge, type ExistingLeadRecord } from './merge-planner.js';
import type { IncomingLeadData, MergeExecutionResult, MergePlan } from './types.js';

/**
 * Merges incoming lead data into an existing target lead within a transaction.
 *
 * @param prisma - PrismaClient or TransactionClient
 * @param targetLeadId - Existing lead ID to merge into
 * @param incomingData - Incoming data from discovery/manual source
 * @returns MergeExecutionResult detailing updated fields and additions
 */
export async function mergeIntoExistingLead(
  prisma: PrismaClient | Prisma.TransactionClient,
  targetLeadId: string,
  incomingData: IncomingLeadData
): Promise<MergeExecutionResult> {
  const { organizationId } = incomingData;

  // 1. Fetch full existing lead with contacts and sources
  const existingLead = await prisma.lead.findFirst({
    where: {
      id: targetLeadId,
      organizationId
    },
    include: {
      contacts: {
        include: { evidence: true }
      },
      sources: true
    }
  });

  if (!existingLead) {
    throw new Error(
      `Target lead "${targetLeadId}" not found in organization "${organizationId}"`
    );
  }

  // 2. Compute non-destructive merge plan
  const plan: MergePlan = planMerge(
    existingLead as unknown as ExistingLeadRecord,
    incomingData
  );

  // 3. Execute merge plan within a transaction
  // If already in a transaction, use existing tx; otherwise start a new transaction
  const executeInTx = async (tx: Prisma.TransactionClient): Promise<MergeExecutionResult> => {
    const updatedFields: string[] = [];

    // 3A. Apply scalar field updates on Lead
    if (Object.keys(plan.scalarUpdates).length > 0) {
      await tx.lead.update({
        where: { id: plan.targetLeadId },
        data: plan.scalarUpdates
      });
      updatedFields.push(...Object.keys(plan.scalarUpdates));
    }

    // 3B. Insert brand new contacts
    let addedContactsCount = 0;
    for (const newContact of plan.newContacts) {
      await tx.leadContact.create({
        data: {
          leadId: plan.targetLeadId,
          type: newContact.type,
          rawValue: newContact.rawValue,
          normalizedValue: newContact.normalizedValue,
          phoneType: newContact.phoneType || undefined,
          status: newContact.status,
          whatsappStatus: newContact.whatsappStatus,
          isPrimary: newContact.isPrimary,
          evidence: {
            create: newContact.evidence.map((ev) => ({
              sourceName: ev.sourceName,
              sourceUrl: ev.sourceUrl || undefined,
              evidenceType: ev.evidenceType as any,
              snippet: ev.snippet || undefined
            }))
          }
        }
      });
      addedContactsCount++;
    }

    // 3C. Add new evidence to existing contacts
    let addedEvidenceCount = 0;
    for (const item of plan.newEvidenceForExistingContacts) {
      await tx.contactEvidence.create({
        data: {
          contactId: item.contactId,
          sourceName: item.evidence.sourceName,
          sourceUrl: item.evidence.sourceUrl || undefined,
          evidenceType: item.evidence.evidenceType as any,
          snippet: item.evidence.snippet || undefined
        }
      });
      addedEvidenceCount++;
    }

    // 3D. Apply non-downgrading status updates to existing contacts
    for (const update of plan.contactUpdates || []) {
      const data: Prisma.LeadContactUpdateInput = {};
      if (update.status) data.status = update.status;
      if (update.whatsappStatus) data.whatsappStatus = update.whatsappStatus;
      if (Object.keys(data).length > 0) {
        await tx.leadContact.update({
          where: { id: update.contactId },
          data
        });
      }
    }

    // 3E. Upsert / record source provenance
    let sourceUpdated = false;
    if (plan.sourceToUpsert && plan.sourceToUpsert.sourceName) {
      const { sourceName, sourceExternalId, sourceUrl, rawData } = plan.sourceToUpsert;

      if (sourceExternalId) {
        // Use composite unique key (organizationId, sourceName, sourceExternalId)
        await tx.leadSource.upsert({
          where: {
            organizationId_sourceName_sourceExternalId: {
              organizationId: plan.organizationId,
              sourceName,
              sourceExternalId
            }
          },
          create: {
            leadId: plan.targetLeadId,
            organizationId: plan.organizationId,
            sourceName,
            sourceExternalId,
            sourceUrl: sourceUrl || undefined,
            rawData: rawData ?? undefined,
            fetchedAt: new Date()
          },
          update: {
            sourceUrl: sourceUrl || undefined,
            rawData: rawData ?? undefined,
            fetchedAt: new Date()
          }
        });
        sourceUpdated = true;
      } else {
        // Source without external ID: create new row
        await tx.leadSource.create({
          data: {
            leadId: plan.targetLeadId,
            organizationId: plan.organizationId,
            sourceName,
            sourceExternalId: null,
            sourceUrl: sourceUrl || undefined,
            rawData: rawData ?? undefined,
            fetchedAt: new Date()
          }
        });
        sourceUpdated = true;
      }
    }

    return {
      success: true,
      leadId: plan.targetLeadId,
      updatedFields,
      addedContactsCount,
      addedEvidenceCount,
      sourceUpdated
    };
  };

  if ('$transaction' in prisma) {
    return (prisma as PrismaClient).$transaction(async (tx) => executeInTx(tx));
  } else {
    return executeInTx(prisma as Prisma.TransactionClient);
  }
}
