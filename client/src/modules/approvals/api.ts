import { del, get, http, post, put } from '@/api/client';

export interface Area { page: number; x: number; y: number; w: number; h: number }
export interface FlowStep { userId: string; userName?: string; label: string; allowForward: boolean; area: Area }
export interface Flow { id?: string; name: string; steps: FlowStep[] }
export interface ApprovalStep extends FlowStep { id: string; status: 'waiting' | 'pending' | 'approved' | 'rejected'; at?: string; comment?: string }
export interface ApprovalRequest {
  id: string; fileId: string; archiveId: string | null; title: string; status: 'pending' | 'approved' | 'rejected'; steps: ApprovalStep[]; currentStep: number;
  createdBy: string; createdByName: string | null; createdAt: string; updatedAt: string; myTurn: boolean;
}

export const approvalsApi = {
  getSignature: () => get<{ image: string | null }>('/users/me/signature'),
  saveSignature: (image: string) => put('/users/me/signature', { image }),
  removeSignature: () => del('/users/me/signature'),
  flows: (fileId: string) => get<{ flows: Required<Flow>[]; canEdit: boolean }>(`/files/${fileId}/approval-flows`),
  saveFlows: (fileId: string, flows: Flow[]) => put(`/files/${fileId}/approval-flows`, { flows: flows.map((f) => ({ id: f.id, name: f.name, steps: f.steps.map(({ userId, label, allowForward, area }) => ({ userId, label, allowForward, area })) })) }),
  start: (archiveId: string, flowId: string) => post<{ id: string }>(`/exports/${archiveId}/approval`, { flowId }),
  list: (box: 'inbox' | 'sent' | 'done') => get<ApprovalRequest[]>('/approvals', { box }),
  ofFile: (fileId: string) => get<ApprovalRequest[]>(`/files/${fileId}/approvals`),
  one: (id: string) => get<ApprovalRequest>(`/approvals/${id}`),
  approve: (id: string, forwardTo?: FlowStep) => post<{ status: string }>(`/approvals/${id}/approve`, { forwardTo: forwardTo && { userId: forwardTo.userId, label: forwardTo.label, allowForward: forwardTo.allowForward, area: forwardTo.area } }),
  reject: (id: string, comment: string) => post(`/approvals/${id}/reject`, { comment }),
  async openPdf(id: string, download = false, name = 'document.pdf') {
    const r = await http.get(`/approvals/${id}/pdf`, { responseType: 'blob', timeout: 180_000 });
    const url = URL.createObjectURL(r.data as Blob);
    if (download) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); } else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
