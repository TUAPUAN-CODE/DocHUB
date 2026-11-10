import router, { publicRouter } from './routes';

/**
 * "ขอสร้างบัญชี": a sign-up form, or signing in with Microsoft / Google without an account, makes a request with the role
 * the person asks for; admins are notified and approve it with the role they decide (users page → คำขอสร้างบัญชี).
 */
export default { router, publicRouter };
