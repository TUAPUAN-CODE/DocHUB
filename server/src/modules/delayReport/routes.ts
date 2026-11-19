import { Router } from 'express';
import { ah } from '../../shared/http';
import { delayTemplate } from './bootstrap';

const router = Router();

/** Blank Excel form F3PFPV04 for the export "Excel F3PFPV04" of the Delay report (the web page fills the cells, like DelayHUB does) */
router.get('/delay-report/template.xlsx', ah(async (_req, res) => {
  const buf = await delayTemplate();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(buf);
}));

export default router;
