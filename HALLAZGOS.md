# HALLAZGOS — Alexis Tiznado

Bitácora de la prueba técnica de Soporte de Aplicaciones .NET — MercadoVerde.

> Rama: `solucion-Alexis-Tiznado` · Un commit por incidente, referenciando el ticket.

---

## Parte 0 — Conozco el sistema

### Flujo de `POST /api/pedidos` (paso a paso)

1. `PedidosController.Crear` recibe el `CrearPedidoDto` (clienteId, cupón opcional, líneas) y delega en `PedidoService.CrearPedido`.
2. **Cliente:** se busca el cliente en BD; si no existe se lanza `InvalidOperationException`.
3. **Líneas y subtotal:** por cada línea se busca el producto, se toma su precio **desde la BD** (no del cliente) y se acumula `subtotal = Σ precio × cantidad`.
4. **Cupón:** si viene código, se busca en `Cupones` y, si está vigente y activo, se calcula `descuento = subtotal × %/100`.
5. **Impuesto y total:** se calcula IVA 13% y el total.
6. **Cobro:** se invoca la pasarela externa (`IPasarelaPagoService.Cobrar`); según el resultado el pedido queda `Pagado` o `Rechazado`.
7. **Inventario:** `InventarioService.DescontarStock` descuenta el stock de cada línea (con su propio `SaveChanges`).
8. **Comprobante:** `GenerarLineaComprobante` arma la línea de comprobante para el correo del cliente.
9. **Persistencia:** se agrega el pedido al contexto y se hace `SaveChanges`. Se devuelve el pedido completo al panel.

### Servicios y responsabilidades

| Pieza | Capa | Responsabilidad |
|---|---|---|
| `PedidosController` / `ProductosController` / `ReportesController` | WebApi | Endpoints HTTP, binding de DTOs |
| `PedidoService` | Application | Orquesta la creación del pedido: cálculo (subtotal, cupón, **impuesto**), **cobro**, inventario, comprobante y persistencia |
| `InventarioService` | Application | Descuento de **stock** al confirmar pedido |
| `ReporteService` | Application | Reporte de ventas por rango de fechas |
| `ProductoRepository` | Infrastructure | Búsqueda de catálogo (SQL) |
| `PasarelaPagoService` | Infrastructure | Pasarela de cobros externa simulada (puede caer o rechazar) |
| `TiendaDbContext` + `SeedData` | Infrastructure | EF Core (PostgreSQL) y datos semilla |

### Dónde vive cada lógica

- **Cobro:** `PedidoService.CrearPedido` paso 4 → `IPasarelaPagoService` (implementación en `Infrastructure/Payments/PasarelaPagoService.cs`).
- **Inventario:** `InventarioService.DescontarStock` (Application).
- **Impuestos:** constante `TasaImpuesto = 0.13m` y cálculo en `PedidoService.CrearPedido`.
- **En el panel:** el pedido se arma en `frontend/components/crear-pedido-form.tsx` (estimado local en `frontend/lib/money.ts`) y el reporte en `frontend/components/reporte-ventas.tsx`; ambos llaman a la API vía `frontend/lib/api.ts`.

---

## Parte 1 — Triage y priorización

Contexto: lunes 9:00 a.m., seis tickets de backend (Anexo A) y nueve del panel (Anexo B). Ordeno por **riesgo** (seguridad y dinero/datos primero), no por orden de llegada.

| Orden | Ticket | Severidad / Impacto | Urgencia | Contención inmediata (antes de la causa) | Escalo / informo a |
|-------|--------|---------------------|----------|------------------------------------------|--------------------|
| 1 | **TICK-206** (buscador raro) | **Crítica / Seguridad.** Síntomas de **inyección SQL** en un endpoint público: exposición o alteración potencial de toda la BD (clientes, precios). | Inmediata: es explotable ahora mismo y Seguridad ya lo pidió con prioridad. | Deshabilitar temporalmente el endpoint de búsqueda o filtrar en el borde (WAF / regla de gateway); revisar logs de accesos por patrones de inyección. | Seguridad de la información (confirmación de alcance) y jefatura; aviso a DBA para revisar si hubo acceso indebido. |
| 2 | **TICK-205** (Pagado sin dinero) | **Crítica / Dinero.** Pedidos marcados `Pagado` sin cobro real: pérdida financiera directa y mercancía que se despacharía gratis. | Alta: cada pedido afectado es dinero perdido; Conciliación ya encontró casos. | Congelar el despacho de pedidos `Pagado` **sin referencia de pasarela** (query de conciliación) mientras se corrige; conciliación manual del día. | Finanzas/Conciliación (lista de pedidos afectados) y Logística (retener despachos). |
| 3 | **TICK-203** (500 en pedidos) | **Alta / Ventas bloqueadas.** Clientes no pueden comprar: con la campaña `PROMO50` activa **hoy**, cada 500 es una venta perdida. | Alta: campaña en curso amplifica el volumen de fallos. | Pedir a Marketing **pausar la publicación de PROMO50** (o registrar el cupón correctamente en BD) mientras se corrige; comunicar guion a Atención al Cliente. | Marketing (campaña) y Atención al Cliente. |
| 4 | **TICK-201** (stock −1) | **Alta / Integridad de datos.** Sobreventa en campañas: compromisos de entrega que no se pueden cumplir. | Media-alta: se manifiesta con tráfico alto (campañas). | Ajustar stock a mano de los productos afectados; margen de seguridad temporal (buffer) en productos de campaña; monitorear stocks negativos con una consulta. | Logística (pedidos comprometidos) y negocio. |
| 5 | **TICK-202** (cobro con cupón no cuadra) | **Media / Dinero (montos pequeños pero sistemáticos).** Se cobra impuesto de más en pedidos con cupón; vigencia de cupones inconsistente según hora. | Media: hay cobro en exceso al cliente (riesgo de reclamos/regulatorio), pero el flujo funciona. | Avisar a Finanzas el criterio actual del cálculo para su cuadratura; si el monto es material, pausar cupones hasta el fix. | Finanzas (diferencias y eventual compensación). |
| 6 | **TICK-204** (reporte se cuelga) | **Media-baja / Operación interna.** Reporte tarda ~55 s y expira; afecta a Finanzas, no a clientes. | Baja-media: molesto pero con rodeo (workaround). | Sugerir rangos de fecha más cortos mientras tanto; correr el reporte fuera de horas pico. | Finanzas (expectativa de tiempos). |

**Panel (Anexo B), mismo criterio:** 1º TICK-301 (XSS: seguridad), 2º TICK-303 (pedidos/cobros duplicados: dinero), 3º TICK-309 (cantidades inválidas: integridad), 4º TICK-305 (errores invisibles: el agente opera a ciegas), 5º TICK-302 (montos que no cuadran: confianza en el panel), 6º TICK-306 (falta el último día del reporte: datos), 7º TICK-307 (búsquedas que se pisan), 8º TICK-304 (navegador congelado), 9º TICK-308 (badge de stock).

---

## Parte 2 — Hipótesis de causa raíz (antes de corregir)

### TICK-206 — Buscador "hace cosas raras" (inyección SQL)

- **Sospecho:** `ProductoRepository.BuscarPorNombre` (`src/MercadoVerde.Infrastructure/Data/ProductoRepository.cs:23`) — arma el SQL **concatenando** el término del usuario dentro de un `FromSqlRaw`: `... LIKE '%" + termino.ToLower() + "%'"`.
- **Evidencia:** el ticket habla de "ciertos caracteres" que producen resultados extraños o errores → comportamiento clásico de inyección: una comilla simple rompe la consulta (error 500) y un payload `' OR 1=1 --` la altera.
- **Reproducción:** `GET /api/productos/buscar?termino='` → 500 (error de sintaxis SQL). `GET /api/productos/buscar?termino=zzz%25%27%20OR%201%3D1%20--` → devuelve **todo** el catálogo aunque "zzz" no exista.
- **Descarto** un problema de codificación de caracteres porque el término viaja bien hasta el repositorio; el fallo está en cómo se construye la consulta.

### TICK-205 — Pedido "Pagado" sin dinero

- **Sospecho:** `PedidoService.CrearPedido` paso 4 (`src/MercadoVerde.Application/Services/PedidoService.cs:86-90`) — el `catch` de la excepción de la pasarela hace `pedido.Estado = EstadoPedido.Pagado`. Cuando el proveedor **cae** (timeout/503), el pedido queda pagado sin haberse cobrado. Además la `Referencia` que devuelve la pasarela **nunca se persiste**, por eso Conciliación no encuentra referencia.
- **Evidencia:** log `13:05:15.903 WARN [Conciliacion] Pedido 1190 marcado Pagado pero la pasarela no devolvió referencia.` — y la duración inusual del POST (5.5 s: `13:05:10.331 → 13:05:15.902`) sugiere un timeout del proveedor.
- **Reproducción:** la pasarela simulada cae ~20% de las veces; crear pedidos repetidamente hasta que caiga y observar que igual responde `Estado = Pagado`. Determinístico: test unitario con una pasarela que lanza `TimeoutException` (existe `FixesEsperadosTests.TICK205`).

### TICK-203 — Algunos pedidos truenan con 500 (dos causas distintas)

- **Causa A — cliente en particular:** `PedidoService.GenerarLineaComprobante` (`PedidoService.cs:110`) hace `cliente.Email.ToUpper()` y el cliente **Bruno Díaz (Id=2) tiene `Email = null`** en el seed → `NullReferenceException`.
  - **Evidencia:** log `09:31:07 ERROR ... NullReferenceException ... at PedidoService.GenerarLineaComprobante` en un POST de `cliente=2`.
  - **Reproducción:** `POST /api/pedidos` con `clienteId=2` → 500 siempre.
- **Causa B — cupón `PROMO50`:** `PedidoService.CrearPedido` (`PedidoService.cs:59-65`) busca el cupón y usa `cupon.FechaExpiracionUtc` **sin comprobar null**. `PROMO50` **no existe en la BD** (Marketing lo publicó pero nunca se registró; el seed solo crea `BIENVENIDA10` y `EXPIRADO`) → `NullReferenceException`.
  - **Evidencia:** log `10:02:55 ERROR ... NullReferenceException at PedidoService.CrearPedido line 64` en un POST con `cupon=PROMO50`; nota del log: Marketing dice que "el cupón no aplica nada de descuento" — consistente con un cupón inexistente.
  - **Reproducción:** `POST /api/pedidos` con `codigoCupon: "PROMO50"` → 500 siempre.
  - *El reporte verbal era impreciso a propósito: son **dos** defectos independientes que comparten el síntoma "error 500".*

### TICK-202 — El cobro con cupón no cuadra (dos causas)

- **Causa A — impuesto sobre base equivocada:** `PedidoService.CrearPedido` (`PedidoService.cs:69`) calcula `impuesto = subtotal × 0.13` **sin restar el descuento**. Finanzas espera IVA sobre la base imponible `(subtotal − descuento)`. Ej.: subtotal 100, cupón 10% → sistema cobra impuesto 13.00 y total 103.00; lo correcto es 11.70 y 101.70.
  - **Evidencia:** "el impuesto sale más caro de lo que debería" con cupones **válidos**; con `BIENVENIDA10` la diferencia es exactamente `descuento × 13%`.
  - **Reproducción:** `POST /api/pedidos` con `BIENVENIDA10` y comparar `Impuesto` contra hoja de Finanzas.
- **Causa B — vigencia según hora del día:** `PedidoService.cs:62` compara `cupon.FechaExpiracionUtc >= DateTime.Now` — mezcla una fecha **UTC** con la hora **local del servidor (UTC-6, America/El_Salvador)**. En la franja de 6 horas de diferencia un cupón parece vigente/vencido según la hora en que se consulte.
  - **Evidencia:** "la vigencia de los cupones se comporta distinto según la hora del día"; el compose fija `TZ: America/El_Salvador` y el log confirma servidor UTC-6.
  - **Reproducción:** sembrar un cupón que expire "hoy a las 18:00 UTC" y consultarlo entre las 12:00 y las 18:00 hora local: con `DateTime.Now` sigue "vigente" 6 horas de más (o de menos, según el caso).

### TICK-201 — Stock en −1 con pedidos simultáneos

- **Sospecho:** `InventarioService.DescontarStock` (`src/MercadoVerde.Application/Services/InventarioService.cs:19-29`) — patrón **leer → validar → escribir** sin ningún control de concurrencia: dos peticiones leen `Stock = 1` a la vez, ambas validan, ambas escriben `Stock = 0`… y la BD termina con la resta aplicada dos veces (−1). El token `Producto.RowVersion` está **declarado pero no se usa** (el propio comentario del modelo lo dice).
- **Evidencia:** log `11:48:13.140` y `11:48:13.151` — dos pedidos del Monitor 24" (stock semilla = 2) con **11 ms** de diferencia, seguidos de `WARN [Inventario] Producto 4 ... Stock resultante = -1`.
- **Reproducción:** dos `POST /api/pedidos` concurrentes (por ejemplo `curl` en paralelo o un pequeño script) comprando la última unidad del mismo producto; con carrera ganada, ambas pasan la validación.

### TICK-204 — El reporte de ventas se cuelga

- **Sospecho:** `ReporteService.GenerarReporteVentas` (`src/MercadoVerde.Application/Services/ReporteService.cs:27-46`) — patrón **N+1**: trae todos los pedidos del rango y luego, **por cada pedido**, hace dos consultas más (líneas y cliente). Con cientos de miles de pedidos son cientos de miles de round-trips a PostgreSQL.
- **Evidencia:** log `12:20:44 → 12:21:39` — `GET /api/reportes/ventas` de un rango de 5 meses tardó **54.8 s** (el cliente expira a los 30 s); el propio código comenta "por cada pedido se vuelve a la base de datos".
- **Reproducción:** sembrar decenas de miles de pedidos y pedir un rango amplio; el tiempo crece linealmente con el número de pedidos (2 consultas extra por pedido).

---

## Parte 3 — Correcciones (backend)

*(Se completa por ticket con su commit; ver abajo.)*

---

## Parte 4 — Tope de descuento

*(Pendiente de completar con la implementación.)*

---

## Parte 5 — Comunicación

*(Pendiente de completar al cierre.)*

---

## Frontend (Parte 6)

*(Pendiente de completar con las correcciones del panel.)*
