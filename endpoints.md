# Endpoints de la Registraduría — Referencia detallada

Documentación completa de los endpoints consumidos para las **Elecciones Presidenciales de Colombia 2026**, tanto los **endpoints externos** (API pública de la Registraduría) como los **endpoints internos** (proxies del proyecto en `app/api/`).

> **Fuente oficial:** `https://resultados.registraduria.gov.co`
> **Auth:** No requiere token ni login (API pública)
> **Cabeceras obligatorias:** `User-Agent` + `Referer` (sin ellas CloudFront responde `403`)
> **Las peticiones a la Registraduría deben salir del servidor**, nunca del navegador (no hay CORS y no se pueden falsificar cabeceras desde el cliente).

---

## Índice

1. [Cabeceras requeridas](#1-cabeceras-requeridas)
2. [Estructura general de la URL](#2-estructura-general-de-la-url)
3. [Endpoints externos (Registraduría)](#3-endpoints-externos-registraduría)
   - 3.1 [Resultados nacionales en vivo](#31-resultados-nacionales-en-vivo)
   - 3.2 [Resultados por departamento](#32-resultados-por-departamento)
   - 3.3 [Boletín histórico (avance)](#33-boletín-histórico-avance)
   - 3.4 [Nomenclátor (catálogo de ámbitos)](#34-nomenclátor-catálogo-de-ámbitos)
   - 3.5 [Configuración oficial](#35-configuración-oficial)
4. [Esquema de la respuesta de resultados](#4-esquema-de-la-respuesta-de-resultados)
5. [Endpoints internos del proyecto](#5-endpoints-internos-del-proyecto)
   - 5.1 [`GET /api/resultados`](#51-get-apiresultados)
   - 5.2 [`GET /api/departamentos`](#52-get-apidepartamentos)
   - 5.3 [`GET /api/historico`](#53-get-apihistorico)
6. [Notas de parsing](#6-notas-de-parsing)
7. [Manejo de errores](#7-manejo-de-errores)

---

## 1. Cabeceras requeridas

Toda petición a `resultados.registraduria.gov.co` **debe** incluir cabeceras de navegador. Sin ellas, CloudFront devuelve `403 Forbidden`.

Definidas en [app/lib.ts](app/lib.ts) como `REG_HEADERS`:

```typescript
export const REG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Referer: "https://resultados.registraduria.gov.co/",
  Accept: "application/json",
} as const;
```

| Cabecera | Obligatoria | Valor |
|----------|-------------|-------|
| `User-Agent` | ✅ Sí | Cadena de navegador (Chrome/Safari) |
| `Referer` | ✅ Sí | `https://resultados.registraduria.gov.co/` |
| `Accept` | Recomendada | `application/json` |

### curl base

```bash
curl -s \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" \
  -H "Referer: https://resultados.registraduria.gov.co/" \
  -H "Accept: application/json" \
  --compressed \
  "https://resultados.registraduria.gov.co/json/ACT/PR/00.json"
```

---

## 2. Estructura general de la URL

**Base:** `https://resultados.registraduria.gov.co/json` (en el código: `REG_BASE`)

```
https://resultados.registraduria.gov.co/json/{TIPO}/{ELEC}/{AMBITO}.json
```

| Parámetro | Valor | Significado |
|-----------|-------|-------------|
| `TIPO` | `ACT` | Resultados **actuales / en vivo** |
| `TIPO` | `HIST` | Boletines históricos / avances anteriores |
| `TIPO` | `EST` | Estadísticas |
| `ELEC` | `PR` | Presidente |
| `AMBITO` | `00` | Colombia (nacional) |
| `AMBITO` | `01`, `03`… | Por departamento/municipio (códigos en `nomenclator.json`) |

> ⚠️ El histórico **no** sigue exactamente esta plantilla — usa una variante con el código de avance. Ver [3.3](#33-boletín-histórico-avance).

---

## 3. Endpoints externos (Registraduría)

### 3.1 Resultados nacionales en vivo

El endpoint principal. Consolidado nacional + votos por candidato.

```
GET /json/ACT/PR/00.json
```

- **Refresco:** la web oficial refresca cada **5 s** (`interval_MS: 5000`); **30 s es seguro** y no genera bloqueos.
- **Respuesta:** ver [esquema completo](#4-esquema-de-la-respuesta-de-resultados).
- **Consumido por:** [`/api/resultados`](#51-get-apiresultados) y como base de los otros dos proxies.

### 3.2 Resultados por departamento

Misma estructura que el nacional, pero acotado a un departamento. El `{codigo}` sale del nomenclátor (ámbitos con nivel `l = 2`).

```
GET /json/ACT/PR/{codigo}.json
```

| Ejemplo | Departamento |
|---------|--------------|
| `/json/ACT/PR/01.json` | Antioquia |
| `/json/ACT/PR/{NN}.json` | Según código del nomenclátor |

- **Respuesta:** idéntica al esquema de resultados (sección 4), pero los totales y candidatos son los del departamento.
- **Consumido por:** [`/api/departamentos`](#52-get-apidepartamentos) (una petición por cada uno de los ~34 departamentos).

### 3.3 Boletín histórico (avance)

Cada avance/boletín publicado se conserva bajo un código `AV_NNNN` con relleno a 4 dígitos. Patrón descubierto en la SPA oficial e implementado en [app/api/historico/route.ts](app/api/historico/route.ts):

```
GET /json/HIST/00/PR/AV_{NNNN}/00.json
```

| Boletín | URL |
|---------|-----|
| #1 | `/json/HIST/00/PR/AV_0001/00.json` |
| #2 | `/json/HIST/00/PR/AV_0002/00.json` |
| #N | `/json/HIST/00/PR/AV_{N a 4 dígitos}/00.json` |

```typescript
// app/api/historico/route.ts
function urlAvance(n: number) {
  const code = `AV_${String(n).padStart(4, "0")}`;
  return `${REG_BASE}/HIST/00/PR/${code}/00.json`;
}
```

- **¿Cuántos avances hay?** Se lee `numact` del endpoint en vivo ([3.1](#31-resultados-nacionales-en-vivo)) y se recorre desde `AV_0001` hasta `AV_{numact}`.
- **Respuesta:** mismo esquema de resultados (sección 4), correspondiente al estado en ese boletín.
- **Consumido por:** [`/api/historico`](#53-get-apihistorico).

### 3.4 Nomenclátor (catálogo de ámbitos)

Catálogo de todos los ámbitos territoriales (departamentos, municipios, zonas, puestos, mesas) con sus códigos.

```
GET /json/nomenclator.json
```

**Estructura relevante** (según el parseo en `departamentosDesdeNomenclator`):

```jsonc
{
  "amb": [
    {
      "ambitos": [
        { "co": "01", "n": "ANTIOQUIA", "s": "ANT", "l": 2 },
        // ...
      ]
    }
  ]
}
```

| Campo | Significado |
|-------|-------------|
| `co` | Código del ámbito (usado en `ACT/PR/{co}.json`) |
| `n` | Nombre del ámbito |
| `s` | Sigla / nombre corto |
| `l` | Nivel jerárquico: **`l = 2` → departamentos** (los ~34 que usa el proyecto) |

```typescript
// app/lib.ts — filtra los 34 departamentos
export function departamentosDesdeNomenclator(nom): DepartamentoInfo[] {
  const ambitos = nom?.amb?.[0]?.ambitos ?? [];
  return ambitos
    .filter((a) => a.l === 2 && a.co)
    .map((a) => ({ codigo: a.co, nombre: (a.n || a.s || a.co).trim().toUpperCase() }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}
```

- **Consumido por:** [`/api/departamentos`](#52-get-apidepartamentos) para obtener la lista de departamentos a consultar.

### 3.5 Configuración oficial

Estado de apertura del escrutinio e intervalo de polling que usa la web oficial.

```
GET /json/web/config.json
```

- Incluye, entre otros, `interval_MS` (el oficial es `5000`).
- **No se consume actualmente** en el proyecto; queda documentado como referencia.

---

## 4. Esquema de la respuesta de resultados

Aplica a los endpoints **3.1**, **3.2** y **3.3** (todos devuelven la misma forma). Tipado en [app/lib.ts](app/lib.ts) como `RawRespuesta`.

```jsonc
{
  "elec": "1",            // 1 = Presidente
  "amb": "00",            // ámbito: 00 = Colombia nacional
  "numact": "1",          // número de boletín/avance
  "mdhm": "05311608",     // marca temporal MMDDHHMM (31-may 16:08)
  "iscircus": "1",

  "totales": {
    "act": {
      "metota": "122020",    // mesas totales
      "mesesc": "28",        // mesas escrutadas
      "pmesesc": "0,02%",    // % mesas escrutadas
      "centota": "41421973", // censo electoral
      "votant": "510",       // total votantes
      "pvotant": "0,01%",    // % participación
      "absten": "41421463",  // abstención
      "pabsten": "99,99%",
      "votnul": "4",         // votos nulos
      "pvotnul": "0,78%",
      "votblan": "12",       // votos en blanco
      "pvotblan": "2,37%",
      "votval": "505",       // votos válidos
      "pvotval": "99,01%"
    }
  },

  "camaras": [
    {
      "partotabla": [                 // 👈 un elemento por partido/candidato
        {
          "act": {
            "codpar": "7",            // código del partido
            "vot": "252",             // votos del partido
            "pvot": "49,90%",         // % del partido
            "cantotabla": [
              {
                "codcan": "1",
                "cedula": "79262397",
                "nomcan": "IVÁN",      // nombre del candidato
                "apecan": "CEPEDA CASTRO", // apellido del candidato
                "vot": "252",
                "pvot": "49,90%",
                "pref": "1"
              }
            ]
          }
        }
        // ... resto de candidatos
      ]
    }
  ]
}
```

### 4.1 Diccionario de campos

**Raíz:**

| Campo | Significado |
|-------|-------------|
| `elec` | Tipo de elección (`1` = Presidente) |
| `amb` | Ámbito (`00` = nacional) |
| `numact` | Número de avance/boletín |
| `mdhm` | Marca temporal del boletín `MMDDHHMM` → usar para detectar boletín nuevo |

**`totales.act` (consolidado del ámbito):**

| Campo | Significado |
|-------|-------------|
| `mdhm` | Marca temporal `MMDDHHMM` |
| `numact` | Número de avance/boletín |
| `metota` | Mesas totales |
| `mesesc` | Mesas escrutadas |
| `pmesesc` | % de mesas escrutadas |
| `centota` | Censo electoral |
| `votant` | Total de votantes |
| `pvotant` | % de participación |
| `absten` | Abstención |
| `pabsten` | % de abstención |
| `votval` | Votos válidos |
| `pvotval` | % de votos válidos |
| `votblan` | Votos en blanco |
| `pvotblan` | % de votos en blanco |
| `votnul` | Votos nulos |
| `pvotnul` | % de votos nulos |

**`camaras[0].partotabla[].act` (por partido/candidato):**

| Campo | Significado |
|-------|-------------|
| `codpar` | Código del partido |
| `vot` | Votos del partido/candidato |
| `pvot` | Porcentaje |
| `cantotabla[].codcan` | Código del candidato |
| `cantotabla[].cedula` | Cédula del candidato |
| `cantotabla[].nomcan` | Nombre del candidato |
| `cantotabla[].apecan` | Apellido del candidato |
| `cantotabla[].pref` | Número de preferencia |

> Los candidatos viven en `camaras[0].partotabla[]`; cada partido relevante trae un `cantotabla[0]` con el candidato presidencial.

---

## 5. Endpoints internos del proyecto

Proxies en el App Router que añaden las cabeceras, normalizan los datos y los reexponen al front sin CORS. Todos declaran `export const dynamic = "force-dynamic"` y responden con `Cache-Control: no-store`.

### 5.1 `GET /api/resultados`

Proxy directo del [endpoint nacional en vivo](#31-resultados-nacionales-en-vivo). [app/api/resultados/route.ts](app/api/resultados/route.ts)

| | |
|---|---|
| **Método** | `GET` |
| **Upstream** | `GET /json/ACT/PR/00.json` |
| **Cuerpo** | El JSON crudo de la Registraduría (esquema sección 4), reexpuesto tal cual |
| **Caché** | `no-store` (el front decide cada cuánto refresca; recomendado 30 s) |
| **Errores** | `502` con `{ error: "HTTP <status>" }` si el upstream falla; `502` con `{ error: <mensaje> }` ante excepción |

```jsonc
// 200 OK → mismo cuerpo que /json/ACT/PR/00.json (ver sección 4)
{ "elec": "1", "amb": "00", "numact": "1", "mdhm": "...", "totales": { ... }, "camaras": [ ... ] }
```

### 5.2 `GET /api/departamentos`

Votos por candidato en **cada departamento**. Combina el nomenclátor + una petición `ACT/PR/{codigo}.json` por departamento (en lotes de `CONCURRENCY = 6`). [app/api/departamentos/route.ts](app/api/departamentos/route.ts)

| | |
|---|---|
| **Método** | `GET` |
| **Upstream** | `nomenclator.json` + `ACT/PR/00.json` (orden de candidatos) + `ACT/PR/{cod}.json` por cada depto |
| **Concurrencia** | 6 peticiones en paralelo por lote |
| **Caché** | `no-store` |
| **Errores** | `502 { error: "no_departments" }` si el nomenclátor no trae deptos; `502 { error: <mensaje> }` ante excepción |

**Respuesta (`DatosDepartamentos`):**

```jsonc
{
  "candidatos": [                       // orden canónico (del nacional)
    { "id": "79262397", "nombre": "IVÁN CEPEDA CASTRO" }
  ],
  "departamentos": [
    {
      "codigo": "05",
      "nombre": "ANTIOQUIA",
      "candidatos": [
        { "id": "79262397", "nombre": "IVÁN CEPEDA CASTRO", "votos": 252 }
      ],
      "totalValidos": 505
    }
    // ... ordenados alfabéticamente por nombre (es)
  ],
  "total": 34,                          // nº de departamentos resueltos
  "mdhm": "05311608"                    // marca temporal del nacional
}
```

### 5.3 `GET /api/historico`

Serie temporal de **todos los boletines** desde `AV_0001` hasta el avance actual (`numact`), en lotes de `CONCURRENCY = 8`, deduplicados por `mdhm`. [app/api/historico/route.ts](app/api/historico/route.ts)

| | |
|---|---|
| **Método** | `GET` |
| **Upstream** | `ACT/PR/00.json` (para `numact`) + `HIST/00/PR/AV_{NNNN}/00.json` por cada boletín |
| **Concurrencia** | 8 peticiones en paralelo por lote |
| **Dedup** | Se descartan boletines con `mdhm` repetido o vacío |
| **Caché** | `no-store` |
| **Errores** | `502 { error: "act_unavailable" }` si no se puede leer el nacional; `502 { error: <mensaje> }` ante excepción |

**Respuesta:**

```jsonc
{
  "boletines": [                        // ordenados por numact ascendente
    {
      "mdhm": "05311608",
      "numact": 1,
      "hora": "31/05 16:08",            // derivado de mdhm
      "pctMesas": 0.02,
      "pctParticipacion": 0.01,
      "validos": 505,
      "blanco": 12,
      "nulos": 4,
      "cands": [
        { "id": "79262397", "nombre": "IVÁN CEPEDA CASTRO", "porcentaje": 49.9, "votos": 252 }
      ]
    }
  ],
  "numact": 1,                          // último avance
  "total": 1                            // nº de boletines únicos devueltos
}
```

Caso especial: si `numact === 0`, responde `{ "boletines": [], "numact": 0 }`.

---

## 6. Notas de parsing

Implementado en `num()` y `horaDesdeMdhm()` de [app/lib.ts](app/lib.ts).

- **Todos los valores llegan como `string`**, no como número.
- **Porcentajes con coma decimal y símbolo:** `"49,90%"` → `49.9`.
- **Miles con punto:** `"41.421.973"` → `41421973` (el punto separador de miles se elimina solo cuando no hay coma decimal).

```typescript
/** "49,90%" -> 49.9 | "41.421.973" -> 41421973 */
export function num(s: string | undefined | null): number {
  if (s == null) return 0;
  const limpio = String(s)
    .replace("%", "")
    .trim()
    .replace(/\.(?=\d{3}(\D|$))/g, "")  // quita puntos de miles
    .replace(",", ".");                  // coma decimal -> punto
  const v = parseFloat(limpio);
  return Number.isFinite(v) ? v : 0;
}
```

- **Marca temporal `mdhm` = `MMDDHHMM`** (mes, día, hora, minuto). `horaDesdeMdhm("05311608")` → `"31/05 16:08"`.
- **Detectar boletín nuevo:** comparar `mdhm` (o `numact`) contra el último valor guardado.
- **Candidatos:** recorrer `camaras[0].partotabla[]` y leer cada `cantotabla[0]`; el `id` se toma de `cedula || codcan || codpar`.

---

## 7. Manejo de errores

`fetchRegistraduria<T>()` ([app/lib.ts](app/lib.ts)) centraliza las llamadas al upstream y **nunca lanza**: devuelve `null` si la respuesta no es `ok` o si hay excepción de red.

```typescript
export async function fetchRegistraduria<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: REG_HEADERS, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
```

| Situación | Respuesta del endpoint interno |
|-----------|-------------------------------|
| Upstream responde `!ok` (p. ej. `403`/`5xx`) | `502 { error: "HTTP <status>" }` (en `/api/resultados`) |
| Nomenclátor sin departamentos | `502 { error: "no_departments" }` |
| Nacional no disponible (histórico) | `502 { error: "act_unavailable" }` |
| Excepción de red / parseo | `502 { error: <mensaje> }` |
| Un departamento/boletín individual falla | Se omite (devuelve `null`) y el resto continúa |

### Checklist para el programador

- [ ] La petición a la Registraduría se hace **del lado del servidor**, nunca desde el cliente.
- [ ] Se envían las cabeceras `User-Agent` y `Referer`.
- [ ] El front consume los endpoints internos (`/api/...`), no la Registraduría directamente.
- [ ] Refresco del front cada **30 segundos**.
- [ ] Parsear strings → números con `num()` (quita `%`, puntos de miles y cambia `,` por `.`).
- [ ] Detectar boletín nuevo comparando `mdhm` / `numact`.
- [ ] Manejar `502` / `{ error }` y reintentos suaves.
