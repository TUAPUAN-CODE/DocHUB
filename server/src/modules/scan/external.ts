import { badRequest } from '../../shared/http';
import { delayHubConfigured, delayHubUrl } from '../delayReport/bootstrap';
import { assertAllowedUrl } from '../connectors/safeFetch';
import { logger } from '../../shared/logger';
import { ScanProfile, splitScan } from './parse';

/** One mapping of DelayHUB (read-only API with the shared export key) */
export interface DelayMapping { mapping_id: number; code: string | null; mat: string | null; mat_name: string | null; mat_2x: string | null; batch: string | null; batch_2x: string | null }

/** null = DelayHUB does not know the number; throws when DelayHUB cannot be reached */
export async function fetchDelayMapping(id: number): Promise<DelayMapping | null> {
  if (!delayHubConfigured()) throw new Error('ยังไม่ได้ตั้ง DELAYHUB_URL / DELAYHUB_EXPORT_KEY ใน .env ของ DocHUB');
  const u = await assertAllowedUrl(`${delayHubUrl()}/api/export/mapping/${id}`);
  const r = await fetch(u, { headers: { 'x-export-key': String(process.env.DELAYHUB_EXPORT_KEY ?? '') }, signal: AbortSignal.timeout(8000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`DelayHUB ตอบ ${r.status}`);
  const j = (await r.json()) as { data?: DelayMapping };
  return j.data ?? null;
}

/** Values (column id → text) that DelayHUB gives for the mapping_id in the scanned text; what the QR itself carried is kept by the caller */
export async function externalValues(profile: ScanProfile, text: string, scanned: Record<string, string>): Promise<Record<string, string>> {
  const ex = profile.external;
  if (!ex) return {};
  const piece = splitScan(text, profile.delimiter)[ex.pieceIndex - 1] ?? '';
  const id = /^\d{1,10}$/.test(piece) ? Number(piece) : 0;
  const miss = (why: string) => { if (ex.onMiss === 'reject') throw badRequest(why); return {} as Record<string, string>; };
  if (!id) return miss(`QR นี้ไม่มี mapping_id ในช่องที่ ${ex.pieceIndex} (“${piece}”)`);
  let m: DelayMapping | null;
  try { m = await fetchDelayMapping(id); } catch (e) {
    logger.warn(`scan external: mapping ${id}: ${(e as Error).message}`);
    return miss(`อ่านข้อมูล mapping_id ${id} จาก DelayHUB ไม่สำเร็จ: ${(e as Error).message}`);
  }
  if (!m) return miss(`ไม่พบ mapping_id ${id} ใน DelayHUB`);
  const out: Record<string, string> = {};
  for (const f of ex.fill) {
    const v = m[f.field];
    if (v !== null && v !== undefined && String(v).trim() !== '' && !(f.toColumnId in scanned)) out[f.toColumnId] = String(v).trim();
  }
  return out;
}
