"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.purgeCooldowns = exports.releaseReading = void 0;
exports.claimReading = claimReading;
const db_1 = require("../../config/db");
/**
 * "Do not read the same card again within N minutes", shared by every reader that writes into the same sheet:
 * the memory is (sheet, value) in the database, not per reader, and survives a restart.
 * Returns true when this reading may be used (and starts a new waiting period), false when it is too soon.
 */
async function claimReading(sheetId, value, seconds) {
    if (seconds <= 0)
        return { ok: true, remainingSec: 0 };
    const r = await (0, db_1.q1)(`DECLARE @ok BIT = 0;
     UPDATE DeviceCooldown SET last_at = SYSUTCDATETIME() WHERE sheet_id = @s AND value = @v AND last_at <= DATEADD(SECOND, -@sec, SYSUTCDATETIME());
     IF @@ROWCOUNT > 0 SET @ok = 1;
     ELSE IF NOT EXISTS (SELECT 1 FROM DeviceCooldown WHERE sheet_id = @s AND value = @v) BEGIN
       BEGIN TRY INSERT INTO DeviceCooldown (sheet_id, value, last_at) VALUES (@s, @v, SYSUTCDATETIME()); SET @ok = 1; END TRY BEGIN CATCH SET @ok = 0; END CATCH
     END
     SELECT @ok AS ok, (SELECT DATEDIFF(SECOND, SYSUTCDATETIME(), DATEADD(SECOND, @sec, last_at)) FROM DeviceCooldown WHERE sheet_id = @s AND value = @v) AS remaining`, { s: db_1.T.uuid(sheetId), v: db_1.T.text(value), sec: db_1.T.int(Math.round(seconds)) });
    return { ok: !!r?.ok, remainingSec: Math.max(0, Number(r?.remaining ?? 0)) };
}
/** The reading failed (card not found, …): let the next reading try again at once */
const releaseReading = (sheetId, value) => (0, db_1.q)(`DELETE FROM DeviceCooldown WHERE sheet_id = @s AND value = @v`, { s: db_1.T.uuid(sheetId), v: db_1.T.text(value) }).catch(() => undefined);
exports.releaseReading = releaseReading;
/** Old memory is useless: drop what is older than a day (called now and then) */
const purgeCooldowns = () => (0, db_1.q)(`DELETE FROM DeviceCooldown WHERE last_at < DATEADD(DAY, -1, SYSUTCDATETIME())`).catch(() => undefined);
exports.purgeCooldowns = purgeCooldowns;
//# sourceMappingURL=cooldown.js.map