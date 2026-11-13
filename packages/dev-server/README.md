# @vortex-wake/dev-server

Servidor local para el taller: sirve la app (ya compilada) en la red local y guarda lo capturado en `data/` como archivos legibles. Implementa el contrato HTTP de `packages/shared/src/api.ts`; el Worker de Cloudflare (`packages/worker`) implementa el mismo contrato en la nube. Para pasar lo de `data/` a la nube: `npm run nube:subir-datos` (ver `packages/worker/README.md`).

## Uso

Desde la raíz:

```
npm run taller      # compila la app, arranca el servidor y abre la página del QR
npm run servidor    # solo arranca el servidor (la app ya debe estar compilada)
```

Opciones: `--port 4321` (por defecto), `--open` (abre `http://localhost:4321/qr`). Variables: `VW_DATA_DIR` (carpeta de datos), `VW_TEAM_KEY` (clave del equipo), `PORT`.

Al arrancar muestra la dirección para los celulares (con la clave) y un QR en la terminal. La página `http://localhost:4321/qr` muestra el QR grande y solo se abre desde la misma laptop (desde la red responde 403, porque trae la clave).

## Datos

```
data/team.json                 equipo: integrantes y robots (si no existe, se usa examples/team-ejemplo.json)
data/server.json               clave del equipo (se crea sola la primera vez)
data/sessions/AAAA-MM-DD.json  asistencia y cierre de cada día
data/entries/<id>.json         una micro-entrada por archivo
data/photos/<id>.jpg           fotos ya reducidas (lado mayor 1600 px)
data/tasks/<id>.json           pendientes entre sesiones (se crea sola)
```

`data/` está en `.gitignore`: nunca se sube. Para respaldar, basta copiar la carpeta. Para agregar integrantes se puede editar `data/team.json` (con el servidor apagado) o usar "¿No estás en la lista?" en la app o el panel "Equipo" de la vista de computadora.

Acceso: la clave va en el enlace del QR (`?k=`). La app la guarda y la manda en el encabezado `x-team-key`; las fotos y la plantilla aceptan `?k=` porque se piden desde `<img>` o descargas. Para cambiar la clave, borra `data/server.json` (o usa `VW_TEAM_KEY`) y vuelve a imprimir el QR.

## Dependencias

| Paquete | Para qué | Por qué este |
|---|---|---|
| `qrcode-generator` | Dibujar el QR (SVG en la página y texto en la terminal) | Pequeño, sin dependencias, sin acceso a red. Escribir un codificador QR a mano no vale la pena. |

Todo lo demás es Node (`http`, `fs`, `os`). Sin frameworks.

## Pruebas

`test/server.test.ts`: clave, equipo de ejemplo, entradas idempotentes y "gana la más reciente", validación, fotos inmutables, asistencia y cierre de dos teléfonos, alta de integrantes, plantilla y QR.
