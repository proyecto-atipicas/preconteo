import { NextResponse } from "next/server";
import {
  REG_BASE,
  REG_HEADERS,
  Snapshot,
  datosToSnapshot,
  num,
  parseDatos,
  type RawRespuesta,
} from "@/app/lib";

export const dynamic = "force-dynamic";

const CONCURRENCY = 8;

async function fetchJson(url: string): Promise<RawRespuesta | null> {
  try {
    const res = await fetch(url, { headers: REG_HEADERS, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as RawRespuesta;
  } catch {
    return null;
  }
}

/** URL oficial de un avance histórico (boletín N → AV_000N). */
function urlAvance(n: number) {
  const code = `AV_${String(n).padStart(4, "0")}`;
  return `${REG_BASE}/HIST/00/PR/${code}/00.json`;
}

/**
 * Descarga todos los boletines desde el #1 hasta el actual (ACT.numact).
 * Patrón descubierto en la SPA oficial: /json/HIST/00/PR/AV_XXXX/00.json
 */
export async function GET() {
  try {
    const act = await fetchJson(`${REG_BASE}/ACT/PR/00.json`);
    if (!act) {
      return NextResponse.json({ error: "act_unavailable" }, { status: 502 });
    }

    const numact = Math.max(
      0,
      num(act.numact ?? act.totales?.act?.numact ?? "0")
    );

    if (numact === 0) {
      return NextResponse.json({ boletines: [], numact: 0 });
    }

    const boletines: Snapshot[] = [];

    for (let start = 1; start <= numact; start += CONCURRENCY) {
      const end = Math.min(start + CONCURRENCY - 1, numact);
      const batch = await Promise.all(
        Array.from({ length: end - start + 1 }, (_, i) => {
          const n = start + i;
          return fetchJson(urlAvance(n));
        })
      );

      for (const raw of batch) {
        if (!raw) continue;
        boletines.push(datosToSnapshot(parseDatos(raw)));
      }
    }

    boletines.sort((a, b) => a.numact - b.numact);

    // Deduplicar por mdhm por si la API repite datos.
    const seen = new Set<string>();
    const unicos = boletines.filter((s) => {
      if (!s.mdhm || seen.has(s.mdhm)) return false;
      seen.add(s.mdhm);
      return true;
    });

    return NextResponse.json(
      { boletines: unicos, numact, total: unicos.length },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "historico_failed" },
      { status: 502 }
    );
  }
}
