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
- **Inicio:** dos acciones, **Foto** (grande) y **Nota**; Galería, Prueba, Enlace, Lista y Tabla están en **Más** (hoja inferior). Si todo está enviado, el estado es solo una marca discreta; si hay pendientes o error, se vuelve un aviso.
- **Foto primero:** el botón grande abre la cámara; con un toque la foto y su entrada quedan guardadas. El aviso "Foto guardada" trae **Clasificar** para hacerlo ya; si no, se completa después.
- **Entradas** con elementos: fotos (con pie), texto, enlace, lista, tabla simple y contador de pruebas en vivo (acierto/fallo, nota por intento, deshacer). En el celular se agregan con un solo botón "Agregar".
- **Clasificación** opcional, en filas de resumen que abren hojas (`src/classify.ts`):
  - **¿De qué es?** robot y subsistema en un paso, con los recientes primero.
  - **¿Qué fue?** nueve opciones en lenguaje llano; cada una pone un tipo de entrada y deduce la sección (tabla en `WHAT_OPTIONS`). Si una entrada ya tenía un tipo equivalente (p. ej. Mecanismo dentro de "Construimos"), no se pisa.
  - **¿Quién?** por defecto quien tiene el teléfono; "+ alguien más".
  - **Es un hito** (interruptor) y **Más detalles** plegado: sección, tipo exacto, todas las marcas e hilo. El hilo se propone solo (robot · subsistema) mientras nadie lo escriba a mano.
  - **Igual que la anterior:** si la entrada está sin clasificar, propone (sin aplicarlo) lo último que esa persona usó en ese teléfono (`localStorage` `vw.recent.<id>`; no se manda al servidor).
- En la **vista de computadora** el editor muestra la clasificación completa con chips, como antes.
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

## Versión hospedada (HTTPS, `packages/worker`)

La misma compilación sirve para los dos servidores. El Worker responde `hosted: true` y `access` (`capture` o `edit`) en `/api/state`; la app los recuerda en el teléfono.

- **Service worker** (`service-worker.js`, que `vite.config.ts` convierte en `dist/sw.js` con la lista de archivos y una huella de su contenido). Solo se registra si el servidor dijo `hosted: true`; con el servidor local no se registra (y si había uno, se quita). Guarda la app de esa versión; al abrir pide primero a la red (si no hay, o tarda más de 4 s, usa lo guardado), así que **se puede abrir y recargar sin conexión**. Nunca guarda `/api` (entradas, fotos, plantilla).
- **Actualizaciones:** cada versión publicada cambia `sw.js`. El nuevo toma el control en cuanto se instala y borra la caché vieja; si la app estaba abierta aparece "Hay una versión nueva de la app" (botón Actualizar) y se recarga sola al volver a la pestaña. La versión (`VW_BUILD_LABEL` o la fecha de compilación) se ve al pie.
- **Instalable:** `public/manifest.webmanifest` e íconos en `public/icons/` (los dibuja `scripts/make-icons.ts` con Edge).
- **Clave:** el QR trae `/#k=CLAVE` (lo que va tras `#` no llega al servidor); también se acepta `/#/escritorio?k=CLAVE` y `/?k=CLAVE`. Se guarda y se quita de la barra de direcciones.
- **Permisos:** con la clave de captura no aparece "Vista de computadora", y `#/escritorio` y `#/qr` dicen que hace falta la clave de edición.
- **Página del QR** (`#/qr`, clave de edición): el enlace de captura y su QR, para imprimir.

El almacenamiento, la cola y el contrato son los mismos con los dos servidores.

## Pruebas

- `test/sync-queue.test.ts`: la cola (sin conexión, una sola versión por entrada, edición mientras se manda, fotos en proceso, errores y 401, versión más nueva del servidor, cierre).
- `test/image.test.ts`: hora de captura desde el EXIF.
- `e2e/e2e.ts` (`npm run e2e`): punta a punta en Edge, con dos teléfonos de 360 px y la computadora, contra el servidor local. Guarda capturas y el `.pptx` en `%TEMP%\vortex-wake-app\e2e`.
- `npm run e2e:nube`: la misma prueba contra el Worker en el entorno local de Workers, más permisos de cada clave, página del QR, abrir sin conexión con el service worker y que una versión nueva llegue. Capturas en `%TEMP%\vortex-wake-worker\e2e`.

## Dependencias

- `@vortex-wake/shared` y `@vortex-wake/generator` (del repositorio).
- `vite` (desarrollo): compila y sirve en desarrollo.
- `playwright-core` (desarrollo, en la raíz): maneja el Edge instalado para la prueba de punta a punta; no descarga navegadores.
