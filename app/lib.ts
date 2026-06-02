// Tipos y utilidades de parseo para la respuesta de la Registraduría.
// Todos los valores llegan como string; aquí los normalizamos a números.

export interface TotalesAct {
  mdhm?: string;
  numact?: string;
  metota?: string;
  mesesc?: string;
  pmesesc?: string;
  centota?: string;
  votant?: string;
  pvotant?: string;
  absten?: string;
  pabsten?: string;
  votval?: string;
  pvotval?: string;
  votblan?: string;
  pvotblan?: string;
  votnul?: string;
  pvotnul?: string;
}

export interface RawRespuesta {
  elec?: string;
  amb?: string;
  numact?: string;
  mdhm?: string;
  totales?: { act?: TotalesAct };
  camaras?: Array<{
    partotabla?: Array<{
      act?: {
        codpar?: string;
        vot?: string;
        pvot?: string;
        cantotabla?: Array<{
          codcan?: string;
          cedula?: string;
          nomcan?: string;
          apecan?: string;
          vot?: string;
          pvot?: string;
          pref?: string;
        }>;
      };
    }>;
  }>;
  error?: string;
}

export interface Candidato {
  id: string;
  nombre: string;
  codpartido: string;
  votos: number;
  porcentaje: number;
}

export interface Resumen {
  mdhm: string;
  numact: number;
  mesasTotales: number;
  mesasEscrutadas: number;
  pctMesas: number;
  censo: number;
  votantes: number;
  pctParticipacion: number;
  abstencion: number;
  pctAbstencion: number;
  votosValidos: number;
  votosBlanco: number;
  votosNulos: number;
  pctValidos: number;
}

export interface Datos {
  resumen: Resumen;
  candidatos: Candidato[];
}

/** Punto del histórico (un boletín/avance). */
export interface Snapshot {
  mdhm: string;
  numact: number;
  hora: string;
  pctMesas: number;
  pctParticipacion: number;
  validos: number;
  blanco: number;
  nulos: number;
  cands: { id: string; nombre: string; porcentaje: number; votos: number }[];
}

export function datosToSnapshot(d: Datos): Snapshot {
  return {
    mdhm: d.resumen.mdhm,
    numact: d.resumen.numact,
    hora: horaDesdeMdhm(d.resumen.mdhm),
    pctMesas: d.resumen.pctMesas,
    pctParticipacion: d.resumen.pctParticipacion,
    validos: d.resumen.votosValidos,
    blanco: d.resumen.votosBlanco,
    nulos: d.resumen.votosNulos,
    cands: d.candidatos.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      porcentaje: c.porcentaje,
      votos: c.votos,
    })),
  };
}

export const REG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Referer: "https://resultados.registraduria.gov.co/",
  Accept: "application/json",
} as const;

export const REG_BASE = "https://resultados.registraduria.gov.co/json";

export interface DepartamentoInfo {
  codigo: string;
  nombre: string;
}

export interface VotoDeptoCandidato {
  id: string;
  nombre: string;
  votos: number;
}

export interface DepartamentoVotos {
  codigo: string;
  nombre: string;
  candidatos: VotoDeptoCandidato[];
  totalValidos: number;
}

export interface DatosDepartamentos {
  candidatos: { id: string; nombre: string }[];
  departamentos: DepartamentoVotos[];
  total: number;
  mdhm?: string;
}

interface NomAmbito {
  co: string;
  n?: string;
  s?: string;
  l: number;
}

/** Lista los 34 departamentos desde nomenclator.json (nivel l=2). */
export function departamentosDesdeNomenclator(nom: {
  amb?: Array<{ ambitos?: NomAmbito[] }>;
}): DepartamentoInfo[] {
  const ambitos = nom?.amb?.[0]?.ambitos ?? [];
  return ambitos
    .filter((a) => a.l === 2 && a.co)
    .map((a) => ({
      codigo: a.co,
      nombre: (a.n || a.s || a.co).trim().toUpperCase(),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export async function fetchRegistraduria<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: REG_HEADERS, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** "49,90%" -> 49.9 | "41.421.973" -> 41421973 */
export function num(s: string | undefined | null): number {
  if (s == null) return 0;
  const limpio = String(s)
    .replace("%", "")
    .trim()
    // separador de miles "." cuando no hay coma decimal
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const v = parseFloat(limpio);
  return Number.isFinite(v) ? v : 0;
}

const fmtCO = new Intl.NumberFormat("es-CO");

/** Formatea enteros al estilo es-CO (41.421.973). */
export function fmtNum(n: number): string {
  return fmtCO.format(Math.round(n));
}

/** Formatea porcentajes (49,9 %). */
export function fmtPct(n: number, decimales = 2): string {
  return `${n.toLocaleString("es-CO", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })}%`;
}

export function parseDatos(raw: RawRespuesta): Datos {
  const t = raw?.totales?.act ?? {};
  const partidos = raw?.camaras?.[0]?.partotabla ?? [];

  const candidatos: Candidato[] = partidos
    .map((p, i) => {
      const act = p.act ?? {};
      const c = act.cantotabla?.[0] ?? {};
      const nombre = `${c.nomcan ?? ""} ${c.apecan ?? ""}`.trim();
      return {
        id: c.cedula || c.codcan || act.codpar || `cand-${i}`,
        nombre: nombre || `Candidato ${i + 1}`,
        codpartido: act.codpar ?? String(i),
        votos: num(act.vot),
        porcentaje: num(act.pvot),
      };
    })
    .filter((c) => c.nombre)
    .sort((a, b) => b.votos - a.votos);

  const resumen: Resumen = {
    mdhm: t.mdhm ?? raw?.mdhm ?? "",
    numact: num(t.numact ?? raw?.numact ?? "0"),
    mesasTotales: num(t.metota),
    mesasEscrutadas: num(t.mesesc),
    pctMesas: num(t.pmesesc),
    censo: num(t.centota),
    votantes: num(t.votant),
    pctParticipacion: num(t.pvotant),
    abstencion: num(t.absten),
    pctAbstencion: num(t.pabsten),
    votosValidos: num(t.votval),
    votosBlanco: num(t.votblan),
    votosNulos: num(t.votnul),
    pctValidos: num(t.pvotval),
  };

  return { resumen, candidatos };
}

/** Convierte "MMDDHHMM" a una hora legible local. */
export function horaDesdeMdhm(mdhm: string): string {
  if (!mdhm || mdhm.length < 8) return "—";
  const mm = mdhm.slice(0, 2);
  const dd = mdhm.slice(2, 4);
  const hh = mdhm.slice(4, 6);
  const mi = mdhm.slice(6, 8);
  return `${dd}/${mm} ${hh}:${mi}`;
}

// Paleta de 8 colores para los candidatos.
export const PALETA = [
  "#5b8cff",
  "#ffd24a",
  "#2fd27a",
  "#ff6b6b",
  "#b07bff",
  "#37d4d4",
  "#ff9f43",
  "#f368e0",
];
