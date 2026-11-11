import { safeJson } from './http';
import { FolderNode, levelName } from './permissions';

export const mapUser = (r: any) => ({
  id: r.user_id,
  username: r.username,
  email: r.email,
  displayName: r.display_name,
  avatarUrl: r.avatar_url ?? null,
  role: r.role ?? 'user',
  isActive: r.is_active === undefined ? undefined : !!r.is_active,
  lastLoginAt: r.last_login_at ?? null,
  createdAt: r.created_at ?? null,
});

export const mapFolderNode = (f: FolderNode) => ({
  id: f.id,
  name: f.name,
  parentId: f.parentId,
  description: f.description,
  color: f.color,
  icon: f.icon,
  sortOrder: f.sortOrder,
  createdBy: f.createdBy,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
});

export const mapFile = (r: any, level: number, favorite = false) => ({
  id: r.file_id,
  name: r.file_name,
  folderId: r.folder_id,
  folderName: r.folder_name ?? null,
  description: r.description ?? null,
  icon: r.icon,
  color: r.color,
  status: r.status,
  /** master_data | record | null (ทั่วไป) — docs/DOC_TYPES.md */
  docType: (r.doc_type ?? null) as 'master_data' | 'record' | null,
  createdBy: r.created_by,
  createdByName: r.created_by_name ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  sheetCount: r.sheet_count !== undefined ? Number(r.sheet_count) : undefined,
  lastActivityAt: r.last_activity_at ?? null,
  lastActivityBy: r.last_activity_by ?? null,
  lastActivityAvatar: r.last_activity_avatar ?? null,
  lastAction: r.last_action ?? null,
  level,
  permission: levelName(level),
  favorite,
});

export const mapSheet = (r: any) => ({
  id: r.sheet_id,
  fileId: r.file_id,
  name: r.sheet_name,
  order: r.sort_order,
  tabColor: r.tab_color ?? null,
  isUnion: !!r.union_config,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const mapColumn = (r: any) => ({
  id: r.column_id,
  sheetId: r.sheet_id,
  name: r.column_name,
  dataType: r.data_type,
  order: r.display_order,
  width: r.width,
  isRequired: !!r.is_required,
  defaultValue: safeJson(r.default_value, null),
  placeholder: r.placeholder ?? null,
  description: r.description ?? null,
  validation: safeJson(r.validation_rule, {}) ?? {},
  options: safeJson(r.select_options, []) ?? [],
  isDeleted: !!r.is_deleted,
  deletedAt: r.deleted_at ?? null,
  updatedAt: r.updated_at,
});

export const mapNotification = (r: any) => ({
  id: r.notification_id,
  type: r.type,
  title: r.title,
  message: r.message,
  link: r.link ?? null,
  isRead: !!r.is_read,
  createdAt: r.created_at,
});

export const mapWidget = (r: any) => ({
  id: r.widget_id,
  type: r.widget_type,
  title: r.title ?? '',
  x: r.pos_x,
  y: r.pos_y,
  w: r.width,
  h: r.height,
  z: r.z_index,
  locked: !!r.is_locked,
  config: safeJson(r.config, {}),
  style: safeJson(r.style_config, {}),
  dataSource: safeJson(r.data_source, null),
});

export const mapDashboard = (r: any) => ({
  id: r.dashboard_id,
  fileId: r.file_id,
  name: r.dashboard_name,
  canvas: safeJson(r.layout_config, { width: 1600, height: 900, gridSize: 10, snap: true }),
  background: safeJson(r.background, { color: '#F4F6FB' }),
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
