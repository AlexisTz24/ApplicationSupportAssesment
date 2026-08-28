"use client";

import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { crearPedido } from "@/lib/api";
import {
  calcularDescuentoEstimado,
  calcularSubtotal,
  calcularTotalEstimado,
  formatearMoneda,
  redondearCentavos,
  TOPE_DESCUENTO_CUPON,
} from "@/lib/money";
import type { Pedido } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface LineaForm {
  id: number; // clave estable para React (no el índice del arreglo)
  productoId: number;
  cantidad: string; // se guarda el texto del input y se valida antes de usar
  precioUnitario: number;
}

// Precios de referencia del catálogo sembrado (ver SeedData).
const CATALOGO: Record<number, { nombre: string; precio: number }> = {
  1: { nombre: "Audífonos Bluetooth", precio: 25.0 },
  2: { nombre: "Teclado Mecánico", precio: 49.9 },
  3: { nombre: "Mouse Inalámbrico", precio: 15.5 },
  4: { nombre: 'Monitor 24"', precio: 180.0 },
};

// Nombres de estado del pedido (la API serializa el enum como número).
const NOMBRES_ESTADO: Record<number, string> = {
  0: "Pendiente",
  1: "Pagado",
  2: "Rechazado",
  3: "Cancelado",
};

// Entero entre 1 y 9999: cubre cualquier pedido real y evita mandar números
// que desbordan el int de .NET (el backend devolvería un 400 sin detalle útil).
function esCantidadValida(cantidad: string): boolean {
  const texto = cantidad.trim();
  const n = Number(texto);
  return /^\d+$/.test(texto) && n >= 1 && n <= 9999;
}

export function CrearPedidoForm() {
  const [clienteId, setClienteId] = useState("1");
  const [codigoCupon, setCodigoCupon] = useState("");
  const [porcentajeCupon, setPorcentajeCupon] = useState("0");
  const siguienteId = useRef(2);
  const [lineas, setLineas] = useState<LineaForm[]>([
    { id: 1, productoId: 2, cantidad: "1", precioUnitario: 49.9 },
  ]);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function agregarLinea() {
    setLineas([
      ...lineas,
      { id: siguienteId.current++, productoId: 1, cantidad: "1", precioUnitario: 25.0 },
    ]);
  }

  function eliminarLinea(id: number) {
    setLineas(lineas.filter((l) => l.id !== id));
  }

  function actualizarLinea(id: number, productoId: number, cantidad: string) {
    setLineas(
      lineas.map((l) =>
        l.id === id
          ? {
              ...l,
              productoId,
              cantidad,
              precioUnitario: CATALOGO[productoId]?.precio ?? 0,
            }
          : l
      )
    );
  }

  // Validación de la captura (TICK-309): sin líneas, cantidades vacías, 0 o
  // negativas no se permite confirmar.
  const problemas: string[] = [];
  if (
    !/^\d+$/.test(clienteId.trim()) ||
    Number(clienteId) < 1 ||
    Number(clienteId) > 2147483647
  )
    problemas.push("El ID de cliente debe ser un número mayor o igual a 1.");
  if (lineas.length === 0) problemas.push("Agrega al menos una línea al pedido.");
  if (lineas.some((l) => !esCantidadValida(l.cantidad)))
    problemas.push("Cada línea necesita una cantidad entera entre 1 y 9999.");
  // Se valida el TEXTO del campo: Number("") es 0 y pasaría en silencio.
  const porcentajeTexto = porcentajeCupon.trim();
  const porcentajeValido =
    /^\d+(\.\d+)?$/.test(porcentajeTexto) && Number(porcentajeTexto) <= 100;
  if (!porcentajeValido)
    problemas.push("El % de descuento para estimar debe ser un número entre 0 y 100.");
  const porcentaje = porcentajeValido ? Number(porcentajeTexto) : 0;

  const formularioValido = problemas.length === 0;

  const lineasResumen = lineas.map((l) => ({
    precioUnitario: l.precioUnitario,
    cantidad: Number(l.cantidad),
  }));
  const totalEstimado = formularioValido
    ? calcularTotalEstimado(lineasResumen, porcentaje)
    : null;
  // Aviso cuando el descuento estimado queda limitado por el tope de $15 del
  // backend (misma regla de negocio; el estimado la replica).
  const descuentoTopado =
    formularioValido &&
    porcentaje > 0 &&
    calcularDescuentoEstimado(calcularSubtotal(lineasResumen), porcentaje) ===
      TOPE_DESCUENTO_CUPON &&
    (calcularSubtotal(lineasResumen) * porcentaje) / 100 > TOPE_DESCUENTO_CUPON;

  async function enviar() {
    // Guardas contra el doble clic (TICK-303): si ya hay un envío en curso no
    // se dispara otro; el botón además se deshabilita mientras se envía.
    if (enviando || !formularioValido) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const creado = await crearPedido({
        ClienteId: Number(clienteId),
        CodigoCupon: codigoCupon.trim() || null,
        Lineas: lineas.map((l) => ({
          ProductoId: l.productoId,
          Cantidad: Number(l.cantidad),
        })),
      });
      setPedido(creado);
    } catch (e: unknown) {
      // Una falla del backend o de red nunca se queda en silencio (TICK-305).
      setPedido(null);
      setErrorEnvio(
        e instanceof Error ? e.message : "No se pudo crear el pedido."
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle>Crear pedido</CardTitle>
          <CardDescription>
            Registra un pedido a nombre de un cliente. Cobra y descuenta stock
            igual que el flujo real de la tienda.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="clienteId">Cliente (ID)</Label>
              <Input
                id="clienteId"
                inputMode="numeric"
                value={clienteId}
                onChange={(e) => setClienteId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cupon">Código de cupón (opcional)</Label>
              <Input
                id="cupon"
                placeholder="Ej. BIENVENIDA10"
                value={codigoCupon}
                onChange={(e) => setCodigoCupon(e.target.value)}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Líneas del pedido</Label>
              <Button variant="outline" size="sm" onClick={agregarLinea}>
                <Plus className="mr-1 h-4 w-4" /> Agregar línea
              </Button>
            </div>

            {lineas.map((linea) => {
              const cantidadValida = esCantidadValida(linea.cantidad);
              return (
                <div key={linea.id} className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <label
                      htmlFor={`producto-${linea.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Producto
                    </label>
                    <select
                      id={`producto-${linea.id}`}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={linea.productoId}
                      onChange={(e) =>
                        actualizarLinea(
                          linea.id,
                          Number(e.target.value),
                          linea.cantidad
                        )
                      }
                    >
                      {Object.entries(CATALOGO).map(([id, info]) => (
                        <option key={id} value={id}>
                          {info.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-24 space-y-1">
                    <label
                      htmlFor={`cantidad-${linea.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Cantidad
                    </label>
                    <Input
                      id={`cantidad-${linea.id}`}
                      type="number"
                      min={1}
                      step={1}
                      aria-invalid={!cantidadValida}
                      className={cantidadValida ? "" : "border-destructive"}
                      value={linea.cantidad}
                      onChange={(e) =>
                        actualizarLinea(
                          linea.id,
                          linea.productoId,
                          e.target.value
                        )
                      }
                    />
                  </div>
                  <div className="w-28 pb-2 text-right text-sm">
                    {cantidadValida
                      ? formatearMoneda(
                          redondearCentavos(
                            linea.precioUnitario * Number(linea.cantidad)
                          )
                        )
                      : "—"}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Eliminar línea"
                    onClick={() => eliminarLinea(linea.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="porcentaje">
                % de descuento del cupón (para estimar)
              </Label>
              <Input
                id="porcentaje"
                type="number"
                min={0}
                max={100}
                value={porcentajeCupon}
                onChange={(e) => setPorcentajeCupon(e.target.value)}
              />
            </div>
          </div>

          {problemas.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              {problemas.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          {errorEnvio && (
            <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              No se pudo crear el pedido: {errorEnvio}
            </p>
          )}

          <Button onClick={enviar} disabled={enviando || !formularioValido}>
            {enviando ? "Enviando…" : "Confirmar y cobrar pedido"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Estimado del panel</CardTitle>
            <CardDescription>
              Cálculo local para confirmar el monto con el cliente. Replica el
              cálculo del backend (descuento primero, IVA sobre la base).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-lg font-semibold">
              <span>Total estimado</span>
              <span>
                {totalEstimado === null ? "—" : formatearMoneda(totalEstimado)}
              </span>
            </div>
            {descuentoTopado && (
              <p className="text-xs text-muted-foreground">
                El descuento del cupón se estima topado en{" "}
                {formatearMoneda(TOPE_DESCUENTO_CUPON)} (tope por pedido).
              </p>
            )}
          </CardContent>
        </Card>

        {pedido && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pedido #{pedido.Id}</CardTitle>
              <CardDescription>Respuesta de la API.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Subtotal" value={formatearMoneda(pedido.Subtotal)} />
              <Row label="Descuento" value={formatearMoneda(pedido.Descuento)} />
              <Row label="Impuesto" value={formatearMoneda(pedido.Impuesto)} />
              <Separator />
              <Row
                label="Total cobrado"
                value={formatearMoneda(pedido.Total)}
                bold
              />
              {pedido.ReferenciaPago && (
                <Row label="Ref. de pago" value={pedido.ReferenciaPago} />
              )}
              <EstadoPedidoBadge estado={pedido.Estado} />
              {pedido.MotivoRechazo && (
                <p className="text-xs text-muted-foreground">
                  {pedido.MotivoRechazo}
                </p>
              )}
              {pedido.NotaDescuento && (
                <p className="text-xs text-muted-foreground">
                  {pedido.NotaDescuento}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function EstadoPedidoBadge({ estado }: { estado: Pedido["Estado"] }) {
  const nombre =
    typeof estado === "number"
      ? NOMBRES_ESTADO[estado] ?? `Estado ${estado}`
      : estado;
  const variante =
    nombre === "Pagado"
      ? "success"
      : nombre === "Rechazado"
        ? "destructive"
        : "warning";
  return (
    <div className="pt-2">
      <Badge variant={variante}>{nombre}</Badge>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${
        bold ? "font-semibold" : ""
      }`}
    >
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
