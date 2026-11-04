# StereoVision Studio 3D

Aplicación web tipo *Studio* para **importar, calibrar y visualizar** imágenes anaglifo rojo-cian, imágenes estereoscópicas Side-by-Side (SBS) y videos SBS 3D, con un **modo VR para celular** compatible con gafas tipo Cardboard, y un **Editor estéreo** para alinear, recortar, igualar y exportar pares de fotografías 3D.

- **Autora:** Claudia Melissa Manzano Luna, Instituto Tecnológico de Pachuca, 2026
- **Sitio publicado (HTTPS):** https://melissamanzano.github.io/StereoVision-Studio-3D/
- **Repositorio:** https://github.com/melissaManzano/StereoVision-Studio-3D
- **Tecnologías:** HTML, CSS y JavaScript con módulos ES, Three.js r180 (importmap desde jsDelivr) y Web Workers, sin frameworks, backend ni base de datos. El procesamiento de imagen (rasgos, RANSAC, histogramas, TIFF, GIF, ZIP) está escrito desde cero, sin librerías.

---

## 1. Problema que resuelve

El contenido estereoscópico llega en formatos distintos y cada uno exige una forma diferente de mirarlo. Sin una herramienta adecuada, una imagen SBS se ve como dos fotos repetidas, un video SBS no se puede calibrar para unas gafas concretas y un anaglifo pierde profundidad si su brillo o contraste no son adecuados. StereoVision Studio 3D reúne en un solo lugar la importación local, la validación, la calibración en tiempo real y la visualización final (pantalla o gafas), sin modificar nunca el archivo original y sin enviarlo a ningún servidor.

| Modalidad | Quién la utiliza | Para qué |
|---|---|---|
| **Anaglifo** | Docentes, estudiantes o público con lentes rojo-cian de cartón | Ver profundidad en cualquier monitor o proyector, sin hardware especial |
| **Imagen SBS** | Personas con gafas VR para celular, fotógrafos estéreo | Revisar pares estereoscópicos y ajustar su alineación antes de verlos en las gafas |
| **Video SBS** | Usuarios de visores Cardboard, creadores de contenido 3D | Reproducir video 3D sincronizado y ajustar la separación mientras se reproduce |
| **Editor estéreo** | Fotógrafos estéreo, docentes que preparan material | Convertir dos fotos (o un SBS/MPO) en un par corregido y exportarlo como anaglifo, SBS, entrelazado o wiggle |

### Diferencia entre anaglifo y SBS

- **Anaglifo:** las dos perspectivas ya vienen **mezcladas en una sola imagen** mediante color: el canal rojo lleva la vista del ojo izquierdo y el cian (verde y azul) la del derecho. Los lentes filtran cada color hacia su ojo. El Studio **no separa canales**: muestra la imagen completa y permite ajustar zoom, brillo y contraste.
- **SBS (lado a lado):** las dos perspectivas están **una junto a la otra** en el mismo archivo: la mitad izquierda es el ojo izquierdo y la mitad derecha, el derecho. El Studio recorta cada mitad (coordenadas UV) y la presenta en la región de pantalla de su ojo, que es lo que necesitan las gafas VR.

### Alcance

**Sí hace**
- Importar JPG, PNG y WebP (anaglifo e imagen SBS) y MP4 (video SBS) desde el almacenamiento local, con selector de archivos o arrastrando el archivo.
- Validar formato, compatibilidad con el módulo y decodificación, con mensajes que indican qué ocurrió y cómo continuar.
- Calibrar en tiempo real: zoom, brillo y contraste (anaglifo); desplazamiento horizontal relativo, alineación vertical, escala, intercambio de ojos y disposición Full/Half SBS (SBS y video).
- Reproducir video SBS con reproducir/pausar, búsqueda, ±10 s, volumen, silencio, tiempo actual y duración.
- Modo VR para celular con dos regiones (una por ojo), aviso de orientación vertical y salida táctil.
- Exportar los valores de calibración a JSON como evidencia.
- **Editor estéreo** (sección 6): alineación automática y manual, recorte, ventana estéreo, color, 12 modos de salida, exportación PNG/TIFF/JPEG, wiggle GIF, lotes e historial.

**Queda fuera del alcance**
- Generar estereoscopía a partir de contenido 2D (conversión 2D→3D) o separar un anaglifo en sus dos vistas.
- Detectar automáticamente si las dos mitades de un SBS son realmente estereoscópicas (solo se advierte si la proporción no parece SBS).
- Modificar los archivos originales (el editor siempre exporta archivos nuevos); transcodificar video; corrección de distorsión de lentes; seguimiento de la cabeza o WebXR.
- Emparejado de carpetas por similitud visual (solo se empareja por nombre de archivo).
- Registro de usuarios, servidor, base de datos o envío de archivos a servicios externos (RN-19).

---

## 2. Material de prueba

En `assets/media/` se incluyen tres muestras ligeras y **originales**, renderizadas para este proyecto con Three.js mediante `THREE.StereoCamera`. Son dos cámaras reales separadas, así que cada ojo tiene una perspectiva distinta; no es una imagen 2D duplicada.

| Archivo | Módulo | Contenido | Tamaño |
|---|---|---|---|
| `muestra-anaglifo.jpg` | Anaglifo | 1600 × 900, anaglifo de color medio (rojo = luminancia del ojo izquierdo; verde y azul = ojo derecho) | 62 KB |
| `muestra-sbs.jpg` | Imagen SBS | 2560 × 720, Full SBS (dos vistas de 1280 × 720) con marcas **L** y **R** en cada mitad | 76 KB |
| `muestra-video-sbs.mp4` | Video SBS | 1920 × 540, Full SBS, H.264 + AAC, ~9 s, con marcas L/R, contador de segundos y un tono suave para probar el volumen | 674 KB |

Las marcas **L/R** permiten comprobar a simple vista la correspondencia izquierda/derecha y el intercambio de ojos. El botón **Abrir muestra** carga la muestra del módulo activo **pasando por la misma validación** que un archivo propio. Para la evaluación también se puede importar cualquier otro archivo: el visor no depende de material fijo.

> Antes de la evaluación, comprueba que `muestra-video-sbs.mp4` (o tu propio MP4) se reproduce en el navegador del teléfono que usarás.

---

## 3. Estructura y responsabilidades

```text
StereoVision-Studio-3D/
├── index.html                  Estructura del Studio (sin lógica de aplicación)
├── README.md
├── package.json                Solo define `npm test` (el sitio no necesita Node)
├── .nojekyll                   GitHub Pages sirve los archivos tal cual
├── tests/                      Pruebas de Node: alineación, anaglifos, formatos
├── assets/
│   ├── css/
│   │   ├── tokens.css          Colores, tipografía, espaciado y tiempos (tokens)
│   │   ├── base.css            Reglas base: foco visible, selección, movimiento reducido
│   │   └── studio.css          Diseño del Studio, responsivo y modo VR
│   ├── img/favicon.svg
│   ├── media/                  Muestras ligeras (anaglifo, SBS, video SBS)
│   └── js/
│       ├── main.js             Inicialización: crea los módulos y conecta eventos
│       ├── processing/         Procesamiento de imagen puro (sin DOM): worker, navegador y Node
│       │   ├── image.js        Grises, desenfoque, muestreo bilineal, aleatorio con semilla
│       │   ├── features.js     FAST-9 + Harris + BRIEF, emparejado Hamming
│       │   ├── align.js        Homografías, RANSAC estéreo, recorte y ventana automáticos
│       │   ├── anaglyph.js     Matrices de anaglifo (color, grises, medio color, Dubois)
│       │   ├── color.js        Igualación por histogramas (LUT)
│       │   ├── split.js        Separar imagen única y detectar SBS / arriba-abajo
│       │   ├── mpo.js          Lectura de MPO (índice MPF)
│       │   ├── pairing.js      Emparejado de carpetas por nombre
│       │   └── encoders.js     TIFF, GIF animado (LZW) y ZIP
│       ├── workers/
│       │   └── stereo-worker.js  Operaciones pesadas fuera del hilo de la interfaz
│       └── modules/
│           ├── state.js        Estados del sistema, definición de módulos y store
│           ├── importer.js     Importación local, validación y decodificación
│           ├── session.js      Archivo activo: carga, sustitución y liberación de recursos
│           ├── stage.js        Renderer Three.js único; vista simple o dividida por ojo
│           ├── anaglyph.js     Visor anaglifo: zoom, brillo y contraste en shader
│           ├── sbs.js          Par estereoscópico (recorte UV) e imagen SBS
│           ├── video.js        Video SBS: VideoTexture compartida y transporte
│           ├── calibration.js  Panel de calibración por esquema, restablecer
│           ├── vr.js           Modo Viewer/VR, pantalla completa, orientación
│           ├── ui.js           Presentación: estados, mensajes, habilitar controles
│           ├── recents.js      Historial de cargas: referencias y ajustes por módulo
│           ├── lens.js         Predistorsión de lente Cardboard (shader compartido)
│           └── editor/
│               ├── pipeline.js     GPU: deformación, recorte, color y modos de salida (shaders)
│               ├── editor-view.js  Vista previa, historial, arrastre y teclado
│               ├── editor-panel.js Controles del flujo 1 a 7
│               ├── recipe.js       Receta de edición, modos de salida e historial
│               ├── operations.js   Operaciones automáticas compartidas (vista y lote)
│               ├── sources.js      Carga de par, imagen única y MPO
│               ├── library.js      Entrada de carpeta, emparejado y lotes
│               ├── exporter.js     PNG, TIFF, JPEG, wiggle GIF, descarga
│               └── worker-client.js  Promesas sobre el Web Worker
```

| Módulo | Responsabilidad |
|---|---|
| `main.js` | Solo inicializa: crea stage, store, calibración, sesión y VR, y enlaza los botones con sus acciones. |
| `state.js` | Define los estados (`empty`, `loading`, `ready`, `playing`, `paused`, `error`, más el indicador `vr`) y los tres módulos (tipo de archivo, render simple/dividido, si admite VR, muestra). |
| `importer.js` | Comprueba la extensión y el MIME, rechaza los formatos no admitidos o que no corresponden al módulo, decodifica (`image.decode()` / `loadeddata`) y devuelve el contenido con su función `release()`. |
| `session.js` | Garantiza **un solo archivo activo**: pausa y libera el anterior (texturas, geometrías, `URL.revokeObjectURL`, `<video>`), restablece la calibración y descarta cargas superadas por otra más reciente. |
| `stage.js` | Un `WebGLRenderer` con cámara ortográfica; en modo dividido usa `setViewport`/`setScissor` para dibujar una región por ojo. Dibuja bajo demanda y anima solo mientras el video se reproduce. |
| `anaglyph.js` | Plano a pantalla completa con `ShaderMaterial` (brillo y contraste) y zoom que conserva la proporción. |
| `sbs.js` | Dos planos que **comparten una textura** y recortan su mitad por UV. Aplica desplazamiento, alineación, escala e intercambio (reasigna geometrías, no solo etiquetas) y detecta Full/Half SBS. |
| `video.js` | `VideoTexture` única para ambos ojos (sincronía garantizada), `playsinline` y transporte completo; los eventos se desenlazan con `AbortController` al liberar. |
| `calibration.js` | Genera los controles de cada módulo a partir de un esquema; cada control y su indicador numérico reflejan el mismo valor; `reset()` vuelve a los valores iniciales. |
| `vr.js` | Entra y sale del modo VR, intenta pantalla completa, bloqueo horizontal y `wakeLock`, y si no se puede sigue funcionando dentro de la página. Muestra el aviso de orientación vertical. |
| `ui.js` | Refleja el estado en la interfaz: botones habilitados o deshabilitados, metadatos del archivo, memoria GPU, mensajes y avisos de error. |

### Estados del sistema

```text
            elegir módulo              importar                 decodificado
[sin archivo] ──────────► [sin archivo] ───────► [cargando] ──────────────► [listo]
                                                      │                       │ ▶ reproducir (video)
                                                      │ error                 ▼
                                                      ▼               [reproduciendo] ⇄ [en pausa]
                                     [error] (si no había contenido)
                                     o se conserva el contenido anterior + aviso
Cualquier estado con contenido SBS ── Modo VR ──► mismo estado "en VR" ── Salir ──► Studio
```

- Al **cambiar de módulo** se cierra el archivo anterior y se liberan sus recursos (no quedan videos reproduciéndose ocultos).
- Durante **cargando** se bloquean el cambio de módulo y una nueva importación.
- El panel **Memoria GPU** muestra las texturas y geometrías vivas en el renderer; tras cerrar un archivo vuelve a `0 texturas, 0 geometrías`.

---

## 4. Ejecución local (HTTP)

Los módulos ES y el importmap **no funcionan desde `file://`**. Usa cualquiera de estas opciones desde la carpeta del proyecto:

- **VS Code:** extensión *Live Server* → *Open with Live Server*.
- **Python:** `python -m http.server 5500` → abre `http://localhost:5500/`.
- **Node:** `npx serve .` → abre la URL que indique.

Se necesita conexión a Internet para cargar Three.js (jsDelivr) y la fuente Mona Sans (Google Fonts).

**Probar en el teléfono en la misma red Wi-Fi:** `python -m http.server 5500 --bind 0.0.0.0` y abre `http://<IP-de-tu-PC>:5500/`. La pantalla completa y el bloqueo de orientación pueden requerir HTTPS; en GitHub Pages ya está disponible.

---

## 5. Uso

1. **Elige un módulo** en la barra superior: Anaglifo, Imagen SBS o Video SBS (RN-01). Hasta entonces, la importación y los ajustes están deshabilitados.
2. **Importa** con *Importar archivo*, arrastra el archivo al visor o usa *Abrir muestra*.
3. **Ajusta** en el panel *Ajustes*. Cada cambio se ve al instante y el valor aparece junto a su control. *Restablecer* vuelve a los valores iniciales.
4. **Historial:** el botón *Historial* del panel *Contenido* lista las últimas 5 cargas del módulo activo, con la hora y un resumen de sus ajustes. Al elegir una, se vuelve a abrir con esos ajustes (en video, en el mismo segundo y en pausa; en el editor, con su receta completa). Solo guarda la referencia al archivo y los ajustes, nunca la imagen cargada, y se pierde al recargar la página. Cambiar de módulo sigue cerrando el archivo actual (RN-05).
5. **Video:** reproduce siempre con un toque o clic (los navegadores móviles lo exigen) y se repite en bucle hasta que lo pauses. Puedes ajustar el desplazamiento y la escala mientras el video avanza.
6. **Modo VR** (Imagen SBS y Video SBS): gira el teléfono a horizontal y colócalo en las gafas. En video, tocar la pantalla reproduce o pausa. *Salir de VR* (botón superior) o `Esc` devuelven al Studio con el mismo archivo y los mismos ajustes.

| Control | Módulo | Rango | Inicial |
|---|---|---|---|
| Zoom | Anaglifo | 50 a 300 % | 100 % |
| Brillo | Anaglifo | −50 a +50 % | 0 % |
| Contraste | Anaglifo | 50 a 150 % | 100 % |
| Desplazamiento horizontal | SBS, video | −40 a +40 px (cada ojo se mueve la mitad, en sentidos opuestos) | 0 px |
| Alineación vertical | SBS, video | −30 a +30 px | 0 px |
| Escala | SBS, video | 50 a 200 % | 100 % |
| Intercambiar ojos | SBS, video | sí / no | no |
| Corrección de lente Cardboard | SBS, video | sí / no; distorsión 0 a 150 %; corrección cromática | no; 100 %; sí |
| Disposición SBS | SBS, video | Full / Half | detectada al importar (proporción ≥ 2,4:1 → Full) |

El desplazamiento horizontal está **limitado a ±40 px** a propósito: más separación obligaría a los ojos a divergir y produciría visión doble.

### Confort y seguridad

Empieza con los valores iniciales y haz cambios pequeños. **Detén la prueba de inmediato** si aparece mareo, fatiga ocular o visión doble persistente. Las sesiones con gafas deben ser cortas.

---

## 6. Editor estéreo

Es el cuarto módulo del Studio. Toma un par de fotografías y les aplica en la GPU una **receta** de correcciones, con vista previa en vivo. El original nunca se modifica: el resultado se exporta como un archivo nuevo. El panel sigue el orden de trabajo recomendado:

**Cargar par → 1 Alineación automática → ajuste manual → 2 Recorte → 3 Profundidad y ventana → 4 Color → 5 Imagen → 6 Modo de salida → 7 Exportar.**

### Funciones por fase

| Fase | Función | Estado | Dónde |
|---|---|---|---|
| 1 | Abrir par izquierdo/derecho (dos entradas) | Hecho | `sources.loadPair` |
| 1 | Abrir imagen única lado a lado (paralelo o cruzado) o arriba/abajo, con detección automática | Hecho | `sources.loadSingle`, `split.js` |
| 1 | Formato MPO (cámaras 3D) | Hecho | `mpo.js` |
| 1 | Intercambiar izquierda/derecha | Hecho | receta `swap` |
| 1 | Anaglifo a color y en grises, exportación PNG | Hecho | `anaglyph.js`, `exporter.js` |
| 2 | Alineación automática (rasgos, emparejado y RANSAC) con informe | Hecho | `features.js`, `align.js`, worker |
| 2 | Alineación manual con arrastre y flechas, con vista previa en vivo | Hecho | `editor-view.js` |
| 2 | Corrección vertical y de rotación independientes | Hecho | panel, paso 1 |
| 2 | Corrección de perspectiva (keystone horizontal y vertical) | Hecho | `rightHomography` |
| 2 | Recorte sincronizado y recorte automático de bordes vacíos | Hecho | `autoCropMargins` |
| 3 | Paralaje horizontal | Hecho | receta `align.parallax` |
| 3 | Montaje en ventana automático | Hecho | `windowParallax` |
| 3 | Ventana flotante, manual y automática | Hecho | `floatingWindow`, shader |
| 3 | Igualación automática de color por histogramas | Hecho | `color.js` |
| 3 | Brillo, contraste, gamma, saturación y nitidez | Hecho | shader de ojo |
| 3 | Redimensionar (tamaño de exportación) y rotar el par (ajuste fino y 90°) | Hecho | receta `resize`, `pairRotation`, `orientation` |
| 3 | Medio color, Dubois, ámbar/azul y verde/magenta | Hecho | `anaglyph.js` |
| 3 | Lado a lado paralelo y cruzado, arriba/abajo, entrelazado por filas y por columnas | Hecho | shader de composición |
| Extra | Salida Cardboard: lado a lado con predistorsión de barril y corrección cromática, exportable y aplicada en VR | Hecho | `lens.js` |
| 4 | Wiggle: vista previa alternada y exportación en GIF animado | Hecho | `encodeGIF` |
| 4 | Emparejado automático de carpeta por nombre | Hecho | `pairing.js` |
| 4 | Procesamiento por lotes con ZIP e informe | Hecho | `library.runBatch` |
| 4 | Historial deshacer/rehacer (Ctrl+Z, Ctrl+Y) | Hecho | `createHistory` |
| 4 | Exportación PNG y TIFF por defecto, JPEG con advertencia | Hecho | `exporter.js` |
| Opcional | Emparejado por similitud de rasgos | No incluido | solo por nombre |

### Algoritmos

| Función | Archivo | Explicación breve |
|---|---|---|
| `detectFeatures` | `features.js` | **FAST-9**: un píxel es esquina si 9 vecinos contiguos de un círculo de radio 3 son todos más claros o todos más oscuros que él por un umbral. Cada esquina se puntúa con **Harris** (det − 0,04·traza² de la matriz de gradientes en una ventana de 7×7) y se reparten en una cuadrícula de 12×12 para cubrir toda la imagen. Si salen menos de 300, se repite con un umbral más bajo. |
| `describeFeatures` | `features.js` | **BRIEF** de 256 bits: comparaciones de intensidad entre pares fijos de puntos dentro de un parche suavizado de 31×31. No calcula orientación, porque la rotación entre vistas estéreo es pequeña. |
| `matchFeatures` | `features.js` | Fuerza bruta con **distancia de Hamming** (popcount), prueba de razón de Lowe (0,8), verificación cruzada y un límite de desplazamiento vertical del 10 % de la altura. |
| `estimateStereoAlignment` | `align.js` | **RANSAC** adaptado a estéreo. No se ajusta x, porque la disparidad depende de la profundidad; solo se ajusta y. Modelo lineal yL = a·xR + b·yR + t, con a = s·sen θ y b = s·cos θ. Toma muestras mínimas de 3 puntos, cuenta como inliers los de residuo < 1,5 px y hace un reajuste final por mínimos cuadrados. |
| `rightHomography` | `align.js` | Matriz 3×3 de la vista derecha: centro → keystone (perspectiva) → escala → rotación → traslación (paralaje y desnivel). La GPU muestrea con la inversa. |
| `autoCropMargins` | `align.js` | Proyecta las esquinas de ambas vistas al marco final y toma la intersección de sus rectángulos interiores. |
| `windowParallax` | `align.js` | Desplaza la vista derecha hasta que el percentil 2 del paralaje sea 0: el objeto más cercano queda en el plano de la pantalla. |
| `floatingWindow` | `align.js` | Si junto a un borde lateral hay paralaje negativo (un objeto delante de la pantalla), enmascara ese borde con el ancho necesario. |
| `matchHistogramsLUT` | `color.js` | Coincidencia de histogramas por canal mediante funciones de distribución acumulada. Produce una LUT de 256 niveles que la GPU aplica a la vista derecha. |
| `anaglyphPixel` | `anaglyph.js` | Salida = ML·izquierda + MR·derecha. Dubois aplica sus matrices sobre RGB lineal. |
| `detectStereoLayout` | `split.js` | Correlación cruzada normalizada entre las mitades horizontales y entre las verticales, con tolerancia a la disparidad; gana la más alta. |
| `extractMpoImages` | `mpo.js` | Lee el índice MP Entry (etiqueta 0xB002) del segmento APP2 "MPF"; si falta, busca los marcadores FF D8 FF. |
| `pairFiles` | `pairing.js` | Reconoce sufijos `_L/_R`, `-izq/-der` y `left/right`, archivos SBS o MPO, y la numeración consecutiva de las cámaras. |
| `encodeTIFF` / `encodeGIF` / `createZip` | `encoders.js` | TIFF baseline RGB sin compresión; GIF89a con paleta por corte de mediana y compresión LZW; ZIP sin compresión con CRC-32. |
| `lensSample` (GLSL) | `lens.js` | Predistorsión de barril para las lentes del Cardboard con el modelo radial de Brown: p_origen = p·(1 + k1·r² + k2·r⁴), con k1 = 0,441 y k2 = 0,156 al 100 %. La corrección cromática muestrea rojo y azul con un radio ±0,6 % distinto. En Imagen SBS y Video SBS cada ojo se dibuja en una textura y se copia a su región con este shader. |
| Pipeline de GPU | `pipeline.js` | Pasada por ojo (matriz inversa → giro de 90° → UV; nitidez por máscara de enfoque, LUT, brillo, contraste, gamma, saturación y ventana flotante) y pasada de composición del modo de salida. |

### Rendimiento: nada pesado bloquea la interfaz

- La alineación, la igualación de color, la lectura de MPO, la detección de disposición y la codificación PNG/JPEG/TIFF/GIF/ZIP corren en un **Web Worker** (`stereo-worker.js`), y los búferes se transfieren sin copiarse.
- La vista previa y la deformación se calculan en la **GPU** con shaders: mover un control solo cambia sus uniforms.
- La alineación trabaja sobre una versión de 1000 px y escala los resultados a la resolución completa. Tarda unos 100 ms con el par de prueba.
- El lote procesa un par a la vez, libera cada uno antes del siguiente y cede el hilo entre pares.

### Uso rápido

1. Elige **Editor estéreo** y carga el contenido de una de estas formas:
   - *Vista izquierda* y *Vista derecha*.
   - *Abrir imagen única o MPO*.
   - *Abrir carpeta*.
   - Arrastrar uno o dos archivos al visor.
   - *Abrir muestra*.
   Con una imagen única abierta, cambiar *Disposición* (automática, paralelo, cruzado, arriba/abajo) la vuelve a separar al momento.
2. En *Vista previa* elige **Mezcla** o **Diferencia** y pulsa **Alinear automáticamente**. El informe muestra los puntos, las coincidencias, la corrección aplicada y el error vertical antes y después.
3. Afina con **Desplazamiento horizontal** y **Desnivel vertical** (paso 1), arrastrando sobre el visor o con las flechas (Shift: 10 px). La alineación automática no cambia el desplazamiento horizontal, porque esa diferencia es la profundidad; para fijarlo automáticamente usa *Montaje en ventana*.
4. Aplica **Recorte automático**, **Montaje en ventana** e **Igualar color**; luego elige el modo de salida y pulsa **Exportar**.
5. Con una carpeta cargada aparece **Procesar N pares**. Aplica la receta actual y, si los eliges, la alineación, el recorte, la ventana y el color automáticos. Descarga un ZIP con un `informe.txt`.

### Pruebas

```bash
npm test        # equivale a: node --test "tests/*.test.js"   (Node 20 o posterior)
```

Hay 21 pruebas:
- Homografía y su inversa.
- RANSAC con un 25 % de coincidencias falsas.
- FAST + BRIEF sobre una imagen desplazada.
- **Alineación automática de extremo a extremo**: recupera una rotación y un desnivel conocidos.
- Recorte y ventana automáticos.
- Los seis anaglifos y la conversión sRGB.
- TIFF, GIF, ZIP y CRC-32.
- Histogramas, detección SBS / arriba-abajo, emparejado por nombre y MPO.

---

## 7. Cumplimiento de reglas de negocio

| RN | Cómo se cumple |
|---|---|
| RN-01 | Sin módulo elegido, *Importar*, *Abrir muestra* y arrastrar archivos quedan bloqueados, con instrucciones. |
| RN-02 | `importer.js` valida extensión y MIME y decodifica antes de mostrar. |
| RN-03 | Imágenes: JPG/JPEG, PNG, WebP. Video: MP4 (`canPlayType` y decodificación real). |
| RN-04 | Avisos con título y sugerencia; el Studio sigue operativo y conserva el contenido anterior si existía. |
| RN-05 | `session.js` libera el archivo anterior antes de montar el nuevo; se comprueba con *Memoria GPU*. El *Historial* solo guarda referencias y ajustes; restaurar vuelve a abrir el archivo y libera el actual. |
| RN-06 | Controles deshabilitados (atributo `disabled`) y mensajes en el visor y los paneles cuando no hay contenido. |
| RN-07 | Todo ocurre en la GPU (UV, shader, transformaciones); el archivo nunca se escribe. |
| RN-08 | Al importar se reconstruye la calibración con sus valores iniciales. |
| RN-09 | Los eventos `input` actualizan la vista en el mismo cuadro, sin reimportar. |
| RN-10 | *Restablecer* devuelve todos los parámetros del módulo a sus valores iniciales. |
| RN-11 | La mitad izquierda (U 0 a 0,5) va a la región izquierda y la derecha (U 0,5 a 1) a la derecha. |
| RN-12 | El intercambio reasigna las geometrías UV entre ojos, y las etiquetas indican qué mitad ve cada ojo. |
| RN-13 | El ajuste usa la proporción real de cada vista y añade márgenes; nunca estira. |
| RN-14 | Un único `<video>` y una sola `VideoTexture` alimentan ambos ojos. |
| RN-15 | El modo VR oculta el editor y deja dos regiones a pantalla completa con la calibración vigente. |
| RN-16 | Salir de VR solo cambia la presentación; el archivo y los ajustes se conservan. |
| RN-17 | Botón táctil *Salir de VR* de 44 px, toque para reproducir/pausar y aviso cuando el teléfono está vertical. |
| RN-18 | Nunca hay reproducción automática; `playsinline`; si el navegador bloquea `play()`, se explica qué hacer. |
| RN-19 | Sin backend ni envío de archivos: se usan `URL.createObjectURL` y la memoria del navegador. |
| RN-20 | Solo rutas relativas (`./assets/...`) y dependencias por HTTPS; funciona en un subdirectorio de GitHub Pages. |

---

## 8. Matriz de pruebas (evidencias)

Antes de entregar se ejecutó una **prueba automatizada** en Chrome headless (escritorio 1440 × 900 y móvil 390 × 844 / 844 × 390) que recorre P-01 a P-08, revisa la consola y comprueba que no haya respuestas 404. Resultado: 15/15 comprobaciones superadas. Las pruebas con **teléfono real, lentes anaglifo y gafas VR** se registran en la columna *Resultado obtenido*.

| ID | Prueba | Pasos | Resultado esperado | Resultado obtenido | Dispositivo / navegador | Evidencia |
|---|---|---|---|---|---|---|
| P-01 | Inicio sin contenido | Abrir el sitio | Studio visible, controles inactivos, consola sin errores | | | |
| P-02 | Carga anaglifo | Anaglifo → importar → mover zoom, brillo y contraste | Imagen visible; la vista cambia con cada control | | | |
| P-03 | Carga SBS imagen | Imagen SBS → importar → alineación, escala, intercambio | Dos perspectivas correctas; controles operativos | | | |
| P-04 | Carga SBS video | Video SBS → importar → reproducir, pausar, buscar, ±10 s, volumen | Transporte funcional; tiempos correctos | | | |
| P-05 | Edición en video | Mientras reproduce, mover desplazamiento y escala | Cambios inmediatos sin perder sincronía | | | |
| P-06 | Sustitución | Alternar imagen ↔ video varias veces; *Cerrar archivo* | Sin recargar; *Memoria GPU* vuelve a 0; ningún video sonando | | | |
| P-07 | Archivo inválido | Importar `.txt`, un `.jpg` falso o un video en el módulo de imagen | Mensaje claro; se puede importar otro archivo | | | |
| P-08 | VR móvil | Imagen o video SBS → Modo VR → girar → salir | Dos vistas, aviso si está vertical, ajustes conservados, salida táctil | | | |
| P-09 | GitHub Pages | Abrir la URL HTTPS en escritorio y teléfono; revisar Console y Network | Carga completa, sin 404 ni rutas inválidas | | | |

---

## 9. Registro de calibración

| Archivo | Módulo | Ajustes aplicados | Dispositivo | Resultado visual / observaciones |
|---|---|---|---|---|
| `muestra-anaglifo.jpg` | Anaglifo | | | |
| `muestra-sbs.jpg` | Imagen SBS | | | |
| `muestra-video-sbs.mp4` | Video SBS | | | |

*Exportar calibración* descarga un JSON con módulo, archivo, valores, tamaño de la región de cada ojo, pantalla y navegador, útil para llenar esta tabla.

### Incidencias encontradas y resueltas

1. **El video SBS se veía negro hasta pulsar Reproducir.** `THREE.VideoTexture` solo sube un fotograma cuando el video presenta uno nuevo (`requestVideoFrameCallback`), y un video en pausa recién cargado no presenta ninguno. *Solución:* forzar `texture.needsUpdate = true` al crear la vista y después de cada búsqueda (`seeked`). Así ambos ojos muestran el fotograma actual también en pausa.
2. **En VR horizontal el visor ocupaba solo una parte de la pantalla del teléfono.** La regla móvil del Studio (`aspect-ratio: 16/10; max-height: 70dvh`) seguía aplicándose al stage en modo VR. *Solución:* en `.app.is-vr .stage` se anulan `max-height` y `aspect-ratio` y se fija `width`/`height` al 100 %.
3. **El botón "Imagen SBS" se partía en dos líneas en pantallas de 390 px.** *Solución:* menor relleno horizontal y `white-space: nowrap` en el selector de módulos móvil.

4. **La vista previa del editor desaparecía.** El panel del editor es más alto que la ventana; como el Studio usaba `min-height: 100dvh`, la fila del grid crecía y el visor se volvía tan alto que la imagen, centrada, quedaba fuera de la pantalla. *Solución:* en escritorio el Studio mide exactamente `100dvh` y los paneles tienen su propio scroll.
5. **Pocas coincidencias en escenas lisas.** La muestra renderizada, de superficies planas, solo daba unas 50 esquinas FAST. *Solución:* si se detectan menos de 300, se repite la detección con un umbral más bajo. Las coincidencias coherentes pasaron de 20 a 55 y el error vertical final quedó por debajo de 1 px.

*(Agrega aquí las incidencias que encuentres durante las pruebas con el teléfono y las gafas.)*

---

## 10. Publicación en GitHub Pages

1. Crea el repositorio público `StereoVision-Studio-3D` y sube el contenido manteniendo `index.html` en la raíz.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. Espera el despliegue y abre https://melissamanzano.github.io/StereoVision-Studio-3D/.
4. Revisa Console y Network (P-09) en escritorio y teléfono.

---

## 11. Créditos

- [Three.js](https://threejs.org/) r180 (MIT), cargado desde jsDelivr.
- Fuente [Mona Sans](https://github.com/github/mona-sans) (SIL OFL), servida por Google Fonts.
- Muestras de `assets/media/` generadas para este proyecto con Three.js.
- Parte del visor SBS (render por viewports, recorte UV y pantalla completa) parte del proyecto previo de la autora, [visor-sbs-3d](https://github.com/melissaManzano/visor-sbs-3d).
