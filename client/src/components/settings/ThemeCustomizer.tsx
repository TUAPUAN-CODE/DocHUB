import { isAdminRole } from '@/types';
import { useEffect, useMemo, useState } from 'react';
import { Check, Moon, RotateCcw, Save, Search, Sun, Building2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FONTS, loadPreviewFont } from '@/lib/fonts';
import { COMPONENT_LABELS, ComponentKey, ComponentStyle, DARK, DEFAULT_THEME, LIGHT, mergeTheme, resolveComponents, Theme, ThemeColors } from '@/lib/theme';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/store/theme';
import { confirmDialog, toast } from '@/store/ui';
import { Button } from '../ui/Button';
import { Field, Segmented, TextInput } from '../ui/Inputs';
import { useAppInfo } from '@/store/appInfo';

const COLOR_LABELS: Record<keyof ThemeColors, string> = {
  primary: 'สีหลัก', accent: 'สีเน้น', bg: 'พื้นหลังแอป', surface: 'พื้นการ์ด', text: 'ตัวอักษร', muted: 'ตัวอักษรรอง', border: 'เส้นขอบ',
  sidebar: 'แถบเมนู', sidebarText: 'ตัวอักษรเมนู', success: 'สำเร็จ', warning: 'เตือน', danger: 'อันตราย',
};
const PRESETS: { name: string; theme: Partial<Theme> }[] = [
  { name: 'Ocean', theme: { mode: 'light', colors: LIGHT } },
  { name: 'Forest', theme: { mode: 'light', colors: { ...LIGHT, primary: '#15803D', sidebar: '#14532D', accent: '#CA8A04', bg: '#F2F6F1' } } },
  { name: 'Sunset', theme: { mode: 'light', colors: { ...LIGHT, primary: '#EA580C', sidebar: '#9A3412', accent: '#DB2777', bg: '#FBF5F1' } } },
  { name: 'Graphite', theme: { mode: 'light', colors: { ...LIGHT, primary: '#334155', sidebar: '#0F172A', accent: '#0EA5E9', bg: '#F1F3F6' } } },
  { name: 'Grape', theme: { mode: 'light', colors: { ...LIGHT, primary: '#7C3AED', sidebar: '#5B21B6', accent: '#EC4899', bg: '#F5F3FB' } } },
  { name: 'Midnight', theme: { mode: 'dark', colors: DARK } },
];

function ColorField({ label, value, onChange }: { label: string; value?: string; onChange: (v: string | undefined) => void }) {
  const [txt, setTxt] = useState(value ?? '');
  useEffect(() => setTxt(value ?? ''), [value]);
  return (
    <div className="flex items-center gap-2">
      <label className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-lg ring-1 ring-line" style={{ background: value || 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 50%/10px 10px' }}>
        <input type="color" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={label} />
      </label>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted">{label}</p>
        <input value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => (/^#[0-9a-f]{6}$/i.test(txt) ? onChange(txt) : txt === '' ? onChange(undefined) : setTxt(value ?? ''))}
          placeholder="อัตโนมัติ" className="w-full bg-transparent font-mono text-[13px] uppercase outline-none" />
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, onChange, unit = 'px' }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <Field label={<span className="flex justify-between"><span>{label}</span><span className="tabular-nums text-muted">{value}{unit}</span></span>}>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[rgb(var(--c-primary))]" />
    </Field>
  );
}

function FontPicker({ value, onChange }: { value: string; onChange: (f: string) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'all' | 'thai' | 'sans' | 'serif' | 'display' | 'mono'>('all');
  const [custom, setCustom] = useState('');
  const list = useMemo(() => FONTS.filter((f) => (cat === 'all' || f.category === cat) && f.family.toLowerCase().includes(q.toLowerCase())), [q, cat]);
  useEffect(() => { list.forEach((f) => loadPreviewFont(f.family, `${f.family} ภาษาไทย ตัวอย่าง Aa123`)); }, [list]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <TextInput icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาฟอนต์" className="w-full sm:w-56" />
        <Segmented size="sm" value={cat} onChange={setCat} options={[{ value: 'all', label: 'ทั้งหมด' }, { value: 'thai', label: 'ไทย' }, { value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'display', label: 'Display' }, { value: 'mono', label: 'Mono' }]} />
      </div>
      <div className="grid max-h-72 gap-1.5 overflow-y-auto rounded-xl border border-line p-1.5 sm:grid-cols-2">
        {list.map((f) => (
          <button key={f.family} type="button" onClick={() => onChange(f.family)}
            className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors', value === f.family ? 'bg-primary/10 text-primary' : 'hover:bg-ink/5')}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px]" style={{ fontFamily: `'${f.family}', system-ui` }}>{f.family}</span>
              <span className="block truncate text-xs text-muted" style={{ fontFamily: `'${f.family}', system-ui` }}>ภาษาไทย ตัวอย่าง Aa123</span>
            </span>
            {value === f.family && <Check className="h-4 w-4 shrink-0" />}
          </button>
        ))}
        {!list.length && <p className="p-4 text-sm text-muted">ไม่พบฟอนต์ในรายการ — พิมพ์ชื่อด้านล่างเพื่อใช้ฟอนต์อื่นจาก Google Fonts</p>}
      </div>
      <div className="flex gap-2">
        <TextInput value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="ชื่อฟอนต์อื่นจาก Google Fonts เช่น Noto Sans Thai Looped" />
        <Button variant="secondary" disabled={!custom.trim()} onClick={() => { onChange(custom.trim()); setCustom(''); }}>ใช้ฟอนต์นี้</Button>
      </div>
    </div>
  );
}

function Preview({ t }: { t: Theme }) {
  const c = resolveComponents(t);
  const s = (k: ComponentKey) => c[k];
  return (
    <div className="overflow-hidden rounded-2xl border border-line" style={{ fontFamily: `'${t.fontFamily}', system-ui`, fontSize: t.fontSize }}>
      <div className="flex h-[300px]" style={{ background: s('sidebar').bg }}>
        <div className="w-[34%] py-4" style={{ color: s('sidebar').text }}>
          <p className="px-4 pb-4 text-[13px] font-semibold">{useAppInfo.getState().name}</p>
          {['หน้าแรก', 'ไฟล์ทั้งหมด', 'คำขอสิทธิ์'].map((l, i) => (
            <div key={l} className="ml-3 flex h-8 items-center rounded-l-full px-3 text-xs" style={i === 1 ? { background: t.colors.bg, color: t.colors.primary, fontWeight: 600 } : { opacity: 0.8 }}>{l}</div>
          ))}
        </div>
        <div className="flex-1 space-y-3 overflow-hidden rounded-l-[22px] p-4" style={{ background: t.colors.bg, color: t.colors.text }}>
          <div className="flex items-center gap-2">
            <div className="h-7 flex-1 px-2 text-[11px] leading-7" style={{ background: s('input').bg, border: `${s('input').borderWidth}px solid ${s('input').border}`, borderRadius: s('input').radius, color: t.colors.muted }}>ค้นหา…</div>
            <div className="h-7 px-3 text-[11px] font-medium leading-7" style={{ background: s('button').bg, color: s('button').text, borderRadius: s('button').radius }}>บันทึก</div>
          </div>
          <div style={{ background: s('card').bg, color: s('card').text, border: `${s('card').borderWidth}px solid ${s('card').border}`, borderRadius: s('card').radius, padding: Math.min(16, s('card').padding) }}>
            <p className="text-[13px] font-semibold">IR LINE PF1-09</p>
            <p className="text-[11px]" style={{ color: t.colors.muted }}>แก้ไขเมื่อ 5 นาทีที่แล้ว</p>
          </div>
          <div className="overflow-hidden text-[11px]" style={{ border: `1px solid ${s('tableCell').border}`, borderRadius: 8 }}>
            <div className="grid grid-cols-3" style={{ background: s('tableHeader').bg, color: s('tableHeader').text }}>{['วันที่', 'ไลน์', 'ยอดผลิต'].map((h) => <span key={h} className="px-2 py-1">{h}</span>)}</div>
            {[['30/09', 'PF1-09', '1,250'], ['29/09', 'PF1-10', '1,180']].map((r) => (
              <div key={r[0]} className="grid grid-cols-3" style={{ background: s('tableCell').bg, color: s('tableCell').text, borderTop: `1px solid ${s('tableCell').border}` }}>{r.map((x, i) => <span key={i} className="px-2 py-1">{x}</span>)}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThemeCustomizer() {
  const { draft, saved, update, setMode, save, revert, resetPersonal, saveAsOrg, resetOrg, orgDefault } = useTheme();
  const isAdmin = useAuth((s) => isAdminRole(s.user?.role));
  const [comp, setComp] = useState<ComponentKey>('card');
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => () => { if (JSON.stringify(useTheme.getState().draft) !== JSON.stringify(useTheme.getState().saved)) useTheme.getState().revert(); }, []);

  const setColor = (k: keyof ThemeColors, v?: string) => update((t) => ({ ...t, colors: { ...t.colors, [k]: v ?? (t.mode === 'dark' ? DARK : LIGHT)[k] } }));
  const setComponent = (p: Partial<ComponentStyle>) => update((t) => ({ ...t, components: { ...t.components, [comp]: { ...(t.components[comp] ?? {}), ...p } } }));
  const cs = draft.components[comp] ?? {};
  const resolved = resolveComponents(draft)[comp];
  const run = async (fn: () => Promise<void>, msg: string) => { setBusy(true); try { await fn(); toast.success(msg); } catch (e) { toast.error(e); } finally { setBusy(false); } };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <div className="space-y-6">
        <section className="ds-card ds-card-pad space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold">ชุดสีสำเร็จรูป</h3>
            <Segmented value={draft.mode} onChange={setMode} options={[{ value: 'light', label: 'สว่าง', icon: <Sun /> }, { value: 'dark', label: 'มืด', icon: <Moon /> }]} />
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => update((t) => mergeTheme(t, p.theme))} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm hover:border-primary/50">
                <span className="flex -space-x-1">{[p.theme.colors!.sidebar, p.theme.colors!.primary, p.theme.colors!.accent].map((c, i) => <span key={i} className="h-4 w-4 rounded-full ring-2 ring-surface" style={{ background: c }} />)}</span>{p.name}
              </button>
            ))}
          </div>
        </section>

        <section className="ds-card ds-card-pad">
          <h3 className="mb-4 font-semibold">สี</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(COLOR_LABELS) as (keyof ThemeColors)[]).map((k) => <ColorField key={k} label={COLOR_LABELS[k]} value={draft.colors[k]} onChange={(v) => setColor(k, v)} />)}
          </div>
        </section>

        <section className="ds-card ds-card-pad">
          <h3 className="mb-4 font-semibold">ขนาดและระยะห่าง</h3>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Slider label="ความโค้งของขอบ" value={draft.radius} min={0} max={28} onChange={(v) => update((t) => ({ ...t, radius: v }))} />
            <Slider label="ระยะห่างภายในการ์ด" value={draft.gap} min={8} max={32} onChange={(v) => update((t) => ({ ...t, gap: v }))} />
            <Slider label="ขนาดตัวอักษร" value={draft.fontSize} min={12} max={18} onChange={(v) => update((t) => ({ ...t, fontSize: v }))} />
            <Slider label="ความกว้างแถบเมนู" value={draft.sidebarWidth} min={208} max={320} onChange={(v) => update((t) => ({ ...t, sidebarWidth: v }))} />
          </div>
        </section>

        <section className="ds-card ds-card-pad">
          <h3 className="mb-1 font-semibold">ฟอนต์ (Google Fonts)</h3>
          <p className="mb-4 text-sm text-muted">ฟอนต์ปัจจุบัน: <b style={{ fontFamily: `'${draft.fontFamily}'` }}>{draft.fontFamily}</b></p>
          <FontPicker value={draft.fontFamily} onChange={(f) => update((t) => ({ ...t, fontFamily: f }))} />
        </section>

        <section className="ds-card ds-card-pad">
          <h3 className="mb-1 font-semibold">ปรับแต่งแต่ละส่วนของหน้าจอ</h3>
          <p className="mb-4 text-sm text-muted">ค่าที่ว่างไว้จะใช้ค่าจากสีและขนาดด้านบนโดยอัตโนมัติ</p>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(Object.keys(COMPONENT_LABELS) as ComponentKey[]).map((k) => (
              <button key={k} onClick={() => setComp(k)} className={cn('rounded-lg border px-3 py-1.5 text-[13px]', comp === k ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-line hover:border-primary/40', draft.components[k] && Object.keys(draft.components[k]!).length && comp !== k && 'border-primary/30')}>
                {COMPONENT_LABELS[k]}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <ColorField label="พื้นหลัง" value={cs.bg} onChange={(v) => setComponent({ bg: v })} />
            <ColorField label="ตัวอักษร" value={cs.text} onChange={(v) => setComponent({ text: v })} />
            <ColorField label="เส้นขอบ" value={cs.border} onChange={(v) => setComponent({ border: v })} />
          </div>
          <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-3">
            <Slider label="ความหนาขอบ" value={cs.borderWidth ?? resolved.borderWidth} min={0} max={6} onChange={(v) => setComponent({ borderWidth: v })} />
            <Slider label="ความโค้ง" value={cs.radius ?? resolved.radius} min={0} max={40} onChange={(v) => setComponent({ radius: v })} />
            <Slider label="ระยะห่างภายใน" value={cs.padding ?? resolved.padding} min={0} max={48} onChange={(v) => setComponent({ padding: v })} />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Field label="เงา"><Segmented size="sm" value={cs.shadow ?? resolved.shadow} onChange={(v) => setComponent({ shadow: v })} options={[{ value: 'none', label: 'ไม่มี' }, { value: 'sm', label: 'เบา' }, { value: 'md', label: 'กลาง' }, { value: 'lg', label: 'มาก' }]} /></Field>
            <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => update((t) => { const c = { ...t.components }; delete c[comp]; return { ...t, components: c }; })}>รีเซ็ตส่วนนี้</Button>
          </div>
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <Preview t={draft} />
        <div className="ds-card ds-card-pad space-y-2">
          <p className="text-sm text-muted">{dirty ? 'มีการเปลี่ยนแปลงที่ยังไม่บันทึก — หน้าจอแสดงผลตามค่าใหม่แล้ว' : 'ธีมที่ใช้อยู่ถูกบันทึกแล้ว'}</p>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Save className="h-4 w-4" />} disabled={!dirty} loading={busy} onClick={() => run(save, 'บันทึกธีมแล้ว')}>บันทึกธีมของฉัน</Button>
            <Button variant="secondary" disabled={!dirty} onClick={revert}>ยกเลิกการเปลี่ยนแปลง</Button>
          </div>
          <Button variant="ghost" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={async () => { if (await confirmDialog({ title: 'รีเซ็ตธีมเป็นค่าเริ่มต้น?', message: orgDefault ? 'จะกลับไปใช้ธีมขององค์กร' : 'จะกลับไปใช้ธีมมาตรฐานของระบบ' })) void run(resetPersonal, 'รีเซ็ตธีมแล้ว'); }}>
            รีเซ็ตเป็นค่าเริ่มต้น
          </Button>
          {isAdmin && (
            <div className="mt-2 space-y-2 border-t border-line pt-3">
              <p className="flex items-center gap-2 text-sm font-medium"><Building2 className="h-4 w-4 text-primary" />ธีมเริ่มต้นขององค์กร</p>
              <p className="text-xs text-muted">ผู้ใช้ที่ยังไม่ได้ตั้งธีมของตัวเองจะเห็นธีมนี้</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" loading={busy} onClick={() => run(saveAsOrg, 'ตั้งเป็นธีมองค์กรแล้ว')}>ใช้ธีมนี้เป็นค่าเริ่มต้น</Button>
                {orgDefault && <Button size="sm" variant="ghost" onClick={() => run(resetOrg, 'ล้างธีมองค์กรแล้ว')}>ล้างธีมองค์กร</Button>}
              </div>
            </div>
          )}
          <p className="pt-1 text-[11px] text-muted">ค่าเริ่มต้นของระบบ: {DEFAULT_THEME.fontFamily} · สีหลัก {DEFAULT_THEME.colors.primary}</p>
        </div>
      </aside>
    </div>
  );
}
