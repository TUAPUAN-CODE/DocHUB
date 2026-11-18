/** Makes the AI cat react to something that happened in the app (the cat shows it only for people who may use AI). */
export type CatMood = 'happy' | 'talking' | 'thinking' | 'excited' | 'love' | 'playful' | 'surprised' | 'sleepy' | 'sleeping' | 'sad' | 'angry' | 'furious';
export const catReact = (emotion: CatMood, say?: string) => { try { window.dispatchEvent(new CustomEvent('cat:emotion', { detail: { emotion, say } })); } catch { /* no window */ } };
