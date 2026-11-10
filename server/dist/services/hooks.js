"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerColumnDecorator = exports.registerAfterSheetCopied = exports.registerAfterCellsWritten = exports.columnWriteBlockedReason = exports.registerColumnGuard = void 0;
exports.runAfterCellsWritten = runAfterCellsWritten;
exports.runAfterSheetCopied = runAfterSheetCopied;
exports.runColumnDecorators = runColumnDecorators;
const guards = [];
const afterCopies = [];
const afterWrites = [];
/** Return a message to refuse a user write to this column, or null to allow it */
const registerColumnGuard = (fn) => { guards.push(fn); };
exports.registerColumnGuard = registerColumnGuard;
const columnWriteBlockedReason = (col, source) => {
    for (const g of guards) {
        const r = g(col, source);
        if (r)
            return r;
    }
    return null;
};
exports.columnWriteBlockedReason = columnWriteBlockedReason;
/** Runs inside the same transaction as the user's write, after the user's cells are written */
const registerAfterCellsWritten = (fn) => { afterWrites.push(fn); };
exports.registerAfterCellsWritten = registerAfterCellsWritten;
async function runAfterCellsWritten(ctx) {
    const out = [];
    for (const fn of afterWrites)
        out.push(...(await fn(ctx)));
    return out;
}
/** After a sheet (and its columns) was copied — modules re-point references that contain column ids */
const registerAfterSheetCopied = (fn) => { afterCopies.push(fn); };
exports.registerAfterSheetCopied = registerAfterSheetCopied;
async function runAfterSheetCopied(ctx) { for (const fn of afterCopies)
    await fn(ctx); }
const decorators = [];
const registerColumnDecorator = (fn) => { decorators.push(fn); };
exports.registerColumnDecorator = registerColumnDecorator;
async function runColumnDecorators(ctx) { for (const fn of decorators)
    await fn(ctx); }
//# sourceMappingURL=hooks.js.map