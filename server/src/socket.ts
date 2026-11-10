import { invalidateRowCount } from './services/rowCount';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import { env } from './config/env';
import { AuthUser, loadAuthUser, verifyAccessToken } from './middleware/auth';
import { isGuid } from './shared/http';
import { LV, requireSheet } from './shared/permissions';
import { logger } from './shared/logger';
import { attachCluster } from './services/cluster';

let io: IOServer | null = null;

/** connections open right now (this process) — admin Monitor page */
export const onlineSockets = () => io?.engine.clientsCount ?? 0;

export function initSocket(server: http.Server) {
  io = new IOServer(server, {
    cors: { origin: env.corsOrigins, credentials: true },
    path: '/socket.io',
  });
  attachCluster(io); // with REDIS_URL: events reach people connected to the other server too

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('unauthorized'));
      const payload = verifyAccessToken(token);
      const user = await loadAuthUser(payload.sub);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthUser;
    socket.join(`user:${user.id}`);

    socket.on('sheet:join', async (sheetId: string, ack?: (r: { ok: boolean }) => void) => {
      try {
        if (!isGuid(sheetId)) throw new Error('bad id');
        const id = sheetId.toLowerCase();
        await requireSheet(user, id, LV.read);
        for (const room of [...socket.rooms]) {
          if (room.startsWith('sheet:') && room !== `sheet:${id}`) {
            socket.leave(room);
            void broadcastPresence(room.slice(6));
          }
        }
        socket.join(`sheet:${id}`);
        await broadcastPresence(id);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    });

    socket.on('sheet:leave', (sheetId: string) => {
      if (!isGuid(sheetId)) return;
      const id = sheetId.toLowerCase();
      socket.leave(`sheet:${id}`);
      void broadcastPresence(id);
    });

    socket.on('disconnecting', () => {
      const rooms = [...socket.rooms].filter((r) => r.startsWith('sheet:'));
      setTimeout(() => rooms.forEach((r) => void broadcastPresence(r.slice(6))), 100);
    });
  });

  logger.info('Socket.IO ready');
}

async function broadcastPresence(sheetId: string) {
  if (!io) return;
  try {
    const sockets = await io.in(`sheet:${sheetId}`).fetchSockets();
    const users = new Map<string, { id: string; displayName: string; avatarUrl: string | null }>();
    for (const s of sockets) {
      const u = s.data.user as AuthUser | undefined;
      if (u) users.set(u.id, { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl });
    }
    io.to(`sheet:${sheetId}`).emit('sheet:presence', { sheetId, users: [...users.values()] });
  } catch (e: any) {
    logger.warn(`presence failed: ${e?.message}`);
  }
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToSheet(sheetId: string, event: string, payload: unknown, exceptSocketId?: string) {
  if (event === 'rows:changed') invalidateRowCount(sheetId); // rows were added / removed: the remembered totals are stale
  if (!io) return;
  const target = io.to(`sheet:${sheetId}`);
  (exceptSocketId ? target.except(exceptSocketId) : target).emit(event, payload);
}
