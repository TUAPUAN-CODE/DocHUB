
declare module 'pdfmake/build/pdfmake';

declare module 'pdfmake/js/qrEnc.js' {
  const qrEnc: { measure: (node: Record<string, unknown>) => { _canvas: { type: string; x: number; y: number; w: number; h: number; color: string }[]; _width: number } };
  export default qrEnc;
}
