// Service worker do Core — SÓ notificação.
//
// NÃO tem handler de `fetch` e NÃO faz cache, de propósito. O Core publica
// várias vezes ao dia; um service worker que guardasse o app.js serviria
// código velho depois do deploy, e o operador veria uma tela que não existe
// mais. Push não precisa de cache — então não tem.
//
// Ver docs/NOTIFICATIONS.md

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// Só o formato que o Core envia é aceito. Payload estranho vira uma notificação
// genérica em vez de exceção silenciosa — falhar aqui perderia o aviso inteiro.
self.addEventListener('push', event => {
 let dados = {};
 try { dados = event.data ? event.data.json() : {}; } catch { dados = {}; }
 const titulo = typeof dados.title === 'string' && dados.title ? dados.title.slice(0, 120) : 'TZOLKIN Core';
 const corpo = typeof dados.body === 'string' ? dados.body.slice(0, 300) : '';
 // `tag` colapsa avisos repetidos do mesmo assunto em vez de empilhar.
 const tag = typeof dados.tag === 'string' ? dados.tag.slice(0, 80) : 'core';
 const view = typeof dados.view === 'string' ? dados.view.slice(0, 60) : null;

 event.waitUntil(self.registration.showNotification(titulo, {
  body: corpo,
  tag,
  icon: '/icon-192.png',
  badge: '/icon-192.png',
  data: { view },
 }));
});

// Abrir a aba que já existe em vez de criar outra a cada toque.
self.addEventListener('notificationclick', event => {
 event.notification.close();
 const view = event.notification.data && event.notification.data.view;
 const destino = view ? `/?view=${encodeURIComponent(view)}` : '/';
 event.waitUntil((async () => {
  const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const aba of abas) {
   if (new URL(aba.url).origin === self.location.origin) {
    await aba.focus();
    if ('navigate' in aba && view) await aba.navigate(destino).catch(() => {});
    return;
   }
  }
  await self.clients.openWindow(destino);
 })());
});
