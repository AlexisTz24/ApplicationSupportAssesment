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

export interface LineaResumen {
  precioUnitario: number;
  cantidad: number;
}

// Redondea un monto al centavo (2 decimales).
export function redondearCentavos(monto: number): number {
  return Math.round((monto + Number.EPSILON) * 100) / 100;
}

// Calcula el subtotal del pedido sumando línea por línea.
export function calcularSubtotal(lineas: LineaResumen[]): number {
  let subtotal = 0;
  for (const l of lineas) {
    subtotal += redondearCentavos(l.precioUnitario * l.cantidad);
  }
  return redondearCentavos(subtotal);
}

// Calcula el total estimado a cobrar, con el mismo orden de operaciones que el
// backend: primero el descuento, luego el impuesto sobre la base con descuento.
// porcentajeCupon llega como número 0..100 (ej. 10 para 10%).
export function calcularTotalEstimado(
  lineas: LineaResumen[],
  porcentajeCupon: number
): number {
  const subtotal = calcularSubtotal(lineas);
  const descuento = redondearCentavos(subtotal * (porcentajeCupon / 100));
  const baseImponible = redondearCentavos(subtotal - descuento);
  const impuesto = redondearCentavos(baseImponible * TASA_IMPUESTO);
  return redondearCentavos(baseImponible + impuesto);
}

// Formatea un monto para mostrarlo en la interfaz como moneda.
const formateador = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatearMoneda(monto: number): string {
  return formateador.format(monto);
}
