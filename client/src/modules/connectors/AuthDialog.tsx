import { useEffect, useState } from 'react';
import { KeyRound, LogIn } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Field, Segmented, TextInput } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/store/ui';
import { Connector, Credentials, connectorsApi } from './api';

/**
 * Popup shown when a link needs a login.
 *  - SharePoint / OneDrive: real Microsoft sign-in (a popup window) — Microsoft does not accept a plain account + password on these links.
 *  - Any other link: account + password, bearer token or API-key header. Stored encrypted on the server and never shown again.
 */
export function AuthDialog({ open, onClose, connector, message, onReady }: { open: boolean; onClose: () => void; connector: Connector; message?: string; onReady: (c?: Credentials) => void }) {
  const [type, setType] = useState<Credentials['type']>('basic');
  const [f, setF] = useState<Credentials>({ type: 'basic' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ type: 'basic' }); setType('basic'); } }, [open]);
  useEffect(() => {
    const h = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === 'ms-connector') { if (e.data.ok) { toast.success('เข้าสู่ระบบ Microsoft แล้ว'); onClose(); onReady(); } else toast.error('เข้าสู่ระบบ Microsoft ไม่สำเร็จ'); } };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [onClose, onReady]);

  const ms = async () => {
    if (!connector.id) return toast.error('กรุณาบันทึก connector ก่อน แล้วค่อยเข้าสู่ระบบ');
    try { const { url } = await connectorsApi.msStart(connector.id); if (!window.open(url, 'ms-login', 'width=520,height=680')) toast.error('เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป — อนุญาตป๊อปอัปแล้วลองใหม่'); }
    catch (e) { toast.error(apiError(e).message); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const cred = { ...f, type };
      if (connector.id) await connectorsApi.credentials(connector.id, cred);
      onClose(); onReady(cred);
    } catch (e) { toast.error(apiError(e).message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" icon={<KeyRound className="h-5 w-5" />} title="ต้องเข้าสู่ระบบเพื่อเข้าถึงข้อมูล" description={message}
      footer={connector.kind === 'sharepoint' ? <Button variant="secondary" onClick={onClose}>ปิด</Button> : <><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={() => void save()} loading={busy}>บันทึกและลองใหม่</Button></>}>
      {connector.kind === 'sharepoint' ? (
        <div className="space-y-3 text-sm">
          <p>ลิงก์ SharePoint / OneDrive ต้องยืนยันตัวตนผ่านหน้า Microsoft (รองรับ MFA) — กดปุ่มด้านล่าง แล้วเข้าสู่ระบบด้วยบัญชีที่มีสิทธิ์เปิดไฟล์นี้</p>
          <Button onClick={() => void ms()}><LogIn className="h-4 w-4" />เข้าสู่ระบบด้วย Microsoft</Button>
          <p className="text-xs text-muted">ระบบเก็บเฉพาะโทเคนของ Microsoft แบบเข้ารหัสไว้บนเซิร์ฟเวอร์ (ไม่เก็บรหัสผ่าน)</p>
        </div>
      ) : (
        <div className="space-y-3">
          <Segmented size="sm" value={type} onChange={(v) => setType(v)} options={[{ value: 'basic', label: 'บัญชี + รหัสผ่าน' }, { value: 'bearer', label: 'Bearer token' }, { value: 'header', label: 'API key (header)' }]} />
          {type === 'basic' && <><Field label="ชื่อบัญชี"><TextInput value={f.username ?? ''} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" /></Field><Field label="รหัสผ่าน"><TextInput type="password" value={f.password ?? ''} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field></>}
          {type === 'bearer' && <Field label="Token"><TextInput type="password" value={f.token ?? ''} onChange={(e) => setF({ ...f, token: e.target.value })} autoComplete="off" /></Field>}
          {type === 'header' && <><Field label="ชื่อ header (เช่น X-API-Key)"><TextInput value={f.headerName ?? ''} onChange={(e) => setF({ ...f, headerName: e.target.value })} /></Field><Field label="ค่า"><TextInput type="password" value={f.token ?? ''} onChange={(e) => setF({ ...f, token: e.target.value })} autoComplete="off" /></Field></>}
          <p className="text-xs text-muted">เก็บแบบเข้ารหัสบนเซิร์ฟเวอร์ ไม่ส่งกลับมาที่เบราว์เซอร์ และใช้ได้เฉพาะ connector นี้</p>
        </div>
      )}
    </Modal>
  );
}
