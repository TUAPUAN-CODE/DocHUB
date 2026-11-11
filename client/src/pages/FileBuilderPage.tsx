import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, FilePlus2, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { filesApi, usersApi } from '@/api/endpoints';
import { ColumnEditor, draftToPayload, validateDrafts } from '@/components/builder/ColumnEditor';
import { FolderPicker } from '@/components/files/Dialogs';
import { FileGlyph } from '@/components/files/icons';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Inputs';
import { Avatar, ColorInput, PermBadge } from '@/components/ui/misc';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { cn } from '@/lib/cn';
import { newDraft, TEMPLATES, TYPE_META } from '@/lib/columnTypes';
import { useData } from '@/store/data';
import { toast } from '@/store/ui';
import type { ColumnDraft, Perm } from '@/types';
import { DocTypePicker } from '@/modules/revisions/docTypes';
import type { DocType } from '@/modules/revisions/api';

interface SheetDraft { key: string; name: string; tabColor: string | null; columns: ColumnDraft[] }
const STEPS = ['รายละเอียดไฟล์', 'ชีตและคอลัมน์', 'สิทธิ์การเข้าถึง', 'ตรวจสอบและสร้าง'];
const fromTemplate = (id: string) => (TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]).columns.map((c) => newDraft(c));

export default function FileBuilderPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const tree = useData((s) => s.tree);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState('');
  /** ประเภทเอกสาร (must be chosen): master_data | record | null = ทั่วไป */
  const [docType, setDocType] = useState<DocType | undefined>(undefined);
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#16A34A');
  const [folderId, setFolderId] = useState<string | null>(sp.get('folder'));
  const [sheets, setSheets] = useState<SheetDraft[]>([{ key: 's1', name: 'Sheet1', tabColor: null, columns: fromTemplate('blank') }]);
  const [active, setActive] = useState('s1');
  const [access, setAccess] = useState<{ userId: string; name: string; sub?: string; permission: Perm }[]>([]);
  const [pick, setPick] = useState<{ id: string; name: string; sub?: string } | null>(null);
  const [pickPerm, setPickPerm] = useState<Perm>('write');
  const [busy, setBusy] = useState(false);
  const sheet = sheets.find((s) => s.key === active) ?? sheets[0];
  const folder = tree.find((f) => f.id === folderId);

  const stepError = useMemo(() => {
    if (step === 0) return !name.trim() ? 'กรุณาตั้งชื่อไฟล์' : !folderId ? 'กรุณาเลือกโฟลเดอร์' : docType === undefined ? 'กรุณาเลือกประเภทเอกสาร' : null;
    if (step === 1) {
      const names = new Set<string>();
      for (const s of sheets) {
        if (!s.name.trim()) return 'ทุกชีตต้องมีชื่อ';
        if (names.has(s.name.trim().toLowerCase())) return `ชื่อชีต "${s.name}" ซ้ำกัน`;
        names.add(s.name.trim().toLowerCase());
        const e = validateDrafts(s.columns);
        if (e) return `ชีต "${s.name}": ${e}`;
      }
    }
    return null;
  }, [step, name, folderId, sheets, docType]);

  const go = (d: number) => {
    if (d > 0 && stepError) return toast.error(stepError, 'ยังไปขั้นถัดไปไม่ได้');
    setDir(d);
    setStep((s) => Math.max(0, Math.min(STEPS.length - 1, s + d)));
  };
  const setSheet = (p: Partial<SheetDraft>) => setSheets(sheets.map((s) => (s.key === sheet.key ? { ...s, ...p } : s)));
  const addSheet = () => {
    const key = `s${Date.now()}`;
    setSheets([...sheets, { key, name: `Sheet${sheets.length + 1}`, tabColor: null, columns: fromTemplate('blank') }]);
    setActive(key);
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await filesApi.create({
        name: name.trim(), description: description.trim() || null, color, folderId, docType: docType ?? null,
        sheets: sheets.map((s) => ({ name: s.name.trim(), tabColor: s.tabColor, columns: s.columns.map(draftToPayload) })),
        access: access.map((a) => ({ userId: a.userId, permission: a.permission })),
      });
      toast.success('สร้างไฟล์แล้ว', name);
      void useData.getState().loadTree();
      nav(`/files/${r.id}`, { replace: true });
    } catch (e) {
      toast.error(e, 'สร้างไฟล์ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => nav(-1)} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-ink/5" aria-label="ย้อนกลับ"><ArrowLeft className="h-5 w-5" /></button>
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">สร้างฟอร์มเอกสาร</h1>
          <p className="text-sm text-muted">กำหนดโครงสร้างตาราง ชนิดข้อมูล และผู้มีสิทธิ์ ก่อนเริ่มกรอกข้อมูล</p>
        </div>
      </div>

      <ol className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button onClick={() => (i < step ? (setDir(-1), setStep(i)) : undefined)}
              className={cn('flex w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left text-sm transition-colors',
                i === step ? 'border-primary bg-primary/[.06] text-primary' : i < step ? 'border-line bg-surface hover:border-primary/40' : 'border-line bg-surface text-muted')}>
              <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold', i < step ? 'bg-primary text-white' : i === step ? 'bg-primary/15' : 'bg-ink/5')}>
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className="truncate font-medium">{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="ds-card ds-card-pad min-h-[420px] overflow-hidden !p-6">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={step} custom={dir} initial={{ opacity: 0, x: dir * 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -24 }} transition={{ duration: 0.2 }}>
            {step === 0 && (
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <Field label="ชื่อไฟล์" required><TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น IR LINE PF1-09" maxLength={300} /></Field>
                  <Field label="คำอธิบาย"><TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ไฟล์นี้ใช้บันทึกอะไร ใครเป็นผู้กรอก" /></Field>
                  <Field label="สีประจำไฟล์"><ColorInput value={color} onChange={(c) => setColor(c ?? '#16A34A')} /></Field>
                  <div className="flex items-center gap-3 rounded-2xl bg-ink/[.03] p-3">
                    <FileGlyph color={color} size={40} />
                    <div className="min-w-0"><p className="truncate text-xs font-semibold" style={{ color }}>{folder?.name ?? 'ยังไม่เลือกโฟลเดอร์'}</p><p className="truncate font-semibold">{name || 'ชื่อไฟล์'}</p></div>
                  </div>
                </div>
                <Field label="เก็บไว้ในโฟลเดอร์" required hint="แสดงเฉพาะโฟลเดอร์ที่คุณมีสิทธิ์เขียน"><FolderPicker value={folderId} onChange={setFolderId} /></Field>
                <Field group label="ประเภทเอกสาร" required className="lg:col-span-2" hint="กำหนดว่า Rev ของไฟล์นี้ทำงานอย่างไร (เปลี่ยนภายหลังได้ที่ ⋯ → ประเภทเอกสาร)">
                  <DocTypePicker value={docType} onChange={setDocType} />
                </Field>
              </div>
            )}

            {step === 1 && (
              <div>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {sheets.map((s) => (
                    <button key={s.key} onClick={() => setActive(s.key)}
                      className={cn('group inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium', s.key === sheet.key ? 'border-primary bg-primary/[.06] text-primary' : 'border-line hover:border-primary/40')}>
                      <span className="h-2 w-2 rounded-full" style={{ background: s.tabColor ?? 'rgb(var(--c-muted))' }} />{s.name || 'ไม่มีชื่อ'}
                      <span className="text-xs text-muted">{s.columns.length}</span>
                      {sheets.length > 1 && <X className="h-3.5 w-3.5 opacity-50 hover:opacity-100" onClick={(e) => { e.stopPropagation(); const rest = sheets.filter((x) => x.key !== s.key); setSheets(rest); setActive(rest[0].key); }} />}
                    </button>
                  ))}
                  <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={addSheet}>เพิ่มชีต</Button>
                </div>
                <div className="mb-5 grid gap-4 md:grid-cols-[1fr_auto]">
                  <Field label="ชื่อชีต" required><TextInput value={sheet.name} onChange={(e) => setSheet({ name: e.target.value })} maxLength={200} /></Field>
                  <Field label="สีแท็บ"><ColorInput value={sheet.tabColor} onChange={(c) => setSheet({ tabColor: c })} allowEmpty /></Field>
                </div>
                <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted">เริ่มจากแม่แบบ:</span>
                  {TEMPLATES.map((t) => (
                    <button key={t.id} onClick={() => setSheet({ columns: fromTemplate(t.id) })} title={t.description}
                      className="rounded-full border border-line px-3 py-1 text-[13px] hover:border-primary/50 hover:text-primary">{t.name}</button>
                  ))}
                </div>
                <ColumnEditor columns={sheet.columns} onChange={(columns) => setSheet({ columns })} />
              </div>
            )}

            {step === 2 && (
              <div className="max-w-3xl">
                <p className="mb-4 text-sm text-muted">คุณเป็นเจ้าของไฟล์และมีสิทธิ์จัดการโดยอัตโนมัติ ผู้ที่มีสิทธิ์ในโฟลเดอร์ “{folder?.name}” จะได้รับสิทธิ์ตามโฟลเดอร์ด้วย</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1">
                    <SearchSelect value={pick?.id ?? null} onChange={(v, o) => setPick({ id: v, name: o.label, sub: o.sub })} placeholder="ค้นหาผู้ใช้…"
                      load={async (q) => (await usersApi.lookup(q)).map((u) => ({ value: u.id, label: u.displayName, sub: `${u.username} · ${u.role}` }))} />
                  </div>
                  <Select value={pickPerm} onChange={(e) => setPickPerm(e.target.value as Perm)} className="sm:w-40">
                    <option value="read">ดูข้อมูล</option><option value="write">แก้ไขข้อมูล</option><option value="manage">จัดการ</option>
                  </Select>
                  <Button icon={<UserPlus className="h-4 w-4" />} disabled={!pick}
                    onClick={() => { if (pick && !access.some((a) => a.userId === pick.id)) setAccess([...access, { userId: pick.id, name: pick.name, sub: pick.sub, permission: pickPerm }]); setPick(null); }}>เพิ่ม</Button>
                </div>
                <div className="mt-4 divide-y divide-line">
                  {access.length === 0 && <p className="py-8 text-center text-sm text-muted">ยังไม่ได้เพิ่มผู้ใช้ สามารถแชร์ภายหลังได้</p>}
                  {access.map((a) => (
                    <div key={a.userId} className="flex items-center gap-3 py-2.5">
                      <Avatar name={a.name} size={32} />
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{a.name}</p><p className="truncate text-xs text-muted">{a.sub}</p></div>
                      <Select value={a.permission} onChange={(e) => setAccess(access.map((x) => (x.userId === a.userId ? { ...x, permission: e.target.value as Perm } : x)))} className="w-36">
                        <option value="read">ดูข้อมูล</option><option value="write">แก้ไขข้อมูล</option><option value="manage">จัดการ</option>
                      </Select>
                      <button onClick={() => setAccess(access.filter((x) => x.userId !== a.userId))} className="rounded-lg p-2 text-muted hover:bg-danger/10 hover:text-danger" aria-label="เอาออก"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <FileGlyph color={color} size={52} />
                  <div className="min-w-0"><p className="text-sm font-semibold" style={{ color }}>{folder?.name}</p><h2 className="truncate text-xl font-semibold">{name}</h2>
                    {description && <p className="text-sm text-muted">{description}</p>}</div>
                </div>
                {sheets.map((s) => (
                  <div key={s.key}>
                    <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: s.tabColor ?? 'rgb(var(--c-muted))' }} />{s.name} · {s.columns.length} คอลัมน์</p>
                    <div className="overflow-x-auto rounded-xl border border-line">
                      <table className="ds-grid w-max min-w-full text-[13px]">
                        <thead><tr>{s.columns.map((c) => (
                          <th key={c.key} style={{ width: c.width, minWidth: c.width }} className="px-3 py-2 text-left">
                            <span className="flex items-center gap-1.5"><span className="text-primary [&>svg]:h-3.5 [&>svg]:w-3.5">{TYPE_META[c.dataType].icon}</span>{c.name}{c.isRequired && <span className="text-danger">*</span>}</span>
                          </th>))}</tr></thead>
                        <tbody><tr>{s.columns.map((c) => <td key={c.key} className="px-3 py-2 text-muted">{TYPE_META[c.dataType].label}</td>)}</tr></tbody>
                      </table>
                    </div>
                  </div>
                ))}
                <div>
                  <p className="mb-2 text-sm font-semibold">ผู้มีสิทธิ์ ({access.length})</p>
                  <div className="flex flex-wrap gap-2">{access.length ? access.map((a) => (
                    <span key={a.userId} className="inline-flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-sm"><Avatar name={a.name} size={22} />{a.name}<PermBadge perm={a.permission} /></span>
                  )) : <span className="text-sm text-muted">เฉพาะคุณและผู้มีสิทธิ์ในโฟลเดอร์</span>}</div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => go(-1)} disabled={step === 0}>ย้อนกลับ</Button>
        {step < STEPS.length - 1
          ? <Button iconRight={<ArrowRight className="h-4 w-4" />} onClick={() => go(1)}>ถัดไป</Button>
          : <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={create} loading={busy}>สร้างไฟล์</Button>}
      </div>
    </Page>
  );
}
