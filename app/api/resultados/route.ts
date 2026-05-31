import { NextResponse } from "next/server";
import { REG_BASE, REG_HEADERS } from "@/app/lib";

// Evita cualquier cacheo: el front decide cada cuánto refresca.
export const dynamic = "force-dynamic";

const SOURCE_URL = `${REG_BASE}/ACT/PR/00.json`;

/**
 * Proxy del lado del servidor hacia la API pública de la Registraduría.
 * CloudFront responde 403 sin las cabeceras User-Agent + Referer, por lo que
 * la petición debe salir desde el servidor (no desde el navegador).
 */
export async function GET() {
  try {
    const res = await fetch(SOURCE_URL, {
      headers: REG_HEADERS,
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fetch_failed" },
      { status: 502 }
    );
  }
}
