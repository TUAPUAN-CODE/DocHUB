import { del, get, post, put } from './client';
import type {
  AccessList, AccessRequest, AuditEntry, CellValue, Column, ColumnFilter, Crumb, DashboardMeta, DataSource, FileItem, FolderItem,
  NotificationItem, Perm, Role, Row, Sheet, SheetPrefs, SortSpec, UnionStatus, User, UsersDict, Widget, WidgetData,
} from '@/types';

export const authApi = {
  login: (username: string, password: string) => post<{ accessToken: string; user: User }>('/auth/login', { username, password }),
  refresh: () => post<{ accessToken: string; user: User }>('/auth/refresh'),
  logout: () => post('/auth/logout'),
  me: () => get<User>('/auth/me'),
  providers: () => get<{ google: boolean; microsoft: boolean }>('/auth/providers'),
  changePassword: (currentPassword: string, newPassword: string) => post('/auth/change-password', { currentPassword, newPassword }),
};

export const usersApi = {
  list: (params: Record<string, any>) =>
    get<{ items: User[]; total: number; page: number; pageSize: number; stats: { total: number; active: number } }>('/users', params),
  lookup: (q: string) => get<User[]>('/users/lookup', { q }),
  create: (b: { username: string; email: string; displayName: string; password: string; role: Role }) => post<User>('/users', b),
  update: (id: string, b: Partial<{ email: string; displayName: string; role: Role; isActive: boolean }>) => put<User>(`/users/${id}`, b),
  resetPassword: (id: string, password: string) => post(`/users/${id}/reset-password`, { password }),
  bulk: (ids: string[], action: 'activate' | 'deactivate' | 'set_role', role?: Role) => post('/users/bulk', { ids, action, role }),
  updateProfile: (b: { displayName: string; email: string; avatarUrl?: string | null }) => put<User>('/users/me/profile', b),
};

export interface FolderContents { folder: FolderItem | null; breadcrumb: Crumb[]; level: number; subfolders: FolderItem[]; files: FileItem[] }
export const foldersApi = {
  tree: () => get<FolderItem[]>('/folders/tree'),
  contents: (id: string) => get<FolderContents>(`/folders/${id}/contents`),
  create: (b: { name: string; parentId?: string | null; description?: string | null; color?: string }) => post<FolderItem>('/folders', b),
  update: (id: string, b: { name?: string; description?: string | null; color?: string }) => put(`/folders/${id}`, b),
  move: (id: string, parentId: string | null) => post(`/folders/${id}/move`, { parentId }),
  remove: (id: string) => del(`/folders/${id}`),
};

export interface FileDetail { file: FileItem; breadcrumb: Crumb[]; sheets: Sheet[]; dashboards: { id: string; name: string; updatedAt: string }[]; level: number }
export const filesApi = {
  get: (id: string) => get<FileDetail>(`/files/${id}`),
  create: (b: any) => post<{ id: string }>('/files', b),
  update: (id: string, b: { name?: string; description?: string | null; color?: string; status?: string }) => put(`/files/${id}`, b),
  move: (id: string, folderId: string) => post(`/files/${id}/move`, { folderId }),
  duplicate: (id: string, b: { name?: string; folderId?: string; includeData: boolean }) => post<{ id: string }>(`/files/${id}/duplicate`, b),
  remove: (id: string) => del(`/files/${id}`),
  accessible: (q = '') => get<{ id: string; name: string; color: string; folderId: string; path: string }[]>('/files/accessible', { q }),
};

export interface ScanProfile {
  id: string; name: string; delimiter: string;
  match?: { prefix?: string | null; regex?: string | null; fieldCount?: number | null } | null;
  fields: { index: number; columnId: string }[];
  action: 'create' | 'update'; keyColumnId?: string | null; onMiss?: 'create' | 'reject' | null;
  stamps?: string[] | null; onFull?: 'ignore' | 'reject' | 'new_row' | null;
  verify?: ScanVerify | null;
}
export interface ScanVerify { sheetId: string; refKeyColumnId: string; checkColumnId?: string | null; fill?: { fromColumnId: string; toColumnId: string }[] | null; onMiss: 'reject' | 'allow' }
export interface MixCfg { deductColumnId: string; keyColumnId?: string | null; inheritColumnIds?: string[] | null; sameColumnIds?: string[] | null }
export interface LinesCfg { lineSheetId: string; displayColumnIds?: string[] | null; actions?: { label: string; columnId: string; kind: 'now' | 'value'; value?: string | null }[] | null }
export interface FormLayout { perRow: number; fields: { columnId: string; span?: number; hidden?: boolean }[] }
export interface TimeLinkCfg {
  id: string; name: string; targetSheetId: string;
  aStartColumnId: string; aEndColumnId?: string | null; aKeyColumnId?: string | null;
  bStartColumnId: string; bEndColumnId?: string | null; bKeyColumnId?: string | null;
  toleranceMin?: number | null; windowHours?: number | null;
}
export interface SheetSettings { timeLinks?: TimeLinkCfg[]; filterColumns?: string[] | null; scanProfiles?: ScanProfile[]; mix?: MixCfg; lines?: LinesCfg; formLayout?: FormLayout }
export interface SheetDetail {
  union?: UnionStatus | null;
  settings?: SheetSettings;
  sheet: Sheet; file: { id: string; name: string; folderId: string }; level: number; permission: Perm;
  columns: Column[]; deletedColumns: Column[]; prefs: SheetPrefs;
}
export const unionApi = {
  createFile: (b: { name: string; folderId: string; sources: string[] }) => post<{ id: string; sheetId: string }>('/union/files', b),
  addSheet: (fileId: string, b: { name: string; sources: string[] }) => post<{ id: string }>(`/files/${fileId}/sheets/union`, b),
  setSources: (sheetId: string, sources: string[]) => put(`/sheets/${sheetId}/union`, { sources }),
  sync: (sheetId: string) => post(`/sheets/${sheetId}/union/sync`),
};
export const sheetsApi = {
  get: (id: string) => get<SheetDetail>(`/sheets/${id}`),
  saveSettings: (id: string, s: { filterColumns: string[] | null }) => put(`/sheets/${id}/settings`, s),
  savePrefs: (id: string, prefs: Partial<SheetPrefs>) => put<SheetPrefs>(`/sheets/${id}/prefs`, prefs),
  create: (fileId: string, b: { name: string; tabColor?: string | null; columns?: any[]; copyStructureFrom?: string | null }) =>
    post<Sheet>(`/files/${fileId}/sheets`, b),
  update: (id: string, b: { name?: string; tabColor?: string | null }) => put(`/sheets/${id}`, b),
  reorder: (fileId: string, ids: string[]) => post(`/files/${fileId}/sheets/reorder`, { ids }),
  remove: (id: string) => del(`/sheets/${id}`),
};

export const columnsApi = {
  create: (sheetId: string, b: any) => post<Column>(`/sheets/${sheetId}/columns`, b),
  update: (id: string, b: any) => put<{ column: Column; conversion: { converted: number; cleared: number } | null }>(`/columns/${id}`, b),
  reorder: (sheetId: string, ids: string[]) => post(`/sheets/${sheetId}/columns/reorder`, { ids }),
  remove: (id: string) => del(`/columns/${id}`),
  restore: (id: string) => post<Column>(`/columns/${id}/restore`),
};

export interface RowQueryBody { page: number; pageSize: number; sorts: SortSpec[]; filters: ColumnFilter[]; search?: string }
export interface RowPage { rows: Row[]; total: number; page: number; pageSize: number; users: UsersDict }
export interface CellVersion { id: number; oldValue: CellValue; newValue: CellValue; source: string; by: string; byName: string; avatarUrl: string | null; at: string; version: number }
export interface ColumnStat { columnId: string; filled: number; sum: number | null; avg: number | null; min: number | null; max: number | null; trueCount: number | null }
export interface ImportResult { inserted: number; valid: number; invalid: number; skippedEmpty: number; errors: { rowNo: number; columnId: string; columnName: string; message: string }[] }
export const rowsApi = {
  query: (sheetId: string, b: RowQueryBody) => post<RowPage>(`/sheets/${sheetId}/rows/query`, b),
  distinct: (sheetId: string, b: { columnId: string; filters: ColumnFilter[]; search?: string; valueSearch?: string; limit?: number }) =>
    post<{ items: { value: any; count: number }[]; blankCount: number; truncated: boolean }>(`/sheets/${sheetId}/distinct`, b),
  create: (sheetId: string, values: Record<string, CellValue>) => post<{ row: Row; users: UsersDict }>(`/sheets/${sheetId}/rows`, { values }),
  remove: (rowId: string) => del(`/rows/${rowId}`),
  columnStats: (sheetId: string, b: { columnIds: string[]; filters: ColumnFilter[]; search?: string }) =>
    post<{ totalRows: number; columns: ColumnStat[] }>(`/sheets/${sheetId}/column-stats`, b),
  lookupOptions: (sheetId: string, b: { columnId: string; parentValue?: string | null; search?: string; limit?: number }) =>
    post<{ options: string[]; more?: boolean; needsParent: boolean }>(`/sheets/${sheetId}/lookup-options`, b),
  docPreview: (sheetId: string, b: { columnId: string; prefix?: string | null; date?: string | null }) =>
    post<{ number: string | null }>(`/sheets/${sheetId}/doc-number/preview`, b),
  importRows: (sheetId: string, b: { rows: { rowNo: number; values: Record<string, unknown> }[]; skipInvalid?: boolean; dryRun?: boolean }) =>
    post<ImportResult>(`/sheets/${sheetId}/rows/import`, b),
  removeMany: (sheetId: string, rowIds: string[]) => post(`/sheets/${sheetId}/rows/delete`, { rowIds }),
  trash: (sheetId: string) => get<{ rows: Row[]; users: UsersDict }>(`/sheets/${sheetId}/trash`),
  restore: (sheetId: string, rowIds: string[]) => post<{ restored: number }>(`/sheets/${sheetId}/rows/restore`, { rowIds }),
  history: (rowId: string) =>
    get<{ row: { id: string; order: number; createdAt: string; isDeleted: boolean }; history: (CellVersion & { columnId: string; columnName: string; dataType: string })[]; snapshots: any[] }>(`/rows/${rowId}/history`),
  rollback: (rowId: string, b: { at: string; reason?: string; preview?: boolean }) => post<any>(`/rows/${rowId}/rollback`, b),
  sheetRollback: (sheetId: string, b: { at: string; reason?: string; preview?: boolean }) => post<any>(`/sheets/${sheetId}/rollback`, b),
};

export interface BulkResult { updated: { rowId: string; columnId: string; value: CellValue; at: string; by: string }[]; unchanged: number; errors: { rowId: string; columnId: string; message: string; rowNo?: number; columnName?: string }[] }
export const cellsApi = {
  update: (rowId: string, columnId: string, value: CellValue) =>
    put<{ rowId: string; columnId: string; value: CellValue; at: string; by: string; unchanged?: boolean; derived?: { rowId: string; columnId: string; value: CellValue; at: string; by: string }[] }>(`/rows/${rowId}/cells/${columnId}`, { value }),
  bulk: (sheetId: string, updates: { rowId: string; columnId: string; value: CellValue }[], partial = false, source = 'edit') =>
    post<BulkResult>(`/sheets/${sheetId}/cells/bulk`, { updates, partial, source }),
  history: (rowId: string, columnId: string) =>
    get<{ column: { name: string; dataType: string; options: any[] } | null; rowNo: number; canRollback: boolean; versions: CellVersion[] }>('/cells/history', { rowId, columnId }),
  rollback: (historyId: number, target: 'new' | 'old' = 'new') => post('/cells/rollback', { historyId, target }),
};

export const accessApi = {
  get: (type: 'file' | 'folder', id: string) => get<AccessList>(`/${type}s/${id}/access`),
  grant: (type: 'file' | 'folder', id: string, b: { userId: string; permission: Perm; expiresAt?: string | null }) =>
    put<{ granted: boolean; cappedTo: 'read' | 'write' | null }>(`/${type}s/${id}/access`, b),
  revoke: (type: 'file' | 'folder', id: string, userId: string) => del(`/${type}s/${id}/access/${userId}`),
};

export const requestsApi = {
  create: (b: { targetType: 'file' | 'folder'; targetId: string; permission: Perm; note: string; durationDays?: number | null }) => post('/access-requests', b),
  list: (box: 'mine' | 'review', status = 'all') => get<AccessRequest[]>('/access-requests', { box, status }),
  pendingCount: () => get<{ count: number }>('/access-requests/pending-count'),
  approve: (id: string, b: { permission?: Perm; expiresAt?: string | null; reviewNote?: string }) => post(`/access-requests/${id}/approve`, b),
  reject: (id: string, reviewNote: string) => post(`/access-requests/${id}/reject`, { reviewNote }),
  cancel: (id: string) => post(`/access-requests/${id}/cancel`),
};

export const auditApi = {
  list: (params: Record<string, any>) => get<{ items: AuditEntry[]; total: number; page: number; pageSize: number }>('/audit', params),
};

export interface FavoriteItem { type: 'file' | 'folder'; id: string; name: string; color: string; path: string; level: number }
export const favoritesApi = {
  list: () => get<FavoriteItem[]>('/favorites'),
  toggle: (entityType: 'file' | 'folder', entityId: string) => post<{ favorite: boolean }>('/favorites/toggle', { entityType, entityId }),
};

export const activityApi = {
  recent: () => get<FileItem[]>('/activity/recent-files'),
  feed: () => get<FileItem[]>('/activity/feed'),
};

export interface SearchResult {
  folders: { id: string; name: string; color: string; path: string; level: number }[];
  files: { id: string; name: string; color: string; description: string | null; updatedAt: string; folderId: string; path: string; level: number }[];
}
export const searchApi = { search: (q: string, limit = 20) => get<SearchResult>('/search', { q, limit }) };

export const notificationsApi = {
  list: () => get<{ items: NotificationItem[]; unreadCount: number }>('/notifications'),
  read: (id: string) => post(`/notifications/${id}/read`),
  readAll: () => post('/notifications/read-all'),
};

export const themesApi = {
  me: () => get<{ theme: any; orgDefault: any }>('/themes/me'),
  save: (theme: any) => put('/themes/me', { theme }),
  reset: () => del('/themes/me'),
  saveOrg: (theme: any) => put('/themes/org', { theme }),
  resetOrg: () => del('/themes/org'),
};

export interface DashboardListItem { id: string; name: string; updatedAt: string; fileId: string; fileName: string; fileColor: string; path: string; canEdit: boolean }
export const dashboardsApi = {
  all: () => get<DashboardListItem[]>('/dashboards'),
  list: (fileId: string) => get<DashboardMeta[]>(`/files/${fileId}/dashboards`),
  create: (fileId: string, name: string) => post<DashboardMeta>(`/files/${fileId}/dashboards`, { name }),
  get: (id: string) => get<{ dashboard: DashboardMeta; widgets: Widget[]; file: { id: string; name: string }; sheets: Sheet[]; level: number }>(`/dashboards/${id}`),
  save: (id: string, b: { name: string; canvas: DashboardMeta['canvas']; background: DashboardMeta['background']; widgets: Widget[] }) => put(`/dashboards/${id}`, b),
  remove: (id: string) => del(`/dashboards/${id}`),
  data: (dataSource: DataSource) => post<WidgetData>('/dashboards/data', { dataSource }),
};

export const uploadsApi = {
  image: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return post<{ url: string }>('/uploads/image', fd);
  },
};

export interface TrashItem { type: 'file' | 'folder'; id: string; name: string; color: string; deletedAt: string; deletedByName: string | null; purgeAt: string; detail: string; blocked?: boolean }
export const trashApi = {
  list: () => get<{ retentionDays: number; items: TrashItem[] }>('/trash'),
  restore: (type: 'file' | 'folder', id: string) => post('/trash/restore', { type, id }),
  purge: (type: 'file' | 'folder', id: string) => del(`/trash/${type}/${id}`),
};


export interface ShareLink {
  id: string; token: string; permission: 'read' | 'write' | 'manage'; allowGuest: boolean; expiresAt: string | null; isActive: boolean;
  createdAt: string; createdByName: string | null; accessCount: number; lastUsedAt: string | null; expired: boolean;
}
export const shareApi = {
  list: (fileId: string) => get<ShareLink[]>(`/files/${fileId}/share-links`),
  create: (fileId: string, b: { permission: ShareLink['permission']; allowGuest: boolean; expiresAt?: string | null }) => post<ShareLink>(`/files/${fileId}/share-links`, b),
  update: (id: string, b: { permission: ShareLink['permission']; allowGuest: boolean }) => put(`/share-links/${id}`, b),
  revoke: (id: string) => del(`/share-links/${id}`),
  redeem: (token: string) => post<{ fileId: string; permission: string; granted: boolean }>(`/share/${token}/redeem`),
};
export const publicShareApi = {
  info: (token: string) => get<{ file: { id: string; name: string; color: string }; permission: string; allowGuest: boolean; sheets: Sheet[] }>(`/public/share/${token}`),
  sheet: (token: string, sheetId: string) => get<{ sheet: Sheet; columns: Column[] }>(`/public/share/${token}/sheets/${sheetId}`),
  rows: (token: string, sheetId: string, b: { page: number; pageSize: number; search?: string; sorts?: SortSpec[] }) => post<RowPage>(`/public/share/${token}/sheets/${sheetId}/rows`, b),
};

export const pdfApi = {
  get: (fileId: string) => get<{ templates: any[]; canEdit: boolean }>(`/files/${fileId}/pdf-templates`),
  save: (fileId: string, templates: any[]) => put(`/files/${fileId}/pdf-templates`, { templates }),
  copyFrom: (fileId: string, sourceFileId: string, templateIds?: string[]) => post<{ templates: any[] }>(`/files/${fileId}/pdf-templates/copy-from`, { sourceFileId, templateIds }),
};
