import { q, q1, T } from '../../config/db';
import type { AuthUser } from '../../middleware/auth';
import { createSystemPost } from '../news/routes';
import type { Alert } from './record';

/**
 * "New Code ตรวจ 100%" on the news board: when a plan has products whose Remark (ไม่ Ink) in the master says New Code, one post per
 * plan lists them (time · line · document · country · remark) so QC knows before the run. It goes to the tags of the setting
 * inkcode.newCodeNewsTags (default: tag "Ink", made here when missing); members get the unread badge and a bell notification.
 * The same list posted again for the same day (plan dropped twice) is not posted twice.
 */
const KEY = 'inkcode.newCodeNewsTags';

export async function newsTagIds(user?: AuthUser): Promise<string[]> {
  const row = await q1(`SELECT setting_value FROM SystemSettings WHERE setting_key = @k`, { k: KEY });
  if (row) { try { const v = JSON.parse(row.setting_value); if (Array.isArray(v)) return v.map(String); } catch { /* bad value → default */ } }
  // default: the tag "Ink" (made by database/28_inkcode_news_tag.sql, or here on a database that had no user yet)
  let ink = await q1(`SELECT tag_id FROM Tags WHERE tag_name = N'Ink'`);
  if (!ink && user) ink = await q1(`INSERT INTO Tags (tag_name, color, description, created_by) OUTPUT inserted.tag_id VALUES (N'Ink', N'#0EA5E9', N'รับข่าวแจ้ง New Code ตรวจ 100% จากแผนผลิต InkCode', @u)`, { u: T.uuid(user.id) });
  if (!ink) return [];
  const ids = [String(ink.tag_id).toLowerCase()];
  await setNewsTagIds(ids, user ?? null);
  return ids;
}

export async function setNewsTagIds(ids: string[], user: AuthUser | null) {
  const v = JSON.stringify([...new Set(ids.map((i) => i.toLowerCase()))]);
  await q(`MERGE SystemSettings AS t USING (SELECT @k AS setting_key) AS s ON t.setting_key = s.setting_key
           WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @u, updated_at = SYSUTCDATETIME()
           WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (@k, @v, @u);`, { k: KEY, v, u: T.uuid(user?.id ?? null) });
}

/** Posts the New Code list of one plan; returns the post id (null when there is nothing to say or it was already posted) */
export async function postNewCodeNews(user: AuthUser, date: string, alerts: Alert[], linkUrl: string | null): Promise<string | null> {
  const list = alerts.filter((a) => a.kind === 'New Code');
  if (!list.length) return null;
  const tagIds = await newsTagIds(user);
  if (!tagIds.length) return null;
  const [y, m, d] = date.split('-');
  const title = `New Code ตรวจ 100% · แผนผลิตวันที่ ${d}/${m}/${y} (${list.length} รายการ)`;
  const body = [
    `แผนผลิตวันที่ ${d}/${m}/${y} มีสินค้าที่ Master ระบุ New Code — QC ตรวจ 100%`,
    '',
    ...list.sort((a, b) => `${a.time}${a.line}`.localeCompare(`${b.time}${b.line}`)).map((a) => `• ${[a.time, a.line, a.doc, a.country].filter(Boolean).join(' · ')} — ${a.detail}`),
  ].join('\n');
  const dup = await q1(`SELECT TOP 1 post_id FROM NewsPosts WHERE is_deleted = 0 AND title = @t AND body = @b`, { t: title, b: T.text(body) });
  if (dup) return null;
  return createSystemPost(user, { title, body, tagIds, linkUrl });
}
