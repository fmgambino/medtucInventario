const CACHE='medtuc-inventario-v0.3.3';
const CORE=['./','index.html','assets/css/styles.css','assets/js/config.example.js','assets/js/app.js','assets/icons/logo.svg','assets/img/ministerio-educacion-tucuman.png','manifest.webmanifest'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin===location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/update_manifest.json') || url.pathname.endsWith('/assets/js/app.js') || url.pathname.endsWith('/assets/js/config.example.js'))){
    e.respondWith(fetch(req,{cache:'no-store'}).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));return r}).catch(()=>caches.match(req)));
    return;
  }
  e.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(r=>{if(url.origin===location.origin){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return r})));
});
