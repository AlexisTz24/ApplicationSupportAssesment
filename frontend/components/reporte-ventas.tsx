"use client";

import { useState } from "react";

import { obtenerReporteVentas } from "@/lib/api";
import { formatearMoneda, redondearCentavos } from "@/lib/money";
import type { FilaReporte } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Filas que se pintan por página: renderizar cientos de miles de <tr> de una
// sola vez congela la pestaña (TICK-304). Los totales sí se calculan sobre
// TODO el rango; solo el pintado va por partes.
const FILAS_POR_PAGINA = 200;

export function ReporteVentas() {
  const [desde, setDesde] = useState("2026-01-01");
  const [hasta, setHasta] = useState("2026-06-02");
  const [filas, setFilas] = useState<FilaReporte[] | null>(null);
  const [visibles, setVisibles] = useState(FILAS_POR_PAGINA);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangoValido = Boolean(desde && hasta) && desde <= hasta;

  async function generar() {
    if (cargando || !rangoValido) return;
    setCargando(true);
    setError(null);
    try {
      // El backend filtra con FechaUtc <= hasta. Si se envía solo la fecha
      // (00:00), los pedidos de ese día quedan fuera (TICK-306); por eso el
      // límite superior se manda al final del día.
      const data = await obtenerReporteVentas(desde, `${hasta}T23:59:59.999`);
      setFilas(data);
      setVisibles(FILAS_POR_PAGINA);
    } catch (e: unknown) {
      // Una API caída no puede parecer "0 resultados" (TICK-305).
      setFilas(null);
      setError(
        e instanceof Error ? e.message : "No se pudo obtener el reporte."
      );
    } finally {
      setCargando(false);
    }
  }

  // Total general de todas las ventas del rango (redondeado al centavo).
  const totalGeneral =
    filas === null
      ? 0
      : redondearCentavos(filas.reduce((acc, f) => acc + f.Total, 0));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporte de ventas</CardTitle>
        <CardDescription>
          Ventas por rango de fechas (ambos extremos inclusive). En producción
          la tabla de pedidos tiene cientos de miles de filas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="desde">Desde</Label>
            <Input
              id="desde"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hasta">Hasta</Label>
            <Input
              id="hasta"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
          <Button onClick={generar} disabled={cargando || !rangoValido}>
            {cargando ? "Generando…" : "Generar reporte"}
          </Button>
        </div>

        {!rangoValido && (
          <p className="text-sm text-amber-600">
            Revisa el rango: ambas fechas son obligatorias y
            &quot;Desde&quot; no puede ser posterior a &quot;Hasta&quot;.
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            No se pudo generar el reporte: {error}
          </p>
        )}

        {filas !== null && filas.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">
            No hay pedidos en el rango seleccionado.
          </p>
        )}

        {filas !== null && filas.length > 0 && (
          <>
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-4">
              <span className="text-sm text-muted-foreground">
                {filas.length} pedidos en el rango
              </span>
              <span className="text-lg font-semibold">
                Total: {formatearMoneda(totalGeneral)}
              </span>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Artículos</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.slice(0, visibles).map((fila) => (
                  <TableRow key={fila.PedidoId}>
                    <TableCell className="font-medium">{fila.PedidoId}</TableCell>
                    <TableCell>{fila.Cliente}</TableCell>
                    <TableCell className="text-right">
                      {fila.CantidadArticulos}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatearMoneda(fila.Total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {visibles < filas.length && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Mostrando {Math.min(visibles, filas.length)} de {filas.length}{" "}
                  pedidos.
                </span>
                <Button
                  variant="outline"
                  onClick={() => setVisibles((v) => v + FILAS_POR_PAGINA)}
                >
                  Mostrar más
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
