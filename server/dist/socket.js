"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onlineSockets = void 0;
exports.initSocket = initSocket;
exports.emitToAll = emitToAll;
exports.emitToUser = emitToUser;
exports.emitToSheet = emitToSheet;
const rowCount_1 = require("./services/rowCount");
const socket_io_1 = require("socket.io");
const env_1 = require("./config/env");
const auth_1 = require("./middleware/auth");
const http_1 = require("./shared/http");
const permissions_1 = require("./shared/permissions");
const logger_1 = require("./shared/logger");
const cluster_1 = require("./services/cluster");
let io = null;
/** connections open right now (this process) — admin Monitor page */
const onlineSockets = () => io?.engine.clientsCount ?? 0;
exports.onlineSockets = onlineSockets;
function initSocket(server) {
    io = new socket_io_1.Server(server, {
        cors: { origin: env_1.env.corsOrigins, credentials: true },
        path: '/socket.io',
    });
    (0, cluster_1.attachCluster)(io); // with REDIS_URL: events reach people connected to the other server too
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth?.token;
            if (!token)
                return next(new Error('unauthorized'));
            const payload = (0, auth_1.verifyAccessToken)(token);
            const user = await (0, auth_1.loadAuthUser)(payload.sub);
            if (!user)
                return next(new Error('unauthorized'));
            socket.data.user = user;
            next();
        }
        catch {
            next(new Error('unauthorized'));
        }
    });
    io.on('connection', (socket) => {
        const user = socket.data.user;
        socket.join(`user:${user.id}`);
        socket.on('sheet:join', async (sheetId, ack) => {
            try {
                if (!(0, http_1.isGuid)(sheetId))
                    throw new Error('bad id');
                const id = sheetId.toLowerCase();
                await (0, permissions_1.requireSheet)(user, id, permissions_1.LV.read);
                for (const room of [...socket.rooms]) {
                    if (room.startsWith('sheet:') && room !== `sheet:${id}`) {
                        socket.leave(room);
                        void broadcastPresence(room.slice(6));
                    }
                }
                socket.join(`sheet:${id}`);
                await broadcastPresence(id);
                ack?.({ ok: true });
            }
            catch {
                ack?.({ ok: false });
            }
        });
        socket.on('sheet:leave', (sheetId) => {
            if (!(0, http_1.isGuid)(sheetId))
                return;
            const id = sheetId.toLowerCase();
            socket.leave(`sheet:${id}`);
            void broadcastPresence(id);
        });
        socket.on('disconnecting', () => {
            const rooms = [...socket.rooms].filter((r) => r.startsWith('sheet:'));
            setTimeout(() => rooms.forEach((r) => void broadcastPresence(r.slice(6))), 100);
        });
    });
    logger_1.logger.info('Socket.IO ready');
}
async function broadcastPresence(sheetId) {
    if (!io)
        return;
    try {
        const sockets = await io.in(`sheet:${sheetId}`).fetchSockets();
        const users = new Map();
        for (const s of sockets) {
            const u = s.data.user;
            if (u)
                users.set(u.id, { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl });
        }
        io.to(`sheet:${sheetId}`).emit('sheet:presence', { sheetId, users: [...users.values()] });
    }
    catch (e) {
        logger_1.logger.warn(`presence failed: ${e?.message}`);
    }
}
/** every signed-in browser (e.g. the page permissions changed) */
function emitToAll(event, payload) {
    io?.emit(event, payload);
}
function emitToUser(userId, event, payload) {
    io?.to(`user:${userId}`).emit(event, payload);
}
function emitToSheet(sheetId, event, payload, exceptSocketId) {
    if (event === 'rows:changed')
        (0, rowCount_1.invalidateRowCount)(sheetId); // rows were added / removed: the remembered totals are stale
    if (!io)
        return;
    const target = io.to(`sheet:${sheetId}`);
    (exceptSocketId ? target.except(exceptSocketId) : target).emit(event, payload);
}
//# sourceMappingURL=socket.js.map