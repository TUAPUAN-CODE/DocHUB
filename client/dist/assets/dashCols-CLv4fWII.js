import{N as o}from"./index-B83e8t9b.js";const a=new Map;function l(t,e=!1){return e&&a.delete(t),a.has(t)||a.set(t,o.get(t).then(n=>n.columns).catch(()=>(a.delete(t),[]))),a.get(t)}export{l};
