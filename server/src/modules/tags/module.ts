import { Router } from 'express';
import requests from './requests';
import routes from './routes';

/** User tags (many per user, system tag All = everyone), sharing by tag, and tag requests ("ขอ Tag"). */
const router = Router();
router.use(requests);
router.use(routes);
export default { router };
