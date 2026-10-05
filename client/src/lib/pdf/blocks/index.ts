import { registerBlockModule } from '../registry';
import { buildCharGrid, CharGridBlock, newCharGrid } from './charGrid';
import { buildInfoRow, InfoRowBlock, newInfoRow } from './infoRow';
import { buildSignature, newSignature, SignatureBlock } from './signature';

/** Built-in extra blocks. Add a new block type = one more registerBlockModule() call (+ its designer form). */
registerBlockModule<SignatureBlock>({
  type: 'signature', label: 'ช่องลงชื่อ', scopes: ['body'], create: newSignature, build: buildSignature,
  summary: (b) => b.slots.map((s) => s.label).join(' · '),
});
registerBlockModule<InfoRowBlock>({
  type: 'infoRow', label: 'แถวข้อมูลหัวเอกสาร', scopes: ['body', 'header'], create: newInfoRow, build: buildInfoRow,
  summary: (b) => b.items.map((i) => i.label).join(' '),
});
registerBlockModule<CharGridBlock>({
  type: 'charGrid', label: 'กริดตัวอักษร (1 ตัว 1 ช่อง)', scopes: ['body'], create: newCharGrid, build: buildCharGrid,
  summary: (b) => `${b.lines.length} บรรทัด × ${b.cells} ช่อง`,
});
