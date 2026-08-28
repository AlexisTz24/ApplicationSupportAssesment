"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { buscarProductos } from "@/lib/api";
import { formatearMoneda } from "@/lib/money";
import type { Producto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Umbral a partir del cual el stock se considera "bajo" para avisar al agente.
const UMBRAL_STOCK_BAJO = 3;

export function BuscadorProductos() {
  const [termino, setTermino] = useState("");
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [buscado, setBuscado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reintento, setReintento] = useState(0);

  // Búsqueda "mientras escribes", con dos protecciones:
  // - debounce de 300 ms: no se dispara una consulta por cada tecla;
  // - AbortController: al cambiar el término se cancela la petición anterior,
  //   así una respuesta vieja nunca pisa a la del texto actual.
  useEffect(() => {
    if (!termino) {
      setResultados([]);
      setBuscado(false);
      setError(null);
      setCargando(false);
      return;
    }

    const controlador = new AbortController();
    const temporizador = setTimeout(() => {
      setCargando(true);
      buscarProductos(termino, { signal: controlador.signal })
        .then((productos) => {
          setResultados(productos);
          setBuscado(true);
          setError(null);
          setCargando(false);
        })
        .catch((e: unknown) => {
          if (controlador.signal.aborted) return; // respuesta obsoleta: se ignora
          setResultados([]);
          setBuscado(true);
          setError(e instanceof Error ? e.message : "No se pudo consultar la API.");
          setCargando(false);
        });
    }, 300);

    return () => {
      clearTimeout(temporizador);
      controlador.abort();
    };
  }, [termino, reintento]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Buscador de catálogo</CardTitle>
        <CardDescription>
          Busca productos por nombre, igual que el catálogo público de la tienda.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-2">
          <Input
            placeholder="Ej. mouse, teclado, monitor…"
            value={termino}
            onChange={(e) => setTermino(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setReintento((n) => n + 1);
            }}
            aria-label="Término de búsqueda"
          />
          <Button
            onClick={() => setReintento((n) => n + 1)}
            disabled={cargando || !termino}
            aria-label="Buscar productos"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            No se pudo completar la búsqueda: {error}
          </p>
        )}

        {buscado && !error && (
          <div className="space-y-4">
            {/* El término y los nombres de producto se renderizan SIEMPRE como
                texto (React los escapa); nunca como HTML. */}
            <p className="text-sm text-muted-foreground">
              Resultados para <strong>{termino}</strong> — {resultados.length}{" "}
              producto(s).
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {resultados.map((p) => (
                <div
                  key={p.Id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="space-y-1">
                    <p className="font-medium">{p.Nombre}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatearMoneda(p.Precio)}
                    </p>
                  </div>
                  {p.Stock <= 0 ? (
                    <Badge variant="destructive">Agotado</Badge>
                  ) : p.Stock <= UMBRAL_STOCK_BAJO ? (
                    <Badge variant="warning">Stock bajo: {p.Stock}</Badge>
                  ) : (
                    <Badge variant="success">{p.Stock} en stock</Badge>
                  )}
                </div>
              ))}
            </div>

            {resultados.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No se encontraron productos.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
