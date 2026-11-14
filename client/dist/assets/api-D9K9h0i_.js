import{c as o,g as n,p as r,bN as h}from"./index-BRzHdSHF.js";/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=o("ScanLine",[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}],["path",{d:"M7 12h10",key:"b7w52i"}]]),d={saveTimeLinks:(t,e)=>h(`/sheets/${t}/time-links`,{links:e}),timeLinks:t=>n(`/trace/time/rows/${t}`),find:(t,e,a)=>r(`/sheets/${t}/find`,{columnId:e,value:a}),trace:(t,e,a=8)=>n(`/trace/rows/${t}`,{dir:e,depth:a})};function k(t){const e=new Map([[t.startRowId,0]]);for(const a of t.links){const s=a.dir==="back"?a.parent:a.child,c=a.dir==="back"?-a.lvl:a.lvl,i=e.get(s);(i===void 0||Math.abs(c)<Math.abs(i))&&e.set(s,c)}return e}export{p as S,k as l,d as t};
