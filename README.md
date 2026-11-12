# Vortex Wake

Bitácora de ingeniería para equipos de VEX V5. El equipo registra desde el celular lo que hace en el taller (fotos, notas, pruebas, decisiones), y la herramienta arma las páginas de la bitácora digital sobre una plantilla alineada con la rúbrica de jueceo.

El nombre viene de la estela (*wake*) que deja un vórtice al pasar: la bitácora es la estela del equipo.

**Estado:** en construcción. Por ahora el repositorio contiene la plantilla; la herramienta todavía no existe.

## Cómo va a funcionar

- **En el taller:** se escanea un código QR, se abre la sesión del día y cada quien registra micro-entradas: fotos, notas, resultados de pruebas, decisiones, enlaces. Cada una lleva autor, sección y subsistema.
- **En la computadora:** quienes arman la bitácora revisan lo capturado, lo acomodan en páginas y generan el archivo de PowerPoint. La mayoría de los campos se llena sola y después se ajusta a mano.
- **La bitácora** se organiza por secciones (Mecánica, Programación, Cableado, Estrategia) y, dentro de cada una, en orden cronológico.

## La plantilla

`template/` contiene la plantilla de la bitácora: la oficial de VEX V5 (v5.1) más páginas alineadas con los 16 criterios de la rúbrica.

- `V5_Engineering_Notebook_Template_EN.pptx`: versión en inglés.
- `V5_Engineering_Notebook_Template_ES.pptx`: versión en español, generada con `tools/translate-template/`.

Se puede usar sola, sin la herramienta: basta con abrirla en PowerPoint o subirla a Google Slides.

## Estructura prevista

```
/
├─ packages/
│  ├─ shared/       modelo de datos y validaciones
│  ├─ generator/    genera la bitácora .pptx sobre la plantilla
│  ├─ app/          página de captura (celular) y de revisión (computadora)
│  └─ worker/       servicio en Cloudflare (entradas y fotos)
├─ tools/
│  ├─ translate-template/   traduce la plantilla al español
│  └─ import/               reconstruye la cronología a partir de fotos, commits y chats
└─ template/        plantilla de la bitácora
```

## Reglas

- La herramienta organiza, fecha y da formato. **No redacta las entradas:** el contenido de la bitácora lo escribe el equipo.
- Las entradas y las fotos de un equipo nunca se suben a este repositorio.
- Interfaz y documentos en español; nombres de archivos e identificadores en inglés.
