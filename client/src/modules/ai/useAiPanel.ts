import { create } from 'zustand';

/** Open / closed state of the AI side panel (right bar) */
export const useAiPanel = create<{ open: boolean; setOpen: (v: boolean) => void; toggle: () => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));

/** Tells the dashboard page (if it is open) that the AI changed it so it can reload */
export const AI_DASH_EVENT = 'ai:dashboard-changed';
