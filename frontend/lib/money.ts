// Utilidades de dinero para el panel de soporte.
//
// Finanzas pidió que el panel muestre un "resumen estimado" del pedido ANTES
// de enviarlo, para que el agente de soporte confirme el monto con el cliente.
// La tasa de impuesto debe coincidir con la del backend (IVA 13%).
//
// Importante: el estimado replica EXACTAMENTE el cálculo del backend
// (PedidoService): descuento redondeado al centavo, impuesto del 13% sobre la
// base imponible (subtotal - descuento) también redondeado al centavo. Todo el
// dinero se maneja redondeado a 2 decimales para evitar la basura binaria del
// punto flotante (ej. 149.70000000000002).

export const TASA_IMPUESTO = 0.13;

// Debe coincidir con PedidoService.TopeDescuentoCupon del backend: ningún
// cupón descuenta más de este monto por pedido.
export const TOPE_DESCUENTO_CUPON = 15.0;

export interface LineaResumen {
  precioUnitario: number;
  cantidad: number;
}

// Redondea un monto al centavo (2 decimales).
export function redondearCentavos(monto: number): number {
  return Math.round((monto + Number.EPSILON) * 100) / 100;
}

// Los cálculos internos se hacen en CENTAVOS ENTEROS: la aritmética binaria de
// punto flotante puede caer una fracción por debajo de la mitad de centavo
// (ej. 15.50 × 47% = 7.28499999…) y divergir del backend, que redondea con
// decimal y MidpointRounding.AwayFromZero. Con enteros, Math.round equivale a
// AwayFromZero para montos positivos.
function aCentavos(monto: number): number {
  return Math.round(monto * 100);
}

// Calcula el subtotal del pedido sumando línea por línea.
export function calcularSubtotal(lineas: LineaResumen[]): number {
  let subtotalCent = 0;
  for (const l of lineas) {
    subtotalCent += aCentavos(l.precioUnitario) * l.cantidad;
  }
  return subtotalCent / 100;
}

// Descuento estimado del cupón, con el mismo tope de $15 que aplica el backend.
export function calcularDescuentoEstimado(
  subtotal: number,
  porcentajeCupon: number
): number {
  const subtotalCent = aCentavos(subtotal);
  let descuentoCent = Math.round((subtotalCent * porcentajeCupon) / 100);
  if (descuentoCent < 0) descuentoCent = 0;
  descuentoCent = Math.min(descuentoCent, aCentavos(TOPE_DESCUENTO_CUPON));
  return descuentoCent / 100;
}

// Calcula el total estimado a cobrar, con el mismo orden de operaciones que el
// backend: primero el descuento (topado), luego el impuesto sobre la base con
// descuento. porcentajeCupon llega como número 0..100 (ej. 10 para 10%).
export function calcularTotalEstimado(
  lineas: LineaResumen[],
  porcentajeCupon: number
): number {
  const subtotal = calcularSubtotal(lineas);
  const descuentoCent = aCentavos(calcularDescuentoEstimado(subtotal, porcentajeCupon));
  const baseCent = aCentavos(subtotal) - descuentoCent;
  const impuestoCent = Math.round((baseCent * 13) / 100);
  return (baseCent + impuestoCent) / 100;
}

// Formatea un monto para mostrarlo en la interfaz como moneda.
const formateador = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatearMoneda(monto: number): string {
  return formateador.format(monto);
}
