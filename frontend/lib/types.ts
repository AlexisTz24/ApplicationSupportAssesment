// Tipos que reflejan los contratos del backend MercadoVerde.Api.
// (Ver src/MercadoVerde.Api/Models/Modelos.cs)

export interface Producto {
  Id: number;
  Nombre: string;
  Precio: number;
  Stock: number;
  Activo: boolean;
}

export interface LineaPedidoDto {
  ProductoId: number;
  Cantidad: number;
}

export interface CrearPedidoDto {
  ClienteId: number;
  CodigoCupon?: string | null;
  Lineas: LineaPedidoDto[];
}

export interface LineaPedido {
  Id: number;
  ProductoId: number;
  Cantidad: number;
  PrecioUnitario: number;
}

export type EstadoPedido = "Pendiente" | "Pagado" | "Rechazado" | "Cancelado";

export interface Pedido {
  Id: number;
  ClienteId: number;
  FechaUtc: string;
  CodigoCupon?: string | null;
  Subtotal: number;
  Descuento: number;
  Impuesto: number;
  Total: number;
  Estado: EstadoPedido | number;
  // Trazabilidad del cobro y constancias (ver Pedido en el backend).
  ReferenciaPago?: string | null;
  MotivoRechazo?: string | null;
  NotaDescuento?: string | null;
  Lineas: LineaPedido[];
}

export interface FilaReporte {
  PedidoId: number;
  Cliente: string;
  CantidadArticulos: number;
  Total: number;
}
