/** client/public/guide/manifest.json — written by client/scripts/guide/capture.cjs (do not edit by hand) */
export interface GuideMark { x: number; y: number; w: number; h: number; label: string; place?: 'below' | 'above' | 'left' | 'right' }
export interface GuideStep { title: string; text?: string; tip?: string; image?: string; w?: number; h?: number; marks?: GuideMark[] }
export interface Guide {
  id: string; title: string; summary: string; device: 'desktop' | 'phone'; roles?: string[]; steps: GuideStep[];
}
export interface GuideTopic { id: string; title: string; description: string; icon: string; roles?: string[]; guides: Guide[] }
export interface GuideManifest { generatedAt: string; topics: GuideTopic[] }
