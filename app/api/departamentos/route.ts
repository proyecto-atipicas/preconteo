import { NextResponse } from "next/server";
import {
  REG_BASE,
  departamentosDesdeNomenclator,
  fetchRegistraduria,
  parseDatos,
  type RawRespuesta,
} from "@/app/lib";

export const dynamic = "force-dynamic";

const CONCURRENCY = 6;

/**
 * Votos por candidato en cada departamento (ACT/PR/{código}.json).
 * Catálogo de deptos: nomenclator.json → ambitos con l=2.
 */
export async function GET() {
  try {
    const nom = await fetchRegistraduria<{
      amb?: Array<{ ambitos?: { co: string; n?: string; s?: string; l: number }[] }>;
    }>(`${REG_BASE}/nomenclator.json`);

    const depts = departamentosDesdeNomenclator(nom ?? {});
    if (!depts.length) {
      return NextResponse.json({ error: "no_departments" }, { status: 502 });
    }

    const nacional = await fetchRegistraduria<RawRespuesta>(
      `${REG_BASE}/ACT/PR/00.json`
    );
    const ordenCands = nacional ? parseDatos(nacional).candidatos : [];

    const departamentos: {
      codigo: string;
      nombre: string;
      candidatos: { id: string; nombre: string; votos: number }[];
      totalValidos: number;
    }[] = [];

    for (let i = 0; i < depts.length; i += CONCURRENCY) {
      const batch = depts.slice(i, i + CONCURRENCY);
      const fetched = await Promise.all(
        batch.map(async (d) => {
          const raw = await fetchRegistraduria<RawRespuesta>(
            `${REG_BASE}/ACT/PR/${d.codigo}.json`
          );
          if (!raw) return null;
          const parsed = parseDatos(raw);
          return {
            codigo: d.codigo,
            nombre: d.nombre,
            candidatos: parsed.candidatos.map((c) => ({
              id: c.id,
              nombre: c.nombre,
              votos: c.votos,
            })),
            totalValidos: parsed.resumen.votosValidos,
          };
        })
      );
      for (const row of fetched) {
        if (row) departamentos.push(row);
      }
    }

    departamentos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    const candidatos = ordenCands.map((c) => ({ id: c.id, nombre: c.nombre }));

    return NextResponse.json(
      {
        candidatos,
        departamentos,
        total: departamentos.length,
        mdhm: nacional?.mdhm ?? nacional?.totales?.act?.mdhm,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "departamentos_failed" },
      { status: 502 }
    );
  }
}
