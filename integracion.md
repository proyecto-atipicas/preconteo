# Integración de Resultados en Tiempo Real — Registraduría 2026

Guía técnica para consumir los resultados oficiales de las **Elecciones Presidenciales de Colombia 2026** desde la API pública de la Registraduría, con refresco cada 30 segundos.

> **Fuente:** `https://resultados.registraduria.gov.co`
> **Auth:** No requiere token ni login (API pública)
> **Última verificación:** 31 de mayo de 2026

---

## 1. Resumen rápido

- La web oficial es una SPA en React que consume una **API JSON pública del mismo dominio**.
- El endpoint de **resultados en vivo** es:
  ```
  https://resultados.registraduria.gov.co/json/ACT/PR/00.json
  ```
- **Obligatorio** enviar cabeceras de navegador (`User-Agent` + `Referer`); de lo contrario CloudFront responde **403 Forbidden**.
- La petición debe hacerse **del lado del servidor** (en Next.js: Route Handler / Server Component), nunca desde el navegador (no hay CORS y no se pueden falsificar cabeceras desde el cliente).
- La web oficial refresca cada **5 segundos** (`interval_MS: 5000`), así que **30 segundos es seguro** y no genera riesgo de bloqueo.

---

## 2. Estructura de la URL

```
https://resultados.registraduria.gov.co/json/{TIPO}/{ELEC}/{AMBITO}.json
```

| Parámetro | Valor      | Significado                                              |
|-----------|------------|---------------------------------------------------------|
| `TIPO`    | `ACT`      | Resultados **actuales / en vivo**                       |
| `TIPO`    | `HIST`     | Boletines históricos / avances anteriores               |
| `TIPO`    | `EST`      | Estadísticas                                            |
| `ELEC`    | `PR`       | Presidente                                              |
| `AMBITO`  | `00`       | Colombia (nacional)                                     |
| `AMBITO`  | `01`, `03`…| Por departamento/municipio (códigos en `nomenclator.json`) |

### Endpoints auxiliares útiles

| Endpoint | Descripción |
|----------|-------------|
| `/json/ACT/PR/00.json` | **Resultados nacionales en vivo** (el principal) |
| `/json/ACT/PR/01.json` | Resultados de Antioquia (ejemplo por departamento) |
| `/json/nomenclator.json` | Catálogo de todos los ámbitos (deptos, municipios, zonas, puestos, mesas) con sus códigos |
| `/json/web/config.json` | Configuración oficial: estado de apertura e intervalo de polling |

---

## 3. El curl (request base)

```bash
curl -s \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" \
  -H "Referer: https://resultados.registraduria.gov.co/" \
  -H "Accept: application/json" \
  --compressed \
  "https://resultados.registraduria.gov.co/json/ACT/PR/00.json"
```

> ⚠️ Las cabeceras **`User-Agent`** y **`Referer`** son obligatorias. Sin ellas → `403`. Con ellas → `200`.

---

## 4. Implementación en Next.js (App Router)

### 4.1 Route Handler — `app/api/resultados/route.ts`

Este endpoint del servidor hace de proxy: añade las cabeceras requeridas, revalida cada 30s y reexpone el JSON a tu front sin problemas de CORS.

```typescript
export const dynamic = "force-dynamic"; // evita cacheo en build

export async function GET() {
  const res = await fetch(
    "https://resultados.registraduria.gov.co/json/ACT/PR/00.json",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://resultados.registraduria.gov.co/",
        Accept: "application/json",
      },
      next: { revalidate: 30 }, // revalida cada 30 segundos
    }
  );

  if (!res.ok) {
    return Response.json({ error: `HTTP ${res.status}` }, { status: 502 });
  }

  const data = await res.json();
  return Response.json(data);
}
```

### 4.2 Consumo desde el cliente

El front consume **tu propio endpoint** (ya sin cabeceras ni CORS):

```typescript
"use client";
import { useEffect, useState } from "react";

export function useResultados(intervaloMs = 30_000) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const cargar = async () => {
      try {
        const r = await fetch("/api/resultados");
        if (r.ok) setData(await r.json());
      } catch (e) {
        console.error("Error cargando resultados:", e);
      }
    };
    cargar();
    const id = setInterval(cargar, intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);

  return data;
}
```

---

## 5. Qué responde el endpoint (estructura real)

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
      "cam": "0",
      "totales": {
        "act": {
          "votcan": "493",
          "pvotcan": "97,62%",
          "votbla": "12",
          "votnul": "4"
        }
      },

      // 👇 Candidatos / partidos
      "partotabla": [
        {
          "act": {
            "codpar": "7",      // código del partido
            "vot": "252",       // votos del partido
            "pvot": "49,90%",   // % del partido
            "cantotabla": [
              {
                "codcan": "1",
                "cedula": "79262397",
                "nomcan": "IVÁN",
                "apecan": "CEPEDA CASTRO",   // 👈 candidato
                "vot": "252",
                "pvot": "49,90%",
                "pref": "1"
              }
            ]
          }
        },
        {
          "act": {
            "codpar": "10",
            "vot": "193",
            "pvot": "38,21%",
            "cantotabla": [
              {
                "codcan": "4",
                "nomcan": "ABELARDO",
                "apecan": "DE LA ESPRIELLA",  // 👈 candidato
                "vot": "193",
                "pvot": "38,21%"
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

### 5.1 Diccionario de campos

**`totales.act` (consolidado nacional):**

| Campo      | Significado                       |
|------------|-----------------------------------|
| `mdhm`     | Marca temporal del boletín `MMDDHHMM` → usar para detectar boletín nuevo |
| `numact`   | Número de avance/boletín          |
| `metota`   | Mesas totales                     |
| `mesesc`   | Mesas escrutadas                  |
| `pmesesc`  | % de mesas escrutadas             |
| `centota`  | Censo electoral                   |
| `votant`   | Total de votantes                 |
| `pvotant`  | % de participación                |
| `absten`   | Abstención                        |
| `votval`   | Votos válidos                     |
| `votblan`  | Votos en blanco                   |
| `votnul`   | Votos nulos                       |

**`camaras[].partotabla[].act` (por candidato/partido):**

| Campo      | Significado                       |
|------------|-----------------------------------|
| `codpar`   | Código del partido                |
| `vot`      | Votos del partido/candidato       |
| `pvot`     | Porcentaje                        |
| `cantotabla[].nomcan` | Nombre del candidato   |
| `cantotabla[].apecan` | Apellido del candidato |
| `cantotabla[].cedula` | Cédula del candidato   |

---

## 6. Notas de parsing (importante)

- **Todos los valores vienen como `string`**, no como número.
- **Porcentajes con coma decimal y símbolo:** `"49,90%"`.
  Para convertir a número:
  ```typescript
  const num = (s: string) => parseFloat(s.replace("%", "").replace(",", "."));
  num("49,90%"); // → 49.9
  ```
- **Detectar boletín nuevo:** comparar el campo `mdhm` (o `numact`) contra el último valor guardado.
- **Candidatos:** recorrer `camaras[0].partotabla[]` y leer cada `cantotabla[0]`.

### Ejemplo: transformar a un array limpio

```typescript
function parseCandidatos(data: any) {
  const num = (s: string) => parseFloat(s.replace("%", "").replace(",", "."));
  const partidos = data?.camaras?.[0]?.partotabla ?? [];

  return partidos
    .map((p: any) => {
      const c = p.act.cantotabla?.[0] ?? {};
      return {
        candidato: `${c.nomcan ?? ""} ${c.apecan ?? ""}`.trim(),
        codpartido: p.act.codpar,
        votos: num(p.act.vot),
        porcentaje: num(p.act.pvot),
      };
    })
    .sort((a, b) => b.votos - a.votos);
}
```

### Ejemplo: detectar y reaccionar a un boletín nuevo

```typescript
let ultimoMdhm: string | null = null;

function procesar(data: any) {
  const t = data.totales.act;
  if (t.mdhm !== ultimoMdhm) {
    ultimoMdhm = t.mdhm;
    console.log(
      `Nuevo boletín ${t.mdhm} | mesas ${t.pmesesc} | participación ${t.pvotant}`
    );
    // TODO: guardar en BD / emitir por websocket / actualizar UI
  }
}
```

---

## 7. Checklist para el programador

- [ ] La petición se hace **del lado del servidor** (Route Handler / Server Component), nunca desde el cliente.
- [ ] Se envían las cabeceras `User-Agent` (de navegador) y `Referer: https://resultados.registraduria.gov.co/`.
- [ ] El front consume el endpoint interno (`/api/resultados`), no la Registraduría directamente.
- [ ] Refresco cada **30 segundos**.
- [ ] Parsear strings → números (quitar `%`, cambiar `,` por `.`).
- [ ] Detectar boletín nuevo comparando `mdhm` / `numact`.
- [ ] Manejar errores (`res.ok === false`) y reintentos suaves.
