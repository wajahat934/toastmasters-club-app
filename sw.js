/* Service worker — deliberately network-first.

   This app has no build step. The only cache control it has ever had is the
   ?v=NN query on the asset URLs in index.html, bumped by hand on every deploy.
   A normal cache-first worker would fight that and pin members to an old
   app.js with no way to push them off it, which is the worst failure this
   codebase could have. So this worker always tries the network first and only
   reaches into the cache when the network actually fails.

   Its job is only:
     1. to satisfy the browser's requirement for an installable app, and
     2. to let an app that is already open survive a dropped connection.

   Cross-origin requests are never touched — Supabase auth and data, and the
   supabase-js CDN import, must always go straight to the network. */
const CACHE='rtc-runtime-v1';

self.addEventListener('install',()=>{ self.skipWaiting(); });

self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    for(const k of await caches.keys())if(k!==CACHE)await caches.delete(k);
    await self.clients.claim();
  })());
});

/* Escape hatch: if this worker ever misbehaves in the wild, replacing this
   file with one that calls self.registration.unregister() removes it from
   every device on the next visit. Kept in mind deliberately — a service
   worker is otherwise very hard to take back. */
self.addEventListener('message',e=>{
  if(e.data==='unregister')self.registration.unregister();
});

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  let url;
  try{ url=new URL(req.url); }catch(err){ return; }
  if(url.origin!==self.location.origin)return;   /* Supabase and the CDN: hands off */
  e.respondWith((async()=>{
    try{
      const fresh=await fetch(req);
      /* only a real, complete response is worth keeping for the offline case */
      if(fresh&&fresh.ok&&fresh.type==='basic'){
        const c=await caches.open(CACHE);
        c.put(req,fresh.clone());
      }
      return fresh;
    }catch(err){
      const hit=await caches.match(req);
      if(hit)return hit;
      throw err;
    }
  })());
});
