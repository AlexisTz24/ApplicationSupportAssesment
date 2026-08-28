import type { CrearPedidoDto, FilaReporte, Pedido, Producto } from "./types";

// URL base de la API MercadoVerde.
// Configurable por entorno (NEXT_PUBLIC_API_BASE en .env.local); por defecto
// la API de .NET levanta en http://localhost:5080/swagger (ver README de la raíz).
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:5080";

// Cliente HTTP del panel de soporte.
// Centraliza las llamadas a la API para el catálogo, los pedidos y los reportes.
//
// Regla de la casa: una falla de red o un error de la API NUNCA se traga en
// silencio. Estas funciones lanzan un Error con un mensaje entendible y cada
// pantalla decide cómo mostrarlo al agente.

async function procesarRespuesta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // La API devuelve ProblemDetails en errores de negocio (400): se usa su
    // detalle como mensaje. Para el resto se informa el código HTTP.
    let mensaje = `La API respondió con error ${res.status}.`;
    try {
      const cuerpo = await res.json();
      if (cuerpo && typeof cuerpo.Detail === "string") mensaje = cuerpo.Detail;
      else if (cuerpo && typeof cuerpo.detail === "string") mensaje = cuerpo.detail;
    } catch {
      // el cuerpo no era JSON; se conserva el mensaje genérico
    }
    throw new Error(mensaje);
  }
  return (await res.json()) as T;
}

export async function buscarProductos(
  termino: string,
  opciones?: { signal?: AbortSignal }
): Promise<Producto[]> {
  // encodeURIComponent: el término del usuario no puede romper la URL
  // (espacios, &, %, caracteres especiales).
  const res = await fetch(
    `${API_BASE}/api/productos/buscar?termino=${encodeURIComponent(termino)}`,
    { signal: opciones?.signal }
  );
  return procesarRespuesta<Producto[]>(res);
}

export async function crearPedido(dto: CrearPedidoDto): Promise<Pedido> {
  const res = await fetch(`${API_BASE}/api/pedidos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dto),
  });
  return procesarRespuesta<Pedido>(res);
}

export async function obtenerReporteVentas(
  desde: string,
  hasta: string
): Promise<FilaReporte[]> {
  const res = await fetch(
    `${API_BASE}/api/reportes/ventas?desde=${encodeURIComponent(
      desde
    )}&hasta=${encodeURIComponent(hasta)}`
  );
  return procesarRespuesta<FilaReporte[]>(res);
}
