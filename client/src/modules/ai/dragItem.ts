/** Something dragged from the web onto the cat (a file / folder / dashboard card): the cat gets its id so the AI can read it with the user's own permissions */
export const AI_DRAG_MIME = 'application/x-dochub-ai';
export type AiItemKind = 'file' | 'folder' | 'dashboard';
export interface AiItem { kind: AiItemKind; id: string; name: string }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** The item an app tile opens (its address is /files/<id>, /files/<id>/dashboards/<id> or /folders/<id>) */
export function aiItemFromPath(to: string | null | undefined, name: string): AiItem | null {
  if (!to) return null;
  const d = new RegExp(`^/files/${UUID}/dashboards/(${UUID})`, 'i').exec(to);
  if (d) return { kind: 'dashboard', id: d[1].toLowerCase(), name };
  const f = new RegExp(`^/files/(${UUID})`, 'i').exec(to);
  if (f) return { kind: 'file', id: f[1].toLowerCase(), name };
  const o = new RegExp(`^/folders/(${UUID})`, 'i').exec(to);
  return o ? { kind: 'folder', id: o[1].toLowerCase(), name } : null;
}

export const readAiItem = (dt: DataTransfer | null): AiItem | null => {
  try {
    const raw = dt?.getData(AI_DRAG_MIME);
    if (!raw) return null;
    const v = JSON.parse(raw) as AiItem;
    return v && v.id && ['file', 'folder', 'dashboard'].includes(v.kind) ? { kind: v.kind, id: String(v.id), name: String(v.name ?? '').slice(0, 200) } : null;
  } catch { return null; }
};
export const setAiItem = (e: { dataTransfer: DataTransfer }, item: AiItem) => { try { e.dataTransfer.setData(AI_DRAG_MIME, JSON.stringify(item)); } catch { /* not draggable here */ } };
