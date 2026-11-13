import{V as o}from"./index-C9VruyD5.js";const a=new Map;function l(t,e=!1){return e&&a.delete(t),a.has(t)||a.set(t,o.get(t).then(n=>n.columns).catch(()=>(a.delete(t),[]))),a.get(t)}export{l};
