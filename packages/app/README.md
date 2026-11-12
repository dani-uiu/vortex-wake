# @vortex-wake/app

La página web de captura (celular) y la vista de computadora. Vite + TypeScript, sin framework ni librerías de interfaz.

## Uso en el taller

```
npm run taller
```

Compila la app y arranca el servidor local (`packages/dev-server`). Los celulares, en la misma red wifi (o en el hotspot de la laptop), escanean el QR. Ver `packages/dev-server/README.md`.

Desarrollo con recarga: `npm run servidor` en una terminal y `npm run dev -w @vortex-wake/app` en otra (Vite manda `/api` al puerto 4321). Para probar en el celular durante el desarrollo, abre la app una vez con `?k=<clave>`.

## Qué hace

- **Entrada:** cada quien toca su nombre (el teléfono lo recuerda). Eso registra su asistencia en la sesión del día (una sesión = un día, se crea sola). Se puede agregar gente desde ahí.
- **Foto primero:** el botón grande abre la cámara; con un toque la foto y su entrada quedan guardadas. Lo demás se completa después.
- **Entradas** con elementos: fotos (con pie), texto, enlace, lista, tabla simple y contador de pruebas en vivo (acierto/fallo, nota por intento, deshacer).
- **Clasificación** opcional con chips: autores (los presentes; queda el último usado), sección, tipo de entrada, robot, subsistema, marca e hilo (con sugerencias).
- **Lista del día** de todo el equipo, con filtros "Sin clasificar" y "Mías", y edición de entradas propias y ajenas.
- **Cierre de sesión** con tres preguntas.
- **Vista de computadora** (`#/escritorio`, o "Vista de computadora" al pie): línea de tiempo por sesión, edición en un panel, equipo (integrantes y robots) y **Generar bitácora**, que arma el documento (`shared/assemble.ts`) y genera el `.pptx` en el navegador con `packages/generator` (se carga solo al usarlo).

## Cómo no se pierde nada

1. Todo se guarda primero en el teléfono (IndexedDB) y en ese momento se anota en la cola de pendientes (`src/sync-queue.ts`).
2. La foto original se guarda tal cual al instante; después se reduce (lado mayor 1600 px, JPEG) y reemplaza al original. Si la pestaña se cierra a la mitad, al volver a abrir se termina de procesar (y si la entrada no alcanzó a guardarse, se recupera a partir de la foto).
3. La cola manda fotos, asistencia, entradas y cierres; no borra nada hasta que el servidor responde que sí. Sin conexión reintenta cada pocos segundos; con errores del servidor, con espera creciente y mostrando el error.
4. El texto se guarda mientras se escribe (cada 350 ms y al salir del campo o de la pestaña).
5. Cada entrada muestra "En este teléfono" o "Enviado"; arriba, el estado general.
6. Dos teléfonos en la misma sesión: los ids los genera el cliente (enviar dos veces no duplica), la asistencia se une y en cada entrada gana la edición más reciente (la entrada completa).

## Limitaciones por HTTP (sin HTTPS)

En la red local por `http://` no hay contexto seguro, así que:

- **No hay service worker ni instalación como app.** Si la pestaña ya está abierta, todo funciona sin conexión; pero **abrir la app de cero** (o recargarla) necesita que la laptop esté encendida y alcanzable.
- No se usa `getUserMedia`: la cámara es `<input type="file" accept="image/*" capture="environment">`.
- No se usan `crypto.randomUUID` ni `navigator.storage.persist()`. El navegador podría borrar el almacenamiento si el teléfono se queda sin espacio (normalmente no pasa con lo de un día).

Para cuando haya HTTPS: registrar un service worker en `src/main.ts` que guarde en caché `index.html` y `assets/` (los nombres ya llevan hash) y agregar un `manifest.webmanifest`. El almacenamiento, la cola y el contrato no cambian.

## Pruebas

- `test/sync-queue.test.ts`: la cola (sin conexión, una sola versión por entrada, edición mientras se manda, fotos en proceso, errores y 401, versión más nueva del servidor, cierre).
- `test/image.test.ts`: hora de captura desde el EXIF.
- `e2e/e2e.ts` (`npm run e2e`): punta a punta en Edge, con dos teléfonos de 360 px y la computadora. Guarda capturas y el `.pptx` en `%TEMP%\vortex-wake-app\e2e`.

## Dependencias

- `@vortex-wake/shared` y `@vortex-wake/generator` (del repositorio).
- `vite` (desarrollo): compila y sirve en desarrollo.
- `playwright-core` (desarrollo, en la raíz): maneja el Edge instalado para la prueba de punta a punta; no descarga navegadores.
