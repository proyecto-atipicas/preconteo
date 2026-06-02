"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DatosDepartamentos,
  DepartamentoVotos,
  PALETA,
  fmtNum,
  horaDesdeMdhm,
} from "../lib";

type SortKey = "nombre" | "total" | string;

export function DepartamentosSection({
  onRefresh,
}: {
  onRefresh?: () => void;
}) {
  const [data, setData] = useState<DatosDepartamentos | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("nombre");
  const [sortAsc, setSortAsc] = useState(true);
  const [highlight, setHighlight] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/departamentos", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json: DatosDepartamentos = await r.json();
      if (!json.departamentos?.length) throw new Error("Sin datos");
      setData(json);
      onRefresh?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const candidatos = data?.candidatos ?? [];

  const filas = useMemo(() => {
    if (!data) return [];
    let rows = [...data.departamentos];
    const q = busqueda.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (d) =>
          d.nombre.toLowerCase().includes(q) ||
          d.codigo.includes(q)
      );
    }
    rows.sort((a, b) => {
      let va: number | string;
      let vb: number | string;
      if (sortKey === "nombre") {
        va = a.nombre;
        vb = b.nombre;
      } else if (sortKey === "total") {
        va = a.totalValidos;
        vb = b.totalValidos;
      } else {
        va = a.candidatos.find((c) => c.id === sortKey)?.votos ?? 0;
        vb = b.candidatos.find((c) => c.id === sortKey)?.votos ?? 0;
      }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
    return rows;
  }, [data, busqueda, sortKey, sortAsc]);

  const maxVoto = useMemo(() => {
    if (!data) return 1;
    let m = 1;
    for (const d of data.departamentos) {
      for (const c of d.candidatos) {
        if (c.votos > m) m = c.votos;
      }
    }
    return m;
  }, [data]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((s) => !s);
    else {
      setSortKey(key);
      setSortAsc(key === "nombre");
    }
  };

  const totalesPorCand = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of candidatos) map.set(c.id, 0);
    for (const d of data?.departamentos ?? []) {
      for (const c of d.candidatos) {
        map.set(c.id, (map.get(c.id) ?? 0) + c.votos);
      }
    }
    return map;
  }, [data, candidatos]);

  const descargarCsv = () => {
    if (!data) return;
    const csv = generarCsv(data, filas);
    const stamp = data.mdhm
      ? data.mdhm.slice(0, 4)
      : new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const nombre = busqueda.trim()
      ? `votos-departamentos-filtrado-${stamp}.csv`
      : `votos-departamentos-${stamp}.csv`;
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <section className="dept-section">
        <div className="dept-loading">
          <span className="dept-spinner" />
          Cargando votos por departamento (34 departamentos)…
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="dept-section">
        <div className="dept-error">
          {error ?? "No hay datos"}
          <button type="button" className="icon-btn" onClick={cargar}>
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="dept-section">
      <div className="dept-toolbar">
        <div>
          <h2 className="dept-title">Votos por departamento</h2>
          <p className="dept-sub">
            Total de votos válidos por candidato en cada departamento ·{" "}
            {data.total} departamentos
            {data.mdhm ? ` · ${horaDesdeMdhm(data.mdhm)}` : ""}
          </p>
        </div>
        <div className="dept-toolbar-right">
          <input
            type="search"
            className="dept-search"
            placeholder="Buscar departamento…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <button
            type="button"
            className="icon-btn"
            onClick={descargarCsv}
            title="Descargar tabla en CSV"
          >
            ⬇ CSV
          </button>
          <button type="button" className="icon-btn" onClick={cargar} title="Actualizar">
            ↻ Actualizar
          </button>
        </div>
      </div>

      <div className="dept-table-wrap">
        <table className="dept-table">
          <thead>
            <tr>
              <th
                className="dept-th-sticky sortable"
                onClick={() => toggleSort("nombre")}
              >
                Departamento {sortKey === "nombre" ? (sortAsc ? "↑" : "↓") : ""}
              </th>
              <th
                className="dept-th-num sortable"
                onClick={() => toggleSort("total")}
              >
                Total válidos {sortKey === "total" ? (sortAsc ? "↑" : "↓") : ""}
              </th>
              {candidatos.map((c, i) => (
                <th
                  key={c.id}
                  className={`dept-th-cand sortable ${highlight === c.id ? "hi" : ""}`}
                  onClick={() => toggleSort(c.id)}
                  onMouseEnter={() => setHighlight(c.id)}
                  onMouseLeave={() => setHighlight(null)}
                >
                  <span
                    className="dept-cand-dot"
                    style={{ background: PALETA[i % PALETA.length] }}
                  />
                  <span className="dept-cand-name" title={c.nombre}>
                    {acortarNombre(c.nombre)}
                  </span>
                  {sortKey === c.id ? (sortAsc ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((d) => (
              <tr key={d.codigo}>
                <td className="dept-td-sticky">
                  <span className="dept-name">{d.nombre}</span>
                  <span className="dept-code">{d.codigo}</span>
                </td>
                <td className="dept-td-num tabular">{fmtNum(d.totalValidos)}</td>
                {candidatos.map((c) => {
                  const v =
                    d.candidatos.find((x) => x.id === c.id)?.votos ?? 0;
                  const intensity = v / maxVoto;
                  const dim = highlight != null && highlight !== c.id;
                  return (
                    <td
                      key={c.id}
                      className={`dept-td-voto tabular ${dim ? "dim" : ""}`}
                      style={{
                        background: `rgba(91, 140, 255, ${intensity * 0.35})`,
                      }}
                      title={`${c.nombre}: ${fmtNum(v)} votos`}
                    >
                      {v > 0 ? fmtNum(v) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="dept-td-sticky dept-foot">Total Colombia</td>
              <td className="dept-td-num tabular dept-foot">
                {fmtNum(
                  data.departamentos.reduce((s, d) => s + d.totalValidos, 0)
                )}
              </td>
              {candidatos.map((c) => (
                <td key={c.id} className="dept-td-voto tabular dept-foot">
                  {fmtNum(totalesPorCand.get(c.id) ?? 0)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {filas.length === 0 && (
        <p className="dept-empty">Ningún departamento coincide con la búsqueda.</p>
      )}
    </section>
  );
}

function acortarNombre(n: string): string {
  const parts = n.trim().split(/\s+/);
  if (parts.length <= 2) return n;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function escapeCsv(val: string | number): string {
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Genera CSV con las mismas filas visibles en la tabla (+ fila de totales). */
function generarCsv(
  data: DatosDepartamentos,
  filas: DepartamentoVotos[]
): string {
  const cands = data.candidatos;
  const header = [
    "codigo",
    "departamento",
    "total_validos",
    ...cands.map((c) => c.nombre),
  ];
  const lines: string[] = [header.map(escapeCsv).join(",")];

  for (const d of filas) {
    const row = [
      d.codigo,
      d.nombre,
      d.totalValidos,
      ...cands.map(
        (c) => d.candidatos.find((x) => x.id === c.id)?.votos ?? 0
      ),
    ];
    lines.push(row.map(escapeCsv).join(","));
  }

  const totalValidos = filas.reduce((s, d) => s + d.totalValidos, 0);
  const footer = [
    "",
    "TOTAL_COLOMBIA",
    totalValidos,
    ...cands.map((c) =>
      filas.reduce(
        (s, d) => s + (d.candidatos.find((x) => x.id === c.id)?.votos ?? 0),
        0
      )
    ),
  ];
  lines.push(footer.map(escapeCsv).join(","));

  return lines.join("\r\n");
}
