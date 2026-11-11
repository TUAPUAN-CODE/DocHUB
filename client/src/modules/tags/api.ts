import { del, get, post } from '@/api/client';
import type { Role } from '@/types';

export type TagRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export interface TagRequest {
  id: string; status: TagRequestStatus; note: string | null; reviewNote: string | null; reviewedAt: string | null; reviewedByName: string | null; createdAt: string;
  tag: { id: string; name: string; color: string };
  user: { id: string; displayName: string; username: string; avatarUrl: string | null; role: Role };
  approver: { id: string; displayName: string };
}
export interface Approver { id: string; displayName: string; username: string; avatarUrl: string | null; role: Role }

export const tagRequestsApi = {
  approvers: () => get<Approver[]>('/tag-requests/approvers'),
  mine: () => get<TagRequest[]>('/tag-requests/mine'),
  inbox: (p: { scope?: 'all'; status?: TagRequestStatus } = {}) => get<TagRequest[]>('/tag-requests', p),
  pendingCount: () => get<{ count: number }>('/tag-requests/pending-count'),
  create: (b: { tagId: string; approverId: string; note?: string | null }) => post<TagRequest>('/tag-requests', b),
  cancel: (id: string) => del(`/tag-requests/${id}`),
  review: (id: string, approve: boolean, note?: string | null) => post<TagRequest>(`/tag-requests/${id}/review`, { approve, note }),
};
