import { RequestHandler } from 'express';
import { q, T } from '../../config/db';
import { logger } from '../../shared/logger';

/**
 * Counts every HTTP request this process answers. A request that came through the Cloudflare tunnel carries the
 * "cf-ray" header; anything else came straight from the LAN. Per-minute counts stay in memory (last 2 hours, this
 * process only); hourly sums are added to TrafficHourly every minute (all processes together).
 */
export type Source = 'cloudflare' | 'lan';
interface Bucket { requests: number; errors: number; slow: number; bytes: number }
const blank = (): Bucket => ({ requests: 0, errors: 0, slow: 0, bytes: 0 });
const SLOW_MS = 3000;

const minutes = new Map<number, Record<Source, Bucket>>(); // minute (epoch / 60000) → counts
let pending = new Map<string, Bucket>(); // `${hourIso}|${source}` → counts not yet in the database
const paths = new Map<string, number>(); // normalised path → requests since start (this process)
export const startedAt = new Date();

/** /api/files/0e57…/sheets → /api/files/:id/sheets (so the top list groups by kind of request) */
const normPath = (p: string) =>
  p.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:n')
    .replace(/^\/assets\/.*$/, '/assets/*').replace(/^\/uploads\/.*$/, '/uploads/*').replace(/^\/guide\/.*$/, '/guide/*').slice(0, 120);

export const trafficMeter: RequestHandler = (req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const source: Source = req.headers['cf-ray'] ? 'cloudflare' : 'lan';
    const ms = Date.now() - t0;
    const bytes = Number(res.getHeader('content-length')) || 0;
    const err = res.statusCode >= 500;
    const m = Math.floor(Date.now() / 60_000);
    if (!minutes.has(m)) {
      minutes.set(m, { cloudflare: blank(), lan: blank() });
      for (const k of minutes.keys()) if (k < m - 120) minutes.delete(k);
    }
    for (const b of [minutes.get(m)![source], hourBucket(source)]) {
      b.requests++; b.bytes += bytes;
      if (err) b.errors++;
      if (ms > SLOW_MS) b.slow++;
    }
    const p = normPath(req.originalUrl || req.url);
    paths.set(p, (paths.get(p) ?? 0) + 1);
    if (paths.size > 2000) for (const [k, v] of paths) if (v < 3) paths.delete(k);
  });
  next();
};

function hourBucket(source: Source) {
  const h = new Date(); h.setUTCMinutes(0, 0, 0);
  const key = `${h.toISOString()}|${source}`;
  if (!pending.has(key)) pending.set(key, blank());
  return pending.get(key)!;
}

/** add the counts collected since the last flush to TrafficHourly */
export async function flushTraffic() {
  if (!pending.size) return;
  const batch = pending;
  pending = new Map();
  const rows = [...batch].map(([k, b]) => { const [hour, source] = k.split('|'); return { hour, source, ...b }; });
  try {
    await q(
      `MERGE TrafficHourly AS t
       USING (SELECT CAST(JSON_VALUE(j.value, '$.hour') AS DATETIME2) AS hour_start, JSON_VALUE(j.value, '$.source') AS source,
                     CAST(JSON_VALUE(j.value, '$.requests') AS INT) AS requests, CAST(JSON_VALUE(j.value, '$.errors') AS INT) AS errors,
                     CAST(JSON_VALUE(j.value, '$.slow') AS INT) AS slow, CAST(JSON_VALUE(j.value, '$.bytes') AS BIGINT) AS bytes
              FROM OPENJSON(@rows) j) AS s
       ON t.hour_start = s.hour_start AND t.source = s.source
       WHEN MATCHED THEN UPDATE SET requests = t.requests + s.requests, errors = t.errors + s.errors, slow = t.slow + s.slow, bytes = t.bytes + s.bytes
       WHEN NOT MATCHED THEN INSERT (hour_start, source, requests, errors, slow, bytes) VALUES (s.hour_start, s.source, s.requests, s.errors, s.slow, s.bytes);`,
      { rows: T.text(JSON.stringify(rows.map((r) => ({ ...r, hour: r.hour.replace('Z', '') })))) },
    );
  } catch (e: any) {
    // keep the counts for the next try (the database may be restarting)
    for (const [k, b] of batch) { const cur = pending.get(k) ?? blank(); pending.set(k, { requests: cur.requests + b.requests, errors: cur.errors + b.errors, slow: cur.slow + b.slow, bytes: cur.bytes + b.bytes }); }
    logger.warn(`traffic flush failed: ${e?.message}`);
  }
}

let timer: NodeJS.Timeout | null = null;
export function startTrafficFlush() {
  if (timer) return;
  timer = setInterval(() => void flushTraffic(), 60_000);
  timer.unref();
}

/** last `n` minutes (oldest first), this process */
export function minuteSeries(n = 60) {
  const now = Math.floor(Date.now() / 60_000);
  const out: { t: string; cloudflare: number; lan: number; errors: number }[] = [];
  for (let m = now - n + 1; m <= now; m++) {
    const b = minutes.get(m);
    out.push({ t: new Date(m * 60_000).toISOString(), cloudflare: b?.cloudflare.requests ?? 0, lan: b?.lan.requests ?? 0, errors: (b?.cloudflare.errors ?? 0) + (b?.lan.errors ?? 0) });
  }
  return out;
}

/** counts already counted but not yet in the database (added to the database figures by the routes) */
export const unflushed = () => [...pending].map(([k, b]) => { const [hour, source] = k.split('|'); return { hour, source: source as Source, ...b }; });

export const topPaths = (n = 12) => [...paths].sort((a, b) => b[1] - a[1]).slice(0, n).map(([path, requests]) => ({ path, requests }));
