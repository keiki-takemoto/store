/* オフラインでも開けるようにする。直したら番号を1つ上げること。 */
const CACHE = "store-v16";
const SHELL = ["./","./index.html","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png",
  "./icons/apple-touch-icon.png","./icons/favicon-32.png",
  "./shift/","./shift/index.html","./shift/setup.html",
  "./shared/theme.css","./shared/shift-format.js","./shared/sync.js"];
self.addEventListener("install",(e)=>{e.waitUntil(caches.open(CACHE)
  .then((c)=>Promise.all(SHELL.map((u)=>c.add(u).catch(()=>null)))).then(()=>self.skipWaiting()))});
self.addEventListener("activate",(e)=>{e.waitUntil(caches.keys()
  .then((ks)=>Promise.all(ks.filter((k)=>k!==CACHE).map((k)=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",(e)=>{
  const req=e.request;
  if(req.method!=="GET") return;
  if(new URL(req.url).origin!==self.location.origin) return;
  if(req.mode==="navigate"){
    e.respondWith(fetch(req).then((res)=>{const c=res.clone();caches.open(CACHE).then((k)=>k.put(req,c));return res})
      .catch(()=>caches.match(req).then((r)=>r||caches.match("./index.html"))));
    return;
  }
  e.respondWith(caches.match(req).then((hit)=>{
    const net=fetch(req).then((res)=>{if(res&&res.status===200){const c=res.clone();caches.open(CACHE).then((k)=>k.put(req,c))}return res}).catch(()=>hit);
    return hit||net;
  }));
});
