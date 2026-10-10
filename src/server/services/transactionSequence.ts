import type { D1Database } from '@cloudflare/workers-types';

/**
 * Allocates the next company-scoped transaction number.
 * Foundation-only in Phase 6; no transaction UI calls it yet.
 */
export async function allocateTransactionNumber(db: D1Database, companyId: string): Promise<number> {
  const row = await db.prepare(`
    INSERT INTO transaction_sequences(company_id,next_number)
    VALUES(?,2)
    ON CONFLICT(company_id) DO UPDATE SET
      next_number=transaction_sequences.next_number+1,
      updated_at=CURRENT_TIMESTAMP
    RETURNING next_number-1 AS allocated_number
  `).bind(companyId).first<{allocated_number:number}>();
  const value = Number(row?.allocated_number);
  if (!Number.isInteger(value) || value < 1) throw new Error('TRANSACTION_SEQUENCE_ALLOCATION_FAILED');
  return value;
}
