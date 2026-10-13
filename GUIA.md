# MyCards: cómo ponerla en línea

MyCards es una página web de estudio médico que se instala en el celular, la tablet o el computador como una aplicación. Funciona así:

- **Cuentas y datos:** las cuentas (correo y contraseña, o Google) y los datos (mazos, tarjetas, progreso e imágenes) se guardan en **Firebase**, el servicio gratuito de Google.
- **Archivos de la página:** se publican gratis en **GitHub Pages**.

No necesitas instalar nada en tu computador ni registrar una tarjeta de crédito. Todo se hace desde el navegador y toma unos 20-30 minutos la primera vez.

---

## 1. Crear el proyecto de Firebase

1. Entra a <https://console.firebase.google.com> con tu cuenta de Google.
2. Pulsa **Crear un proyecto** (o "Comenzar con un proyecto de Firebase").
   - Nombre: `mycards` (o el que quieras).
   - Puedes desactivar Google Analytics y Gemini; no se usan.
3. En la página principal del proyecto pulsa el icono **Web** (`</>`) para "Agregar una app".
   - Apodo: `MyCards`.
   - **No** marques Firebase Hosting.
   - Pulsa **Registrar app**.
4. Aparece un bloque `const firebaseConfig = { ... }`. **Cópialo y guárdalo**; lo usarás en el paso 5.
   - Estos datos no son secretos. Si quieres, pégamelos en el chat y te devuelvo el archivo de configuración ya listo.

## 2. Activar el inicio de sesión

1. En el menú izquierdo ve a **Compilación → Authentication → Comenzar**.
2. En la pestaña **Método de acceso** activa:
   - **Correo electrónico/contraseña**: actívalo y pulsa **Guardar**.
   - **Google**: actívalo, elige tu correo como "correo de asistencia" y pulsa **Guardar**.

## 3. Crear la base de datos y sus reglas de seguridad

1. Menú izquierdo: **Compilación → Firestore Database → Crear base de datos**.
   - Ubicación: `nam5 (United States)` o `southamerica-east1 (São Paulo)`. Esta elección es definitiva, pero ambas sirven.
   - Modo: **producción**. Pulsa **Crear**.
2. Abre la pestaña **Reglas**.
3. Borra todo lo que haya y pega el contenido completo del archivo `firestore.rules`.
4. Pulsa **Publicar**.

Las reglas son las que protegen la app. Garantizan que:

- tu progreso y tus ediciones sólo los ves tú;
- un mazo privado sólo lo ven tú y las personas que agregues;
- cada número de serie es único y no se puede reutilizar ni copiar;
- los mazos "con número de serie" no se pueden listar: sólo los encuentra quien tiene el número;
- sólo puede editar quien tú autorices;
- sólo el dueño puede borrar o compartir un mazo.

## 4. Subir la app a GitHub

1. Crea una cuenta en <https://github.com> si no tienes una.
2. Pulsa **New repository**.
   - Nombre: `mycards`.
   - Visibilidad: **Public**. GitHub Pages es gratis para repositorios públicos.
   - Pulsa **Create repository**.
3. En la página del repositorio vacío pulsa **uploading an existing file**.
4. Descomprime el `.zip` en tu computador y **arrastra el contenido de la carpeta** (no el zip). Deben subir:
   - `index.html`, `sw.js`, `manifest.webmanifest`, `firestore.rules`, `GUIA.md` y `.nojekyll`;
   - las carpetas `js` e `icons`.
   - Si `.nojekyll` no se sube (algunos sistemas ocultan los archivos que empiezan con punto), no pasa nada.
5. Pulsa **Commit changes**.

## 5. Pegar la configuración de Firebase

1. En GitHub abre `js/firebase-config.js` y pulsa el lápiz (**Edit this file**).
2. Reemplaza los valores de ejemplo por los del paso 1.4. Mantén el formato `export const firebaseConfig = { ... };`.
3. Pulsa **Commit changes**.

## 6. Publicar con GitHub Pages

1. En el repositorio ve a **Settings → Pages**.
2. En **Build and deployment → Source** elige **Deploy from a branch**.
3. Branch: `main` y carpeta `/ (root)`. Pulsa **Save**.
4. Espera 1-2 minutos y recarga. Arriba aparece el enlace de tu app, algo como `https://TU-USUARIO.github.io/mycards/`.

## 7. Autorizar tu dominio para el inicio con Google

1. En Firebase ve a **Authentication → Configuración → Dominios autorizados → Agregar dominio**.
2. Escribe `TU-USUARIO.github.io`, sin `https://` y sin `/mycards`.

## 8. Entrar e instalarla en el celular

1. Abre el enlace y crea tu cuenta, con Google o con correo y contraseña.
   - Si usas correo y contraseña, te llega un correo de verificación (revisa spam).
   - Verificarlo es necesario para que otras personas te compartan mazos por correo.
   - Las cuentas nuevas empiezan sin mazos.
2. Para instalarla como app:
   - **iPhone/iPad (Safari):** botón Compartir → **Agregar a inicio**.
   - **Android (Chrome):** menú ⋮ → **Instalar app**.
   - **Computador (Chrome/Edge):** icono de instalar en la barra de direcciones.
3. Entra con la misma cuenta en todos tus dispositivos y verás el mismo progreso.
4. Sin internet puedes seguir estudiando; los cambios se sincronizan al reconectar.

## 9. Traer el mazo de Laringología desde la app de Claude

1. En la app **Repaso de Laringología** de Claude ve a **Progreso → Exportar para la web** y guarda el archivo.
2. En MyCards ve a **Cuenta → Importar desde la app de Claude** y elige ese archivo.
3. Se crea en tu cuenta el mazo **Laringología** (privado y tuyo, con su número de serie). Incluye:
   - las 274 tarjetas, con tus ediciones y tarjetas propias;
   - las 144 preguntas de examen;
   - tu progreso y tus aciertos;
   - tus imágenes.
4. También se importan tus otros mazos.
5. Si quieres que tus compañeros lo usen, cámbialo en **Compartir** a "Con número de serie" y pásales el número.

## 10. Dominio propio: mycardsapp.com

Con estos pasos MyCards pasa a abrirse en `https://mycardsapp.com`. El enlace viejo (`abellojuandiego.github.io/mycards`) redirige solo a la nueva dirección. Los mazos, el progreso y las cuentas siguen intactos porque viven en Firebase. El código no cambia. Calcula unos 30 minutos de trabajo, más la espera de los DNS (de minutos a unas horas).

### 10.1 Comprar el dominio

1. Cómpralo en un registrador que cobre lo mismo al renovar que el primer año. Por ejemplo:
   - **Cloudflare Registrar** (<https://dash.cloudflare.com>, Domain Registration → Register Domains), a precio de costo;
   - **Porkbun** (<https://porkbun.com>).
   - Un `.com` cuesta cerca de 10 USD al año. Mira el precio de **renovación**, no el de promoción.
2. Busca `mycardsapp.com`. Si aparece como disponible, cómpralo. Activa la **renovación automática** y la **protección de privacidad WHOIS** (suele ser gratis).
3. Si ya está ocupado, avísale a Claude y eligen otro nombre. Ningún paso de abajo depende de que sea ese nombre exacto.

### 10.2 Verificar el dominio en GitHub (protege contra robos del dominio)

1. En GitHub, tu foto (arriba a la derecha) → **Settings → Pages** (el de tu *perfil*, no el del repositorio) → **Add a domain**.
2. Escribe `mycardsapp.com` y pulsa **Add domain**. GitHub te muestra un registro **TXT** con un nombre como `_github-pages-challenge-abellojuandiego` y un valor largo.
3. Crea ese registro TXT en el panel DNS del registrador (paso 10.3) y vuelve a pulsar **Verify**. Puede tardar unos minutos en aparecer.

### 10.3 Crear los registros DNS

En el registrador abre **DNS** de `mycardsapp.com`. Borra los registros A, AAAA o CNAME de "parking" que traiga por defecto para `@` y `www` y crea estos:

| Tipo | Nombre | Valor |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `abellojuandiego.github.io` |
| TXT | (el que dio GitHub en 10.2) | (el valor que dio GitHub) |

- Los AAAA son opcionales, pero conviene ponerlos.
- El CNAME de `www` apunta a `abellojuandiego.github.io` **sin** `/mycards`.
- **Si usas Cloudflare:** cada registro A, AAAA y CNAME debe quedar con la nube **gris (DNS only)**, no naranja. Con la nube naranja GitHub no puede emitir el certificado HTTPS.

### 10.4 Conectar el dominio en el repositorio

1. En GitHub abre el repositorio `mycards` → **Settings → Pages → Custom domain**.
2. Escribe `mycardsapp.com` y pulsa **Save**.
   - GitHub crea solo un archivo `CNAME` en el repositorio. No lo crees ni lo borres a mano.
   - **Importante:** antes del siguiente cambio, en GitHub Desktop pulsa **Fetch origin → Pull origin** para traer ese archivo. Si no, el siguiente Push puede fallar.
3. Espera a que aparezca "DNS check successful". Luego marca **Enforce HTTPS**; esa casilla puede tardar hasta 24 horas en activarse.

### 10.5 Autorizar el dominio en Firebase

1. Firebase → **Authentication → Configuración → Dominios autorizados → Agregar dominio**.
2. Agrega `mycardsapp.com` y luego `www.mycardsapp.com` (sin `https://`).
3. Deja también `abellojuandiego.github.io`. No estorba.

Sin este paso, el botón "Entrar con Google" falla en el dominio nuevo.

### 10.6 Pasar tus dispositivos a la dirección nueva

Cada dirección web guarda su propia sesión y su propia copia sin conexión, así que en cada dispositivo:

1. Abre la app vieja **con internet** para que se sincronice cualquier cambio pendiente.
2. Abre `https://mycardsapp.com` y entra con tu cuenta. Todo tu progreso aparece igual.
3. Borra el icono viejo de la pantalla de inicio e **instala de nuevo** desde la dirección nueva (paso 8.2).
4. A partir de ahora comparte con tus compañeros los enlaces de `mycardsapp.com`. Los enlaces viejos de mazos también siguen funcionando porque redirigen.

---

## Importar y exportar mazos (archivos)

En **Mis mazos → Importar archivo** subes un archivo y MyCards crea el mazo solo. Antes de crearlo muestra una vista previa con:

- el nombre, que puedes cambiar;
- cuántas tarjetas, preguntas de examen y temas encontró;
- las primeras tarjetas, y en las preguntas de opción múltiple la respuesta marcada como correcta;
- avisos sobre filas incompletas o tarjetas repetidas (que se omiten).

Si algo falla a mitad de la importación, se deshace todo y no quedan mazos a medias.

### Formatos que acepta

| Archivo | De dónde sale | Cómo lo lee MyCards |
| --- | --- | --- |
| `.csv`, `.tsv`, `.txt` | Excel o Google Sheets ("Guardar como CSV"), Quizlet (Exportar), Anki ("Notas en texto plano") | Detecta solo el separador (`;`, `,` o tabulación) y las columnas por su encabezado. Sin encabezados: 1.ª columna = pregunta, 2.ª = respuesta. |
| `.xlsx` | Excel | Igual que el CSV. Si el libro tiene varias hojas, cada hoja queda como un tema. |
| `.json` | "Exportar" de MyCards, o el que te prepare Claude | Formato completo: temas, opción múltiple, explicaciones e imágenes. |
| `.json` de la app de Claude | "Exportar para la web" de Repaso de Laringología | Te lleva automáticamente al importador de **Cuenta**. |
| `.apkg` | Anki | Todavía no: en Anki usa Archivo → Exportar → "Notas en texto plano (.txt)". Está en preparación. |

**Encabezados que reconoce** (sin importar mayúsculas ni tildes):

- **Pregunta:** pregunta, frente, anverso, front, question, término.
- **Respuesta:** respuesta, reverso, back, answer, definición.
- **Tema:** tema, capítulo, categoría, sección, topic.
- **Opción múltiple:** opcion_a … opcion_h (o A, B, C, D), correcta (letra, número u opción completa), explicacion.

En Anki también entiende los encabezados `#separator`, `#html` y `#deck column`. Los subconjuntos del mazo (`ORL::Laringe::Anatomía`) se convierten en temas, el HTML se limpia y los cloze `{{c1::…}}` pasan a pregunta y respuesta.

En la misma pantalla hay dos **plantillas**, una para Excel (.csv) y otra JSON, y un botón **Copiar instrucciones para Claude**. Pegas esas instrucciones en un chat con Claude, cambias `[TEMA]` y te devuelve un archivo listo para subir.

### El formato JSON de MyCards

```json
{
  "format": "mycards",
  "version": 1,
  "name": "Laringología",
  "description": "Opcional",
  "cards": [
    { "q": "Pregunta", "a": "Respuesta", "topic": "Tema", "img": ["data:image/webp;base64,…"] }
  ],
  "questions": [
    { "q": "Pregunta", "options": ["A", "B", "C", "D"], "correct": "B", "explanation": "Por qué", "topic": "Tema" }
  ]
}
```

- `topic`, `img`, `description` y `questions` son opcionales.
- `correct` es la letra de la opción correcta (A = la primera).
- Para varios mazos en un archivo: `{ "format": "mycards", "version": 1, "decks": [ {…}, {…} ] }`.

### Exportar

Cada mazo tiene un botón **Exportar** que descarga `nombre.mycards.json` con las tarjetas, las preguntas, los temas y las imágenes. Sirve como copia de seguridad o para pasarle el mazo a alguien como archivo. No incluye tu progreso.

## Números de serie y cómo se comparte un mazo

Cada mazo recibe un **número de serie único** de 8 caracteres (por ejemplo `K7QP-3XMA`) en el momento en que se crea. Aparece en la tarjeta del mazo en **Mis mazos** y en **Compartir**. Otra persona lo agrega desde **Mis mazos → Agregar con n.º de serie** o abriendo el enlace del mazo. Mayúsculas, espacios y guiones no importan.

En **Mis mazos → Compartir** eliges:

- **Privado:** lo ven sólo tú y las personas que agregues por correo. Con el número de serie nadie más puede abrirlo.
- **Con número de serie:** cualquier persona con cuenta que tenga el número o el enlace puede agregarlo y estudiarlo. No aparece en Explorar.
- **Público:** además aparece en "Explorar mazos públicos".
- **Personas:** a cada correo le das **Puede editar** o **Sólo ver**.
- **Cualquiera puede editar** (con número de serie o público): cualquier persona con acceso puede añadir, cambiar o borrar tarjetas.

Cada persona tiene su propio progreso aunque estudie el mismo mazo. En un mazo que no puede editar, sus cambios se guardan sólo para ella. **Duplicar** crea una copia que pasa a ser tuya.

Ten en cuenta dos cosas sobre la privacidad:

- En un mazo con número de serie o público, quien lo abre puede ver los correos de las personas que agregaste.
- Las imágenes las puede abrir cualquier persona con cuenta que tenga el enlace interno de la imagen. Ese enlace sólo aparece dentro de las tarjetas que la contienen.

## Repetición espaciada (FSRS-5)

MyCards programa cada tarjeta con **FSRS-5**, el mismo algoritmo que usa Anki moderno. Para cada tarjeta estima tres cosas:

- **Dificultad** (de 1 a 10).
- **Estabilidad:** en cuántos días la probabilidad de recordarla cae al 90 %.
- **Recuperabilidad:** la probabilidad de que la recuerdes hoy.

Con eso la vuelve a mostrar justo cuando la probabilidad de recordarla cae a tu **retención deseada** (90 % por defecto; se cambia en **Cuenta**).

| Botón | Úsalo cuando… | Qué pasa |
| --- | --- | --- |
| Otra vez | no la recordaste | Vuelve en minutos (pasos de reaprendizaje) y su estabilidad baja. |
| Difícil | la recordaste con mucho esfuerzo o incompleta | Intervalo más corto que con "Bien". |
| Bien | la recordaste tras pensarlo | Es la respuesta habitual. |
| Fácil | la recordaste al instante | Intervalo mucho más largo. |

- **Tarjetas nuevas:** pasan por pasos cortos el mismo día (1 y 10 minutos) antes de pasar a repaso por días.
- **Intervalo de cada botón:** cada botón muestra en cuánto tiempo volverás a ver la tarjeta.
- **Límite de tarjetas nuevas:** 20 por día y por mazo, configurable.

Con una retención del 90 %, una tarjeta que respondes "Bien" cada vez se repasa a los 4, 14, 44 y 125 días aproximadamente. Si se acerca un examen, puedes subir la retención al 93-95 %: verás más repasos e intervalos más cortos.

## Límites del plan gratuito de Firebase (Spark)

- 1 GB de datos.
- 50 000 lecturas y 20 000 escrituras por día.

Esto alcanza de sobra para ti y un grupo de compañeros. Las imágenes se guardan comprimidas, con un máximo de unos 900 KB cada una.

## Actualizaciones futuras

Cuando quieras un cambio, pídeselo a Claude como hasta ahora. Hay tres formas de aplicarlo:

- **Opción A, la que usas ahora:** con la carpeta `Documents/GitHub/mycards` conectada a Claude desde la app de escritorio, Claude escribe los cambios directamente en tu carpeta. Tú abres **GitHub Desktop**, revisas los cambios, escribes un resumen, pulsas **Commit to main** y luego **Push origin**. En 1-2 minutos la app se actualiza sola para todos.
- **Opción B, la más simple:** Claude te entrega los archivos modificados. En GitHub abre cada uno, pulsa el lápiz o **Add file → Upload files** para reemplazarlo y luego **Commit changes**.
- **Opción C, la más cómoda:** conecta tu cuenta de GitHub a Claude. Así Claude puede subir los cambios directamente al repositorio `mycards` y tú sólo revisas.

Si ya subiste la versión anterior ("Repaso ORL"), reemplaza todos los archivos, borra `js/bank.js` y vuelve a pegar las reglas. Como las cuentas ahora empiezan en cero, importa de nuevo el archivo exportado desde Claude.

Si un cambio modifica `firestore.rules`, vuelve a pegarlo en Firebase → Firestore → Reglas → **Publicar**.

## Estructura de archivos

| Archivo | Para qué sirve |
| --- | --- |
| `index.html` | Página y estilos. |
| `js/app.js` | La aplicación: estudio, mazos, compartir, búsqueda, cuenta e importación. |
| `js/backend.js` | Conexión con Firebase (cuentas y base de datos). |
| `js/srs.js` | Algoritmo de repetición espaciada (FSRS-5). |
| `js/importer.js` | Lectura de archivos para importar y exportar mazos (CSV, Excel, JSON). |
| `js/firebase-config.js` | Tu configuración de Firebase (paso 5). |
| `firestore.rules` | Reglas de seguridad (paso 3). |
| `sw.js`, `manifest.webmanifest`, `icons/` | Hacen que se pueda instalar y abrir sin conexión. |
