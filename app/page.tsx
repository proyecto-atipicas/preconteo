"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Candidato,
  Datos,
  PALETA,
  RawRespuesta,
  Snapshot,
  datosToSnapshot,
  fmtNum,
  fmtPct,
  horaDesdeMdhm,
  parseDatos,
} from "./lib";
import { DepartamentosSection } from "./components/DepartamentosSection";

const INTERVALO_S = 15; // refresco automático cada 15 s
type Seccion = "vivo" | "departamentos";
const LS_KEY = "preconteo_hist_pr_2026";
const MAX_HIST = 300;

type Estado = "connecting" | "live" | "paused" | "error";

interface Toast {
  id: number;
  title: string;
  body: string;
  out?: boolean;
}

/* ----------------------------- count-up hook ----------------------------- */
function useCountUp(target: number, duration = 800): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setVal(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setVal(from + (target - from) * e);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return val;
}

function Num({
  value,
  format,
}: {
  value: number;
  format: (n: number) => string;
}) {
  const v = useCountUp(value);
  return <>{format(v)}</>;
}

/* ----------------------------- progress ring ----------------------------- */
function ProgressRing({ pct }: { pct: number }) {
  const r = 27;
  const c = 2 * Math.PI * r;
  const v = useCountUp(pct);
  const offset = c * (1 - Math.min(100, Math.max(0, v)) / 100);
  return (
    <div className="prog-ring">
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle className="track" cx="32" cy="32" r={r} fill="none" strokeWidth="6" />
        <circle
          className="fill"
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="label">{v.toFixed(1)}%</span>
    </div>
  );
}

/* --------------------------- countdown ring ------------------------------ */
function CountdownRing({ seconds }: { seconds: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - seconds / INTERVALO_S);
  return (
    <div className="countdown" title="Próxima actualización">
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle className="track" cx="20" cy="20" r={r} fill="none" strokeWidth="3" />
        <circle
          className="fill"
          cx="20"
          cy="20"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="num tabular">{Math.ceil(seconds)}</span>
    </div>
  );
}

/* -------------------------------- donut ---------------------------------- */
function Donut({
  validos,
  blanco,
  nulos,
}: {
  validos: number;
  blanco: number;
  nulos: number;
}) {
  const total = validos + blanco + nulos;
  const segs = [
    { name: "Válidos", val: validos, color: "var(--verde)" },
    { name: "En blanco", val: blanco, color: "var(--azul)" },
    { name: "Nulos", val: nulos, color: "var(--rojo)" },
  ];

  let acc = 0;
  const stops = segs
    .map((s) => {
      const start = total ? (acc / total) * 360 : 0;
      acc += s.val;
      const end = total ? (acc / total) * 360 : 0;
      return `${s.color} ${start}deg ${end}deg`;
    })
    .join(", ");

  const bg = total
    ? `conic-gradient(${stops})`
    : "conic-gradient(var(--border-strong) 0deg 360deg)";

  return (
    <>
      <div className="donut-wrap">
        <div className="donut" style={{ background: bg }}>
          <div className="hole">
            <div>
              <div className="donut-total tabular">
                <Num value={total} format={fmtNum} />
              </div>
              <div className="donut-cap">Votos totales</div>
            </div>
          </div>
        </div>
      </div>
      <div className="legend">
        {segs.map((s) => (
          <div className="legend-item" key={s.name}>
            <span className="legend-dot" style={{ background: s.color }} />
            <span className="legend-name">{s.name}</span>
            <span className="legend-val tabular">
              {fmtNum(s.val)} · {total ? fmtPct((s.val / total) * 100, 1) : "0%"}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------ sparkline -------------------------------- */
function Sparkline({ data }: { data: number[] }) {
  const W = 280;
  const H = 56;
  const pad = 4;
  if (data.length < 2) {
    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line
          x1={pad}
          y1={H - pad}
          x2={W - pad}
          y2={H - pad}
          stroke="var(--border-strong)"
          strokeWidth="1"
        />
      </svg>
    );
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = (W - pad * 2) / (data.length - 1);
  const pts = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (d - min) / span) * (H - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map((p) => `${p[0]},${p[1]}`).join(" ");
  const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
  const last = pts[pts.length - 1];

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,210,74,0.4)" />
          <stop offset="100%" stopColor="rgba(255,210,74,0)" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#sparkGrad)" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--amarillo)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill="var(--amarillo)" />
    </svg>
  );
}

/* ------------------------------ candidatos ------------------------------- */
function CandidatosLista({
  candidatos,
  selected,
  onSelect,
}: {
  candidatos: Candidato[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const rowsRef = useRef(new Map<string, HTMLElement>());
  const prevPos = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const prev = prevPos.current;
    rowsRef.current.forEach((el, id) => {
      const newTop = el.getBoundingClientRect().top;
      const old = prev.get(id);
      if (old !== undefined) {
        const dy = old - newTop;
        if (Math.abs(dy) > 0.5) {
          el.style.transition = "none";
          el.style.transform = `translateY(${dy}px)`;
          requestAnimationFrame(() => {
            el.style.transition = "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)";
            el.style.transform = "";
          });
        }
      }
    });
    const np = new Map<string, number>();
    rowsRef.current.forEach((el, id) => np.set(id, el.getBoundingClientRect().top));
    prevPos.current = np;
  }, [candidatos]);

  const medalClass = (i: number) =>
    i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";

  return (
    <div className="cand-list">
      {candidatos.map((c, i) => {
        const isSel = selected === c.id;
        const dim = selected !== null && !isSel;
        return (
          <div
            className={`cand ${isSel ? "selected" : ""} ${dim ? "dim" : ""}`}
            key={c.id}
            onClick={() => onSelect(c.id)}
            ref={(el) => {
              if (el) rowsRef.current.set(c.id, el);
              else rowsRef.current.delete(c.id);
            }}
          >
            <div className={`medal ${medalClass(i)}`}>{i + 1}</div>
            <div className="cand-main">
              <div className="cand-row1">
                <span className="cand-name">{c.nombre}</span>
                <span className="cand-pct tabular">
                  <Num value={c.porcentaje} format={(n) => fmtPct(n, 2)} />
                </span>
              </div>
              <div className="bar">
                <div
                  className="bar-fill"
                  style={{
                    width: `${Math.min(100, c.porcentaje)}%`,
                    background: PALETA[i % PALETA.length],
                  }}
                />
              </div>
            </div>
            <div className="cand-votes tabular">{fmtNum(c.votos)} votos</div>
          </div>
        );
      })}
    </div>
  );
}

function Skeletons() {
  return (
    <div className="cand-list">
      {Array.from({ length: 6 }).map((_, i) => (
        <div className="cand" key={i}>
          <div className="skel" style={{ width: 26, height: 26 }} />
          <div className="cand-main">
            <div className="cand-row1">
              <span className="skel" style={{ width: "45%", height: 12 }} />
              <span className="skel" style={{ width: 44, height: 12 }} />
            </div>
            <div className="skel" style={{ height: 8 }} />
          </div>
          <div className="skel" style={{ width: 60, height: 12 }} />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ line chart ------------------------------- */
interface Serie {
  id: string;
  name: string;
  color: string;
  values: (number | null)[];
}

function niceMax(v: number) {
  if (v <= 0) return 10;
  const step = v <= 20 ? 5 : v <= 50 ? 10 : 20;
  return Math.ceil(v / step) * step;
}

const HM = (mins: number) => {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

function LineChart({
  series,
  xVals,
  xHoras,
  start,
  highlight,
}: {
  series: Serie[];
  xVals: number[]; // minutos desde medianoche de cada boletín
  xHoras: string[];
  start: number; // minuto de inicio del análisis (16:00 = 960)
  highlight: string | null;
}) {
  const W = 940;
  const H = 440;
  const padL = 50;
  const padR = 56;
  const padT = 20;
  const padB = 46;
  const n = xVals.length;
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const maxVal = niceMax(
    Math.max(
      1,
      ...series.flatMap((s) => s.values.filter((v): v is number => v != null))
    )
  );

  const maxX = Math.max(start + 30, ...xVals);
  const dmax = maxX + Math.max(10, (maxX - start) * 0.1);

  const x = (mins: number) =>
    padL + ((mins - start) / (dmax - start)) * (W - padL - padR);
  const y = (v: number) => H - padB - (v / maxVal) * (H - padT - padB);

  // Líneas horizontales (%)
  const yTicks = 5;
  const gridLines = Array.from({ length: yTicks + 1 }, (_, k) => {
    const val = (maxVal / yTicks) * k;
    return { val, yy: y(val) };
  });

  // Marcas de tiempo en el eje X
  const totalMin = dmax - start;
  const tStep =
    totalMin <= 90 ? 15 : totalMin <= 180 ? 30 : totalMin <= 420 ? 60 : 120;
  const xTicks: number[] = [];
  for (let t = start; t <= dmax + 0.5; t += tStep) xTicks.push(t);

  function pathFor(s: Serie) {
    let d = "";
    let pen = false;
    s.values.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(xVals[i])},${y(v)} `;
      pen = true;
    });
    return d.trim();
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(xVals[i]) - svgX);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHover(best);
  }

  // Etiquetas de valor al final de cada línea, evitando solapamientos.
  type Lab = { id: string; color: string; text: string; y: number; xp: number };
  const endLabels: Lab[] = series
    .map((s) => {
      let li = -1;
      for (let i = s.values.length - 1; i >= 0; i--) {
        if (s.values[i] != null) {
          li = i;
          break;
        }
      }
      if (li < 0) return null;
      const val = s.values[li] as number;
      return {
        id: s.id,
        color: s.color,
        text: `${val.toFixed(1)}%`,
        y: y(val),
        xp: x(xVals[li]),
      };
    })
    .filter((l): l is Lab => l !== null)
    .sort((a, b) => a.y - b.y);
  const gap = 15;
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i].y - endLabels[i - 1].y < gap)
      endLabels[i].y = endLabels[i - 1].y + gap;
  }

  const hoverVals =
    hover != null
      ? series
          .map((s) => ({ s, v: s.values[hover] }))
          .filter((o) => o.v != null)
          .sort((a, b) => (b.v as number) - (a.v as number))
      : [];

  const boxW = 196;
  const boxH = 24 + hoverVals.length * 17;
  const hoverX = hover != null ? x(xVals[hover]) : 0;
  const boxX =
    hover != null && hoverX > W - boxW - 20 ? hoverX - boxW - 10 : hoverX + 10;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      {/* grid horizontal (%) */}
      {gridLines.map((g, k) => (
        <g key={k}>
          <line
            x1={padL}
            y1={g.yy}
            x2={W - padR}
            y2={g.yy}
            stroke="rgba(255,255,255,0.07)"
            strokeWidth="1"
          />
          <text x={padL - 9} y={g.yy + 4} fontSize="12" fill="#8b93b8" textAnchor="end">
            {g.val.toFixed(0)}%
          </text>
        </g>
      ))}

      {/* marcas de tiempo (eje X) */}
      {xTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={x(t)}
            y1={padT}
            x2={x(t)}
            y2={H - padB}
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="1"
          />
          <text x={x(t)} y={H - padB + 19} fontSize="12" fill="#8b93b8" textAnchor="middle">
            {HM(t)}
          </text>
        </g>
      ))}

      {/* línea de inicio (4:00 p.m.) */}
      <line
        x1={x(start)}
        y1={padT}
        x2={x(start)}
        y2={H - padB}
        stroke="rgba(255,210,74,0.45)"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
      <text
        x={x(start) + 6}
        y={padT + 13}
        fontSize="11"
        fill="var(--amarillo)"
        fontWeight="700"
      >
        Inicio 16:00
      </text>

      {/* series */}
      {series.map((s) => {
        const dim = highlight != null && highlight !== s.id;
        return (
          <g key={s.id} style={{ opacity: dim ? 0.25 : 1 }}>
            <path
              d={pathFor(s)}
              fill="none"
              stroke={s.color}
              strokeWidth={highlight === s.id ? 3.6 : 2.4}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.values.map((v, i) =>
              v != null ? (
                <circle
                  key={i}
                  cx={x(xVals[i])}
                  cy={y(v)}
                  r={i === s.values.length - 1 ? 4 : 2.6}
                  fill={s.color}
                />
              ) : null
            )}
          </g>
        );
      })}

      {/* etiquetas de valor al final de cada línea */}
      {endLabels.map((l) => {
        const dim = highlight != null && highlight !== l.id;
        return (
          <text
            key={l.id}
            x={l.xp + 8}
            y={Math.max(padT + 4, l.y + 4)}
            fontSize="12"
            fontWeight="800"
            fill={l.color}
            opacity={dim ? 0.3 : 1}
          >
            {l.text}
          </text>
        );
      })}

      {/* hover */}
      {hover != null && (
        <g>
          <line
            x1={hoverX}
            y1={padT}
            x2={hoverX}
            y2={H - padB}
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          {series.map((s) =>
            s.values[hover] != null ? (
              <circle
                key={s.id}
                cx={hoverX}
                cy={y(s.values[hover] as number)}
                r="4"
                fill={s.color}
                stroke="#0a0e1c"
                strokeWidth="1.5"
              />
            ) : null
          )}
          <rect
            x={boxX}
            y={padT}
            width={boxW}
            height={boxH}
            rx="10"
            fill="#05070f"
            stroke="rgba(255,255,255,0.16)"
          />
          <text x={boxX + 12} y={padT + 17} fontSize="12" fill="#e7ecff" fontWeight="700">
            {xHoras[hover]}
          </text>
          {hoverVals.map((o, k) => (
            <g key={o.s.id}>
              <rect
                x={boxX + 12}
                y={padT + 28 + k * 17}
                width="9"
                height="9"
                rx="2"
                fill={o.s.color}
              />
              <text x={boxX + 27} y={padT + 36 + k * 17} fontSize="11" fill="#c7cdec">
                {o.s.name.length > 17 ? o.s.name.slice(0, 16) + "…" : o.s.name}
              </text>
              <text
                x={boxX + boxW - 12}
                y={padT + 36 + k * 17}
                fontSize="11"
                fill="#fff"
                fontWeight="700"
                textAnchor="end"
              >
                {(o.v as number).toFixed(2)}%
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

/* ----------------------------- modal histórico --------------------------- */
function Historico({
  historial,
  loading,
  onClose,
  onClear,
}: {
  historial: Snapshot[];
  loading: boolean;
  onClose: () => void;
  onClear: () => void;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hi, setHi] = useState<string | null>(null);

  const last = historial[historial.length - 1];
  const first = historial[0];

  // Top candidatos según el último boletín.
  const topCands = useMemo(() => {
    if (!last) return [];
    return [...last.cands].sort((a, b) => b.porcentaje - a.porcentaje).slice(0, 6);
  }, [last]);

  const series: Serie[] = topCands
    .map((c, i) => ({
      id: c.id,
      name: c.nombre,
      color: PALETA[i % PALETA.length],
      values: historial.map(
        (s) => s.cands.find((x) => x.id === c.id)?.porcentaje ?? null
      ),
    }))
    .filter((s) => !hidden.has(s.id));

  // Inicio del análisis: 4:00 p.m. (cierre de urnas) = 960 minutos.
  const START_MIN = 16 * 60;
  const minutosDe = (hora: string) => {
    const m = hora.match(/(\d{2}):(\d{2})\s*$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : START_MIN;
  };
  const xVals = historial.map((s) => minutosDe(s.hora));
  const xHoras = historial.map((s) => s.hora);

  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">📈 Histórico de la jornada</div>
            <div className="modal-sub">
              Evolución del porcentaje de cada candidato a lo largo del tiempo. El
              análisis arranca a las 4:00 p.m. (cierre de urnas, 31 may) y avanza
              hasta el dato más reciente.
            </div>
          </div>
          <div className="modal-actions">
            <button className="icon-btn danger" onClick={onClear} title="Borrar historial">
              Limpiar
            </button>
            <button className="icon-btn" onClick={onClose}>
              Cerrar ✕
            </button>
          </div>
        </div>

        {loading ? (
          <div className="empty-hist">
            Cargando todos los boletines desde el inicio de la jornada…
            <br />
            <span style={{ opacity: 0.7, fontSize: 12 }}>
              Consultando avances AV_0001 → actual en la Registraduría
            </span>
          </div>
        ) : historial.length === 0 ? (
          <div className="empty-hist">
            No se pudieron cargar los boletines históricos.
            <br />
            Reintenta recargando la página.
          </div>
        ) : (
          <>
            <div className="modal-stats">
              <div className="mstat">
                <div className="mstat-label">Boletines registrados</div>
                <div className="mstat-val tabular">{historial.length}</div>
              </div>
              <div className="mstat">
                <div className="mstat-label">Rango horario</div>
                <div className="mstat-val">
                  16:00 <small>(inicio) → {last.hora}</small>
                </div>
              </div>
              <div className="mstat">
                <div className="mstat-label">Mesas escrutadas</div>
                <div className="mstat-val tabular">
                  {fmtPct(first.pctMesas, 1)}{" "}
                  <small>→ {fmtPct(last.pctMesas, 1)}</small>
                </div>
              </div>
              <div className="mstat">
                <div className="mstat-label">Participación</div>
                <div className="mstat-val tabular">
                  {fmtPct(first.pctParticipacion, 1)}{" "}
                  <small>→ {fmtPct(last.pctParticipacion, 1)}</small>
                </div>
              </div>
            </div>

            <div className="modal-body">
              <div className="chart-wrap">
                <LineChart
                  series={series}
                  xVals={xVals}
                  xHoras={xHoras}
                  start={START_MIN}
                  highlight={hi}
                />
              </div>
              <div className="chart-legend">
                {topCands.map((c, i) => (
                  <span
                    key={c.id}
                    className={`chip ${hidden.has(c.id) ? "off" : ""}`}
                    onClick={() => toggle(c.id)}
                    onMouseEnter={() => setHi(c.id)}
                    onMouseLeave={() => setHi(null)}
                  >
                    <span
                      className="chip-dot"
                      style={{ background: PALETA[i % PALETA.length] }}
                    />
                    {c.nombre}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ================================ PAGE ================================== */
export default function Home() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [estado, setEstado] = useState<Estado>("connecting");
  const [statusText, setStatusText] = useState("Conectando…");
  const [lastUpdate, setLastUpdate] = useState<string>("—");
  const [secondsLeft, setSecondsLeft] = useState(INTERVALO_S);
  const [paused, setPaused] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [flash, setFlash] = useState(false);
  const [bump, setBump] = useState(false);
  const [spin, setSpin] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const [historial, setHistorial] = useState<Snapshot[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [showHist, setShowHist] = useState(false);
  const [seccion, setSeccion] = useState<Seccion>("vivo");

  const lastMdhm = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const toastId = useRef(0);

  const guardarHistorial = useCallback((snaps: Snapshot[]) => {
    setHistorial(snaps);
    setHistory(snaps.map((s) => s.pctParticipacion).slice(-30));
    const last = snaps[snaps.length - 1];
    if (last?.mdhm) lastMdhm.current = last.mdhm;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(snaps));
    } catch {
      /* ignore */
    }
  }, []);

  // Al recargar: trae TODOS los boletines desde el #1 vía API HIST oficial.
  useEffect(() => {
    let cancelled = false;

    const cargarHistoricoCompleto = async () => {
      setHistLoading(true);
      try {
        const r = await fetch("/api/historico", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        const boletines: Snapshot[] = json.boletines ?? [];
        if (cancelled) return;
        if (boletines.length) {
          guardarHistorial(boletines);
        }
      } catch {
        if (cancelled) return;
        try {
          const raw = localStorage.getItem(LS_KEY);
          if (raw) {
            const parsed: Snapshot[] = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length) guardarHistorial(parsed);
          }
        } catch {
          /* ignore */
        }
      } finally {
        if (!cancelled) setHistLoading(false);
      }
    };

    cargarHistoricoCompleto();
    return () => {
      cancelled = true;
    };
  }, [guardarHistorial]);

  const pushToast = useCallback((title: string, body: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, title, body }]);
    setTimeout(
      () => setToasts((t) => t.map((x) => (x.id === id ? { ...x, out: true } : x))),
      4600
    );
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/resultados", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json: RawRespuesta = await r.json();
      if (json.error) throw new Error(json.error);

      const d = parseDatos(json);
      setDatos(d);
      setLastUpdate(horaDesdeMdhm(d.resumen.mdhm));

      const esNuevo = !!d.resumen.mdhm && d.resumen.mdhm !== lastMdhm.current;
      const primera = lastMdhm.current === null;
      if (esNuevo) lastMdhm.current = d.resumen.mdhm;

      setEstado("live");

      if (esNuevo) {
        const snap = datosToSnapshot(d);
        setHistorial((prev) => {
          if (prev.some((s) => s.mdhm === snap.mdhm)) {
            setHistory(prev.map((s) => s.pctParticipacion).slice(-30));
            return prev;
          }
          const next = [...prev, snap].slice(-MAX_HIST);
          setHistory(next.map((s) => s.pctParticipacion).slice(-30));
          try {
            localStorage.setItem(LS_KEY, JSON.stringify(next));
          } catch {
            /* ignore */
          }
          return next;
        });
      }

      if (primera) {
        setStatusText("En vivo");
        pushToast(
          "Conectado",
          `En vivo · ${fmtPct(d.resumen.pctMesas)} de mesas escrutadas`
        );
      } else if (esNuevo) {
        setStatusText("Nuevo boletín recibido");
        setFlash(false);
        setBump(false);
        requestAnimationFrame(() => {
          setFlash(true);
          setBump(true);
        });
        setTimeout(() => setStatusText("En vivo"), 2500);
        pushToast(
          `Boletín #${d.resumen.numact}`,
          `Mesas ${fmtPct(d.resumen.pctMesas)} · Participación ${fmtPct(
            d.resumen.pctParticipacion
          )}`
        );
      } else {
        setStatusText("En vivo");
      }
    } catch {
      setEstado("error");
      setStatusText("Sin conexión, reintentando…");
    }
  }, [pushToast]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    const id = setInterval(() => {
      if (pausedRef.current) return;
      setSecondsLeft((s) => {
        if (s <= 1) {
          cargar();
          return INTERVALO_S;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [cargar]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => {
    if (!bump) return;
    const t = setTimeout(() => setBump(false), 600);
    return () => clearTimeout(t);
  }, [bump]);

  // Cerrar modal con Escape.
  useEffect(() => {
    if (!showHist) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShowHist(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHist]);

  const refrescar = (e: React.MouseEvent<HTMLButtonElement>) => {
    ripple(e);
    setSpin(false);
    requestAnimationFrame(() => setSpin(true));
    setSecondsLeft(INTERVALO_S);
    cargar();
  };

  const togglePausa = (e: React.MouseEvent<HTMLButtonElement>) => {
    ripple(e);
    setPaused((p) => {
      const np = !p;
      pausedRef.current = np;
      if (np) {
        setEstado("paused");
        setStatusText("En pausa");
      } else {
        setEstado("live");
        setStatusText("En vivo");
        setSecondsLeft(INTERVALO_S);
      }
      return np;
    });
  };

  const limpiarHist = () => {
    setHistorial([]);
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  };

  const dotClass = estado === "live" ? "live" : estado === "error" ? "error" : "warn";
  const r = datos?.resumen;

  return (
    <div className="shell">
      {/* ---------------- TOPBAR ---------------- */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <div>
            <div className="brand-title">Elecciones Presidenciales 2026</div>
            <div className="brand-sub">
              Resultados en tiempo real · Colombia (nacional)
            </div>
          </div>
        </div>

        <div className="controls">
          <div className="status">
            <div className="status-line">
              <span className={`status-dot ${dotClass}`} />
              {statusText}
            </div>
            <div className="status-time">Actualizado: {lastUpdate}</div>
          </div>

          <button
            className={`btn ${showHist ? "active" : ""}`}
            onClick={(e) => {
              ripple(e);
              setShowHist((v) => !v);
            }}
            title="Ver evolución histórica"
          >
            📈 Histórico
          </button>

          <button className="btn" onClick={refrescar} title="Refrescar ahora" aria-label="Refrescar">
            <span className={`btn-icon ${spin ? "spin" : ""}`}>↻</span>
          </button>

          <button
            className={`btn ${paused ? "paused" : ""}`}
            onClick={togglePausa}
            title={paused ? "Reanudar" : "Pausar"}
            aria-label={paused ? "Reanudar" : "Pausar"}
          >
            {paused ? "▶" : "⏸"}
          </button>

          <CountdownRing seconds={paused ? INTERVALO_S : secondsLeft} />
        </div>
      </header>

      <nav className="nav-tabs" aria-label="Secciones">
        <button
          type="button"
          className={`nav-tab ${seccion === "vivo" ? "active" : ""}`}
          onClick={() => setSeccion("vivo")}
        >
          En vivo
        </button>
        <button
          type="button"
          className={`nav-tab ${seccion === "departamentos" ? "active" : ""}`}
          onClick={() => setSeccion("departamentos")}
        >
          Por departamento
        </button>
      </nav>

      {seccion === "departamentos" ? (
        <DepartamentosSection />
      ) : (
        <>
      {/* ---------------- CARDS ---------------- */}
      <section className="cards">
        <div className={`card ${flash ? "flash" : ""}`} data-tip="Mesas con escrutinio reportado">
          <div className="card-top">
            <span className="card-icon">🗳️</span>
            <span className="card-label">Mesas escrutadas</span>
          </div>
          <div className="card-body">
            <ProgressRing pct={r?.pctMesas ?? 0} />
            <div>
              <div className="card-value tabular" style={{ fontSize: 18 }}>
                <Num value={r?.mesasEscrutadas ?? 0} format={fmtNum} />
              </div>
              <div className="card-meta">de {fmtNum(r?.mesasTotales ?? 0)} mesas</div>
            </div>
          </div>
        </div>

        <div className={`card ${flash ? "flash" : ""}`} data-tip="Votantes sobre el censo electoral">
          <div className="card-top">
            <span className="card-icon">👥</span>
            <span className="card-label">Participación</span>
          </div>
          <div className="card-body">
            <div className="card-value tabular">
              <Num value={r?.pctParticipacion ?? 0} format={(n) => fmtPct(n)} />
            </div>
          </div>
          <div className="card-meta">
            <Num value={r?.votantes ?? 0} format={fmtNum} /> votantes
          </div>
        </div>

        <div className={`card ${flash ? "flash" : ""}`} data-tip="Ciudadanos habilitados para votar">
          <div className="card-top">
            <span className="card-icon">📋</span>
            <span className="card-label">Censo electoral</span>
          </div>
          <div className="card-body">
            <div className="card-value tabular">
              <Num value={r?.censo ?? 0} format={fmtNum} />
            </div>
          </div>
          <div className="card-meta">Abstención {fmtPct(r?.pctAbstencion ?? 0)}</div>
        </div>

        <div className={`card ${flash ? "flash" : ""}`} data-tip="Votos válidos a candidatos">
          <div className="card-top">
            <span className="card-icon">✅</span>
            <span className="card-label">Votos válidos</span>
          </div>
          <div className="card-body">
            <div className="card-value tabular">
              <Num value={r?.votosValidos ?? 0} format={fmtNum} />
            </div>
          </div>
          <div className="card-meta">
            Blancos {fmtNum(r?.votosBlanco ?? 0)} · Nulos {fmtNum(r?.votosNulos ?? 0)}
          </div>
        </div>
      </section>

      {/* ---------------- GRID ---------------- */}
      <section className="grid">
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Candidatos</span>
            <div className={`boletin ${bump ? "bump" : ""}`} title="Número de boletín / avance">
              <span className="boletin-cap">Boletín</span>
              <span className="boletin-num tabular">
                <Num value={r?.numact ?? 0} format={(n) => String(Math.round(n))} />
              </span>
            </div>
          </div>
          {datos ? (
            <CandidatosLista
              candidatos={datos.candidatos}
              selected={selected}
              onSelect={(id) => setSelected((s) => (s === id ? null : id))}
            />
          ) : (
            <Skeletons />
          )}
        </div>

        <div className="panel right-panel">
          <div className="panel-head">
            <span className="panel-title">Composición del voto</span>
          </div>
          <Donut
            validos={r?.votosValidos ?? 0}
            blanco={r?.votosBlanco ?? 0}
            nulos={r?.votosNulos ?? 0}
          />
          <div className="spark">
            <div className="spark-head">
              <span className="spark-label">Tendencia de participación</span>
              <span className="spark-val tabular">{fmtPct(r?.pctParticipacion ?? 0)}</span>
            </div>
            <Sparkline data={history} />
          </div>
        </div>
      </section>
        </>
      )}

      {/* ---------------- FOOTER ---------------- */}
      <footer className="footer">
        <span>Fuente: Registraduría Nacional del Estado Civil · API pública</span>
        <span>
          Refresco cada {INTERVALO_S} s ·{" "}
          {seccion === "departamentos"
            ? "Votos por departamento · Registraduría"
            : histLoading
              ? "Cargando historial completo…"
              : `${historial.length} boletines (desde #1)`}
        </span>
      </footer>

      {/* ---------------- TOASTS ---------------- */}
      <div className="toasts">
        {toasts.map((t) => (
          <div className={`toast ${t.out ? "out" : ""}`} key={t.id}>
            <div className="toast-title">{t.title}</div>
            <div className="toast-body">{t.body}</div>
          </div>
        ))}
      </div>

      {/* ---------------- MODAL HISTÓRICO ---------------- */}
      {showHist && (
        <Historico
          historial={historial}
          loading={histLoading}
          onClose={() => setShowHist(false)}
          onClear={limpiarHist}
        />
      )}
    </div>
  );
}

/* Efecto ripple en los botones. */
function ripple(e: React.MouseEvent<HTMLButtonElement>) {
  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const span = document.createElement("span");
  span.className = "ripple";
  span.style.width = span.style.height = `${size}px`;
  span.style.left = `${e.clientX - rect.left - size / 2}px`;
  span.style.top = `${e.clientY - rect.top - size / 2}px`;
  btn.appendChild(span);
  setTimeout(() => span.remove(), 600);
}
