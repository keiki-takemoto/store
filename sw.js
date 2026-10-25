/* オフラインでも開けるようにする。直したら番号を1つ上げること。 */
const CACHE = "store-v74";
const SHELL = ["./","./index.html","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png",
  "./icons/apple-touch-icon.png","./icons/favicon-32.png",
  "./shift/","./shift/index.html","./shift/setup.html",
  "./settings/","./settings/index.html","./settings/items.json",
  "./box/","./box/index.html",
  "./reg/","./reg/index.html",
  "./sum/","./sum/index.html",
  "./visit/","./visit/index.html",
  "./cost/","./cost/index.html","./pl/","./pl/index.html",
  "./shared/theme.css","./shared/shift-format.js","./shared/sync.js","./shared/books.js","./shared/sales.js"];
self.addEventListener("install",(e)=>{e.waitUntil(caches.open(CACHE)
  .then((c)=>Promise.all(SHELL.map((u)=>c.add(u).catch(()=>null)))).then(()=>self.skipWaiting()))});
self.addEventListener("activate",(e)=>{e.waitUntil(caches.keys()
  .then((ks)=>Promise.all(ks.filter((k)=>k!==CACHE).map((k)=>caches.delete(k)))).then(()=>self.clients.claim()))});
/* ---- スマホへの通知 ---- */
/* Supabase の Edge Function から届く。中身は {title, body, url}。 */
self.addEventListener("push",(e)=>{
  let d={};
  try{ d=e.data?e.data.json():{} }catch(_){ try{ d={body:e.data.text()} }catch(__){} }
  const title=d.title||"ZIPANG";
  e.waitUntil(self.registration.showNotification(title,{
    body:d.body||"",
    icon:"./icons/icon-192.png",
    badge:"./icons/favicon-32.png",
    tag:d.tag||"zipang",
    renotify:true,
    data:{url:d.url||"./box/"}
  }));
});
self.addEventListener("notificationclick",(e)=>{
  e.notification.close();
  const url=new URL((e.notification.data&&e.notification.data.url)||"./box/",self.location).href;
  e.waitUntil((async()=>{
    const ws=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const w of ws){
      if(w.url.startsWith(self.location.origin)){ await w.focus(); return w.navigate(url) }
    }
    return self.clients.openWindow(url);
  })());
});

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
