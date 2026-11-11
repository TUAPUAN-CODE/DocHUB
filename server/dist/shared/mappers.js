"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapDashboard = exports.mapWidget = exports.mapNotification = exports.mapColumn = exports.mapSheet = exports.mapFile = exports.mapFolderNode = exports.mapUser = void 0;
const http_1 = require("./http");
const permissions_1 = require("./permissions");
const mapUser = (r) => ({
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
exports.mapUser = mapUser;
const mapFolderNode = (f) => ({
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
exports.mapFolderNode = mapFolderNode;
const mapFile = (r, level, favorite = false) => ({
    id: r.file_id,
    name: r.file_name,
    folderId: r.folder_id,
    folderName: r.folder_name ?? null,
    description: r.description ?? null,
    icon: r.icon,
    color: r.color,
    status: r.status,
    /** master_data | record | null (ทั่วไป) — docs/DOC_TYPES.md */
    docType: (r.doc_type ?? null),
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
    permission: (0, permissions_1.levelName)(level),
    favorite,
});
exports.mapFile = mapFile;
const mapSheet = (r) => ({
    id: r.sheet_id,
    fileId: r.file_id,
    name: r.sheet_name,
    order: r.sort_order,
    tabColor: r.tab_color ?? null,
    isUnion: !!r.union_config,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
});
exports.mapSheet = mapSheet;
const mapColumn = (r) => ({
    id: r.column_id,
    sheetId: r.sheet_id,
    name: r.column_name,
    dataType: r.data_type,
    order: r.display_order,
    width: r.width,
    isRequired: !!r.is_required,
    defaultValue: (0, http_1.safeJson)(r.default_value, null),
    placeholder: r.placeholder ?? null,
    description: r.description ?? null,
    validation: (0, http_1.safeJson)(r.validation_rule, {}) ?? {},
    options: (0, http_1.safeJson)(r.select_options, []) ?? [],
    isDeleted: !!r.is_deleted,
    deletedAt: r.deleted_at ?? null,
    updatedAt: r.updated_at,
});
exports.mapColumn = mapColumn;
const mapNotification = (r) => ({
    id: r.notification_id,
    type: r.type,
    title: r.title,
    message: r.message,
    link: r.link ?? null,
    isRead: !!r.is_read,
    createdAt: r.created_at,
});
exports.mapNotification = mapNotification;
const mapWidget = (r) => ({
    id: r.widget_id,
    type: r.widget_type,
    title: r.title ?? '',
    x: r.pos_x,
    y: r.pos_y,
    w: r.width,
    h: r.height,
    z: r.z_index,
    locked: !!r.is_locked,
    config: (0, http_1.safeJson)(r.config, {}),
    style: (0, http_1.safeJson)(r.style_config, {}),
    dataSource: (0, http_1.safeJson)(r.data_source, null),
});
exports.mapWidget = mapWidget;
const mapDashboard = (r) => ({
    id: r.dashboard_id,
    fileId: r.file_id,
    name: r.dashboard_name,
    canvas: (0, http_1.safeJson)(r.layout_config, { width: 1600, height: 900, gridSize: 10, snap: true }),
    background: (0, http_1.safeJson)(r.background, { color: '#F4F6FB' }),
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
});
exports.mapDashboard = mapDashboard;
//# sourceMappingURL=mappers.js.map