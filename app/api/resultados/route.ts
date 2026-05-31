import { NextResponse } from "next/server";

// Evita cualquier cacheo: el front decide cada cuánto refresca.
export const dynamic = "force-dynamic";

const SOURCE_URL =
  "https://resultados.registraduria.gov.co/json/ACT/PR/00.json";

/**
 * Proxy del lado del servidor hacia la API pública de la Registraduría.
 * CloudFront responde 403 sin las cabeceras User-Agent + Referer, por lo que
 * la petición debe salir desde el servidor (no desde el navegador).
 */
export async function GET() {
  try {
    const res = await fetch(SOURCE_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://resultados.registraduria.gov.co/",
        Accept: "application/json",
      },
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
