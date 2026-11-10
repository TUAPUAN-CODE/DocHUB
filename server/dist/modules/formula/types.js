"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FormulaEvalError = exports.FormulaSyntaxError = exports.isDateV = void 0;
const isDateV = (v) => !!v && typeof v === 'object' && 'ms' in v;
exports.isDateV = isDateV;
class FormulaSyntaxError extends Error {
    constructor(message, pos) {
        super(message);
        this.pos = pos;
        this.name = 'FormulaSyntaxError';
    }
}
exports.FormulaSyntaxError = FormulaSyntaxError;
/** Raised while evaluating one row; the cell simply becomes empty */
class FormulaEvalError extends Error {
}
exports.FormulaEvalError = FormulaEvalError;
//# sourceMappingURL=types.js.map