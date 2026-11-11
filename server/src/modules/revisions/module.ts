import { Router } from 'express';
import { ensureTypedBaselines, router as docTypes } from './docTypes';
import revisions from './routes';

/**
 * Sheet revisions ("ออก Rev"): a user freezes the sheet as Rev.N; each revision keeps what changed since the previous one —
 * the data (Master Data / ทั่วไป) and the format (columns, options, form layout, PDF layouts). Document types of files.
 */
const router = Router();
router.use(revisions);
router.use(docTypes);
export default { router };
export { ensureTypedBaselines };
