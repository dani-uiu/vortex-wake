# @vortex-wake/worker

La versión de Vortex Wake en la nube: un Worker de Cloudflare que sirve la app y guarda lo capturado, para que el equipo la use desde cualquier red, con HTTPS.

- **Mismo contrato que el servidor local** (`packages/shared/src/api.ts`) y las mismas reglas de mezcla: ids del cliente, enviar dos veces no duplica, gana la edición más reciente, la asistencia se junta.
- **D1** (base de datos) para el equipo, las sesiones (asistencia y cierre) y las entradas.
- **R2** (almacenamiento) para las fotos.
- **La app** (`packages/app`) como archivos estáticos, con service worker: se abre aunque no haya señal y se puede instalar en el teléfono.

## Las dos claves

| Clave | Quién la tiene | Qué permite |
|---|---|---|
| **Captura** (`CAPTURE_KEY`) | Todo el equipo: va en el QR del taller | Capturar, ver y editar entradas; registrar asistencia; agregarse a la lista |
| **Edición** (`EDIT_KEY`) | Solo quienes arman la bitácora | Lo anterior, más la vista de computadora: editar el equipo, generar la bitácora y ver la página del QR |

- Son **secretos del Worker**: viven en Cloudflare, nunca en el repositorio. Para el simulador local viven en `packages/worker/.dev.vars` (ignorado por git).
- Deben medir al menos 16 caracteres y ser distintas; si no, el Worker no deja entrar a nadie. `npm run nube:clave` genera una de 24 caracteres al azar.
- La clave llega al teléfono **una sola vez**, por el enlace del QR (`https://…/#k=CLAVE`). La app la guarda en el teléfono y la quita de la barra de direcciones. Lo que va después de `#` no viaja al servidor, así que tampoco queda en registros.
- Para la computadora: `https://…/#/escritorio?k=CLAVE_DE_EDICION` (una vez; después basta `https://…/#/escritorio`).
- **Si una clave se filtra**, se cambia con `npx wrangler secret put` (paso 5) y, si era la de captura, se imprime el QR nuevo. Los teléfonos con la clave vieja verán "Clave incorrecta: vuelve a escanear el QR"; lo que tengan sin enviar se queda en el teléfono y se manda al escanear el nuevo.

## Probar en esta computadora (sin cuenta)

```
npm run nube:local
```

Compila la app, aplica las migraciones a una base local y arranca el Worker en el simulador de wrangler en `http://localhost:8787`. La primera vez crea `packages/worker/.dev.vars` con dos claves al azar y muestra los enlaces de captura y de computadora. Para detener: `Ctrl+C`.

- Los datos del simulador quedan en `packages/worker/.wrangler/` (ignorado por git). Para empezar de cero, borra esa carpeta.
- Para cargar ahí lo de `data/`: `npm run nube:subir-datos -- --local` (pide la `EDIT_KEY` de `.dev.vars`).
- `npm run nube:local -- --red` escucha también en la red local, para abrirlo desde un celular. Por `http://` el celular no instala el service worker (en `localhost` sí).

## Publicar en Cloudflare

Se hace desde la laptop, en una terminal en la carpeta del repositorio. Los pasos 1 a 5 son **una sola vez**.

### 1. Iniciar sesión

```
cd packages/worker
npx wrangler login
```

Se abre el navegador para autorizar a wrangler en tu cuenta de Cloudflare. Revisa con `npx wrangler whoami`.

### 2. Crear la base de datos (D1)

```
npx wrangler d1 create vortex-wake
```

Si pregunta si quieres agregarla a la configuración (`wrangler.jsonc`), responde **que no**: el Worker la encuentra por su nombre (ver "Identificadores" abajo).

### 3. Activar R2 y crear el bucket de las fotos

R2 se activa una vez en el panel de Cloudflare: **R2 Object Storage → Activar** (o "Purchase R2 Plan"). Pide registrar un método de pago aunque el uso quede dentro de lo gratuito. Después:

```
npx wrangler r2 bucket create vortex-wake-fotos
```

Si R2 no se puede activar, el Worker no tiene dónde guardar fotos: ver "Si R2 no se puede activar".

### 4. Publicar

Desde la raíz del repositorio:

```
cd ../..
npm run nube:publicar
```

Compila la app, aplica a la base de la nube las migraciones que falten (pregunta antes: responde que sí) y publica el Worker. La primera vez puede pedir que elijas un subdominio de `workers.dev`. Al terminar muestra la dirección: `https://vortex-wake.<tu-subdominio>.workers.dev`.

En este momento la app ya abre, pero todo lo de `/api` responde "el servicio todavía no está configurado" hasta el paso 5. Es a propósito: sin claves no entra nadie.

### 5. Definir las dos claves

```
npm run nube:clave        (copia la clave de captura en tu gestor de contraseñas)
npm run nube:clave        (otra, para la clave de edición)
cd packages/worker
npx wrangler secret put CAPTURE_KEY      (pega la de captura cuando la pida)
npx wrangler secret put EDIT_KEY         (pega la de edición)
```

Las claves no quedan en el historial de la terminal porque wrangler las pide sin mostrarlas.

### 6. Subir lo del taller

```
cd ../..
npm run nube:subir-datos -- --url https://vortex-wake.<tu-subdominio>.workers.dev
```

Pide la clave de edición (sin mostrarla) y sube de `data/`: el equipo (`data/team.json`), las fotos, la asistencia, los cierres y las entradas. Se puede correr las veces que sea: no duplica nada, y si una entrada se editó después en la nube, se queda la versión de la nube. Si en la nube hay integrantes que no están en `data/team.json` (alguien se agregó desde su teléfono), se conservan.

- `--simular`: solo revisa los archivos y la clave, no manda nada.
- `--datos <carpeta>`: otra carpeta de datos (por defecto `data/`).
- Para no escribir la clave: `$env:VW_CLAVE_EDICION = "…"` en PowerShell antes del comando (y ciérralo al terminar).

`data/team.json` **no se sube al repositorio** (`data/` está en `.gitignore`); el equipo viaja a la nube solo por este comando o desde la vista de computadora.

### 7. Imprimir el QR

En la computadora abre `https://vortex-wake.<tu-subdominio>.workers.dev/#/escritorio?k=CLAVE_DE_EDICION` y toca **QR del taller**. Esa página muestra el QR de captura (con la clave de captura, nunca la de edición) y se puede imprimir.

### Publicar una versión nueva

```
npm run nube:publicar
```

Los teléfonos reciben la versión nueva solos: al abrir la app se pide primero a la red; si la app ya estaba abierta, aparece "Hay una versión nueva de la app" con un botón para actualizar, y se actualiza sola al volver a la pestaña. La versión se ve al pie de la pantalla principal.

## Qué puede fallar

| Síntoma | Causa y arreglo |
|---|---|
| `wrangler` dice que no hay sesión | Paso 1 (`npx wrangler login`). |
| `Couldn't find a D1 DB named 'vortex-wake'` | Falta el paso 2, o se inició sesión en otra cuenta (`npx wrangler whoami`). |
| `R2 is not enabled` o `bucket not found` al publicar | Falta activar R2 en el panel o crear el bucket (paso 3). |
| La app dice "el servicio todavía no está configurado" | Faltan las claves (paso 5), son iguales o miden menos de 16 caracteres. Ver `npx wrangler tail`. |
| "Clave incorrecta: vuelve a escanear el QR" | La clave cambió: escanear el QR nuevo. |
| `wrangler` escribió un `database_id` en `wrangler.jsonc` | No hace falta guardarlo: descarta ese cambio (`git checkout packages/worker/wrangler.jsonc`). |
| Errores del Worker | `cd packages/worker` y `npx wrangler tail` muestra en vivo lo que pasa (no se guardan registros). |

## Identificadores de la base y del bucket

El repositorio es público y no debe quedar atado a la cuenta de nadie. Por eso `wrangler.jsonc` **no trae ids**: solo los nombres (`vortex-wake` para D1 y `vortex-wake-fotos` para R2). Wrangler busca esos nombres en la cuenta con la que se inició sesión, al migrar y al publicar. Otro equipo que use el repositorio solo repite los pasos en su cuenta. Si se quieren otros nombres, se cambian en `wrangler.jsonc` y en los comandos de los pasos 2 y 3.

## Si R2 no se puede activar

Las fotos están detrás de una interfaz pequeña, `PhotoStore` (`src/photos.ts`: `has`, `put`, `get`). Hoy la implementa `R2PhotoStore`. Para usar otro almacén (por ejemplo D1, partiendo cada foto en pedazos de menos de 2 MB, o un servicio externo) basta con escribir otra clase con esos tres métodos y usarla en `photoStore()` de `src/index.ts`; nada más cambia. Esa alternativa **no está implementada**. Mientras tanto, sin R2 el Worker no se puede publicar tal cual (la configuración pide el bucket).

## Seguridad y privacidad

Hay fotos y nombres de integrantes, algunos posiblemente menores de edad.

- **Nada sin clave:** sin una clave válida, toda ruta de `/api` responde lo mismo (401), exista o no; no hay listados. La app en sí (código, igual que el del repositorio) se sirve sin clave para poder abrirla, pero no trae datos del equipo.
- **Fotos:** solo con clave (en el encabezado o, porque se piden desde `<img>`, en `?k=`), con caché privada (`private`: solo en el navegador de quien la pidió).
- **Plantilla:** solo con la clave de edición, por `/api/template`.
- **Claves:** comparación en tiempo constante (SHA-256 de cada clave, siempre las dos).
- **Límites:** 1 MB por petición JSON, 15 MB por foto (las del teléfono pesan 0.3–0.8 MB); solo JPEG; todo lo que entra se valida con los validadores de `@vortex-wake/shared`.
- **No indexable:** `robots.txt` prohíbe todo, `X-Robots-Tag: noindex` en todas las respuestas y `<meta name="robots">` en la página.
- **Cabeceras:** política de contenido estricta (solo código propio, sin nada en línea), `Referrer-Policy: no-referrer`, sin marcos (`frame-ancestors 'none'`), `nosniff`, HSTS.
- **Sin registros guardados** en Cloudflare (`observability` apagado).

Lo que queda por cuidar:

- Quien tenga el QR puede ver y editar todo lo capturado (así se diseñó): no lo publiques fuera del taller.
- La clave de captura va en `?k=` en las direcciones de las fotos: queda en la caché del navegador del teléfono (no en el historial ni en la barra de direcciones).
- No hay límite de peticiones por minuto: adivinar una clave de 24 caracteres al azar no es posible en la práctica, pero alguien con la clave de captura sí podría llenar el bucket de fotos.
- Un teléfono perdido tiene la clave guardada y lo capturado en el navegador: si pasa, cambia la clave de captura.

## Costos (plan gratuito)

Para un equipo de unas 10 personas, con 3 o 4 en el taller y decenas de fotos por sesión, todo cabe en lo gratuito:

| Servicio | Gratis | Uso esperado |
|---|---|---|
| Workers | 100,000 peticiones al día; 10 ms de CPU por petición | Cada teléfono abierto pide el estado cada ~8 s (unas 450 por hora). 4 teléfonos 4 horas: ~7,000 al día, más las fotos. |
| D1 | 5 GB; 5 millones de filas leídas y 100,000 escritas al día | Cada consulta del día lee solo las entradas de ese día. La vista de computadora lee todas cada ~16 s: con 2,000 entradas y 4 horas abierta serían ~1.8 millones de filas. Ciérrala cuando no se use. |
| R2 | 10 GB; 1 millón de escrituras y 10 millones de lecturas al mes; sin costo por descarga | ~0.5 MB por foto: 50 fotos por sesión, 3 sesiones por semana, 40 semanas ≈ 3 GB por temporada. |

Si se pasa de lo gratuito en Workers o D1 (plan gratuito), Cloudflare no cobra: responde con error hasta el día siguiente. **R2 es distinto:** como tiene un método de pago registrado, lo que pase de lo gratuito sí se cobra (centavos por GB al mes). Revisa el uso en el panel de Cloudflare (R2 → Métricas) de vez en cuando; se puede poner una alerta de facturación.

## Archivos

```
wrangler.jsonc          configuración (sin ids de cuenta ni claves)
migrations/             esquema de D1, versionado (0001_init.sql, ...)
src/index.ts            rutas, permisos y archivos estáticos
src/store.ts            D1: equipo, sesiones y entradas (con las reglas de shared)
src/photos.ts           PhotoStore y R2PhotoStore
src/auth.ts             las dos claves, comparación en tiempo constante
src/http.ts             límites de tamaño y cabeceras de seguridad
scripts/build.ts        arma dist/public (app compilada + plantilla en private/)
scripts/local.ts        npm run nube:local
scripts/upload-data.ts  npm run nube:subir-datos
scripts/keys.ts         npm run nube:clave
scripts/harness.ts      el Worker en el entorno local, para las pruebas
test/                   pruebas (corren en el entorno local de Workers)
```

Para agregar una tabla o columna: un archivo nuevo en `migrations/` (`0002_….sql`); `npm run nube:publicar` lo aplica a la nube y `npm run nube:local` al simulador. Nunca se edita una migración ya aplicada.

## Pruebas

- `npm test` incluye `test/worker.test.ts` (contrato, mezcla con escrituras simultáneas, permisos de cada clave, rechazo sin clave, límites de tamaño, cabeceras) y `test/upload-data.test.ts` (subida con datos ficticios, idempotente). Corren contra el Worker en el entorno local de Workers (workerd con D1 y R2 locales en memoria), con `createTestHarness` de wrangler.
- `npm run e2e:nube`: la prueba de punta a punta de la app contra el Worker: dos teléfonos, sin conexión y reconexión, fotos, generar el `.pptx`, permisos de cada clave, página del QR, abrir la app sin conexión (service worker) y que una versión nueva llegue. Capturas en `%TEMP%\vortex-wake-worker\e2e`.

## Dependencias

| Paquete | Para qué | Por qué |
|---|---|---|
| `wrangler` (desarrollo) | Simulador local, migraciones, publicar, entorno de pruebas | Es la herramienta oficial; trae el simulador (workerd y miniflare). |
| `@cloudflare/workers-types` (desarrollo) | Tipos de TypeScript de D1, R2 y el Worker | Solo tipos; no va en lo publicado. |
| `qrcode-generator` | Dibujar el QR de la página del QR | El mismo que usa el servidor local; pequeño y sin dependencias. |
| `@vortex-wake/shared` | Contrato, validaciones y reglas de mezcla | Del repositorio. |
