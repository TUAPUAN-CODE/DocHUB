"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHex = exports.DEFAULT_START_HEX = exports.DEFAULT_INIT_HEX = exports.isValidEpc = void 0;
exports.createFrameParser = createFrameParser;
exports.withChecksum = withChecksum;
/**
 * Splits the TCP stream of the RFID reader (same protocol as PFCM RFIDc1.js): tag frame = CC FF FF 20 …, EPC = bytes 9–20.
 * TCP does not keep frames apart (several in one chunk, or one cut in two), so bytes are collected in a buffer.
 */
const FRAME_HEADER = Buffer.from('CCFFFF', 'hex');
const TAG_FRAME_CMD = 0x20;
const EPC_START = 9;
const EPC_END = 21;
const MAX_FRAME_LEN = 64;
const MAX_BUFFER = 4096;
const STALE_MS = 1000; // a half frame older than this is broken: drop it
function createFrameParser() {
    let buf = Buffer.alloc(0);
    let lastChunkAt = 0;
    const push = (data, now = Date.now()) => {
        if (buf.length > 0 && now - lastChunkAt > STALE_MS)
            buf = Buffer.alloc(0);
        lastChunkAt = now;
        buf = Buffer.concat([buf, data]);
        if (buf.length > MAX_BUFFER)
            buf = buf.subarray(buf.length - MAX_BUFFER);
        const epcs = [];
        for (;;) {
            const idx = buf.indexOf(FRAME_HEADER);
            if (idx === -1) {
                buf = buf.subarray(Math.max(0, buf.length - (FRAME_HEADER.length - 1)));
                break;
            }
            if (idx > 0)
                buf = buf.subarray(idx);
            if (buf.length < 4)
                break;
            if (buf[3] !== TAG_FRAME_CMD) {
                buf = buf.subarray(FRAME_HEADER.length);
                continue;
            } // not a tag frame (command ack)
            if (buf.length < EPC_END)
                break;
            const next = buf.indexOf(FRAME_HEADER, 3);
            if (next !== -1 && next < EPC_END) {
                buf = buf.subarray(next);
                continue;
            } // truncated frame
            let len = EPC_END;
            if (buf.length >= 6) {
                const declared = 7 + buf.readUInt16BE(4);
                if (declared >= EPC_END && declared <= MAX_FRAME_LEN)
                    len = declared;
            }
            if (next !== -1 && next < len)
                len = next;
            if (buf.length < len)
                break;
            epcs.push(buf.subarray(EPC_START, EPC_END).toString('hex').toUpperCase());
            buf = buf.subarray(len);
        }
        return epcs;
    };
    return { push, reset: () => { buf = Buffer.alloc(0); lastChunkAt = 0; } };
}
/** Not 24 hex chars, or one character repeated (000… / FFF…) = noise */
const isValidEpc = (epc) => /^[0-9A-F]{24}$/.test(epc) && !/^(.)\1+$/.test(epc);
exports.isValidEpc = isValidEpc;
/** Commands PFCM's RFIDc1.js sends when it connects: the reader streams tags only after them */
exports.DEFAULT_INIT_HEX = '7CFFFF823200D2'; // checksum is added (two's complement of the byte sum)
exports.DEFAULT_START_HEX = '7CFFFF20000501000200C896'; // sent as is
function withChecksum(hex) {
    const buf = Buffer.from(hex, 'hex');
    let sum = 0;
    for (const b of buf)
        sum += b;
    return Buffer.concat([buf, Buffer.from([(~sum + 1) & 0xff])]);
}
const isHex = (s) => /^([0-9A-Fa-f]{2})+$/.test(s.trim());
exports.isHex = isHex;
//# sourceMappingURL=rfidFrame.js.map