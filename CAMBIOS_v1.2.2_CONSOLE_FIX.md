# RELEVAMIENTO MANAGER v1.2.2 — Console hygiene

- Corrige el warning de Chrome: `Password forms should have username fields`.
- Email y contraseña del login ahora pertenecen al mismo `<form>`.
- Agrega `name` y `autocomplete` semánticos.
- Mejora campos de alta de administradores con `autocomplete`.
- Verificado: la PWA no usa `chrome.runtime`, `sendMessage()` ni listeners de extensiones.
- Los mensajes `A listener indicated an asynchronous response...` provienen de extensiones del navegador y no pueden suprimirse desde la PWA.
