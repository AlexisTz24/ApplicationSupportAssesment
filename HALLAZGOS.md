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

> Antes de tocar código reproduje cada síntoma contra el sistema levantado con el código original (curl/Swagger); los comandos están en cada sección. Después de cada corrección quité el `Skip` del test correspondiente en `FixesEsperadosTests` — los 4 tests del evaluador + 2 míos pasan (8/8 con las pruebas de humo).

### TICK-206 — Inyección SQL en el buscador · commit `8225453`

- **Síntoma (reproducido):** `GET /api/productos/buscar?termino='` → **500**; `termino=zzz%' OR 1=1 --` → devolvió **los 4 productos** del catálogo.
- **Causa raíz:** `ProductoRepository.cs:23` — SQL concatenado con el texto del usuario dentro de `FromSqlRaw`.
- **Corrección:** consulta LINQ parametrizada con `EF.Functions.Like`, escapando además los comodines `%`/`_` para que se busquen literalmente. El término ya nunca forma parte del SQL.
- **Regresiones:** ninguna esperada; la semántica (búsqueda case-insensitive por sub-cadena, solo activos) se conserva. Verificado con el test TICK206 (comilla no rompe; payload de inyección devuelve vacío) y manualmente.

### TICK-203 — Errores 500 al confirmar pedidos · commit `dcedc77`

- **Síntoma (reproducido):** `POST /api/pedidos` con `clienteId=2` → 500; con `codigoCupon=PROMO50` → 500.
- **Causa raíz:** dos `NullReferenceException` distintas: (a) `cupon.FechaExpiracionUtc` con cupón inexistente (`PedidoService`, PROMO50 nunca se registró en BD); (b) `cliente.Email.ToUpper()` con email null (`GenerarLineaComprobante`, caso Bruno Díaz).
- **Corrección:** (a) cupón inexistente o no vigente → error de negocio claro ("El cupón 'X' no existe / no está vigente"); (b) el comprobante tolera email null. Además `PedidosController` ahora convierte los errores de negocio (`InvalidOperationException`) en **400 ProblemDetails** con detalle y los registra en log — antes cualquier error de negocio era un 500 crudo e invisible.
- **Regresiones / efectos declarados:** un cupón **vencido** ahora rechaza el pedido con mensaje claro, en vez de cobrarlo silenciosamente sin descuento (eso era exactamente la queja de Marketing: "no aplica nada de descuento y no marca error"). Decisión declarada; si negocio prefiere ignorar el cupón y seguir, es un cambio de una línea.

### TICK-202 — El cobro con cupón no cuadra · commit `d3e4605`

- **Síntoma (reproducido):** pedido de $25.00 con `BIENVENIDA10` (10%) → la API devolvió `Impuesto=3.25` (13% de 25) y `Total=25.75`; Finanzas espera impuesto sobre la base con descuento: `(25 − 2.50) × 13% = 2.93`, total `25.43`.
- **Causa raíz:** (a) `impuesto = subtotal × 0.13` sin restar el descuento; (b) vigencia comparada contra `DateTime.Now` (hora local UTC-6) cuando la expiración se persiste en **UTC** → la validez cambiaba según la hora del día.
- **Corrección:** impuesto sobre `subtotal − descuento`; comparación contra `DateTime.UtcNow`; y redondeo **al centavo** (`Math.Round(..., 2, AwayFromZero)`) de descuento e impuesto para que el dinero cuadre exacto.
- **Regresiones:** los totales con cupón bajan (eso es lo correcto); pedidos sin cupón no cambian. Test TICK202 en verde.

### TICK-205 — Pedido "Pagado" sin dinero · commit `2125bae`

- **Síntoma:** pedido en estado Pagado sin referencia de pasarela (log 13:05, pedido 1190; POST tardó 5.5 s → timeout del proveedor).
- **Causa raíz:** el `catch` de la pasarela hacía `Estado = Pagado` cuando el proveedor caía; y la `Referencia` del cobro aprobado nunca se persistía.
- **Corrección:** excepción de pasarela → **Pendiente** (el cobro pudo o no aplicarse del lado del proveedor: lo honesto es conciliar, no asumir) + `LogError`; rechazo → **Rechazado** con motivo persistido; cobro aprobado → se persiste `ReferenciaPago`. El stock ya solo se descuenta en pedidos aprobados.
- **Regresiones / efectos declarados:** `Pedido` tiene columnas nuevas (`ReferenciaPago`, `MotivoRechazo`); como el esquema se crea con `EnsureCreated`, hay que recrear la base (`docker compose down -v && docker compose up --build`). Conciliación ahora puede consultar pedidos `Pendiente` con motivo "pasarela no respondió".

### TICK-201 — Stock en −1 con pedidos simultáneos · commit `b706dc4`

- **Síntoma:** dos pedidos del Monitor 24" con 11 ms de diferencia dejaron stock −1 (log 11:48). Al reproducir con dos POST concurrentes comprobé además que el perdedor recibía un 500 crudo **después de haber sido cobrado**.
- **Causa raíz:** `InventarioService.DescontarStock` hacía leer→validar→escribir sin control de concurrencia; `Producto.RowVersion` estaba declarado pero sin usar.
- **Corrección (3 capas):**
  1. `Producto.Stock` como **token de concurrencia optimista** (elegí el propio Stock y no RowVersion porque funciona igual en PostgreSQL, SQLite e InMemory, los tres proveedores del proyecto; RowVersion automático es específico de SQL Server).
  2. `DescontarStock` reintenta ante `DbUpdateConcurrencyException` (máx. 3) recargando el valor real y **revalidando** — el stock ya no puede quedar negativo.
  3. `PedidoService` verifica stock **antes de cobrar** y, si la carrera residual gana tras el cobro, repone lo descontado, deja el pedido **Pendiente** con motivo y emite `LogCritical` ("requiere reverso del pago") — la falla nunca queda invisible.
- **Regresiones:** bajo contención extrema el pedido puede fallar por "stock insuficiente" tras reintentos — comportamiento correcto (antes sobre-vendía). La actualización del stock sigue siendo la única escritura concurrente sobre `Producto`.

### TICK-204 — El reporte de ventas se cuelga · commit `46d8db1`

- **Síntoma (reproducido):** sembré 20,000 pedidos con líneas → `GET /api/reportes/ventas` tardó **7.0 s** en local (en producción, con más filas y latencia real: los ~55 s del log y timeouts de 30 s).
- **Causa raíz:** patrón **N+1** — por cada pedido del rango se consultaban sus líneas y su cliente (2N+1 consultas).
- **Corrección:** una **única consulta proyectada** (`Select` con navegaciones `Cliente`/`Lineas`): la agregación ocurre en la base de datos. Tras el fix, el mismo reporte tarda milisegundos (medido abajo en la verificación).
- **Regresiones:** el resultado es idéntico fila a fila; pedidos sin líneas suman 0 artículos (protegido con `Sum(int?) ?? 0`).

### Hallazgos extra (sin ticket) — commit `8e9bbf3` y repartidos

- **Validación de entradas del pedido:** la API aceptaba pedidos sin líneas o con cantidad 0/negativa; una cantidad negativa incluso **aumentaba** el stock al "descontarla". Ahora se rechazan con 400.
- **Se cobraba antes de validar stock** (cliente cobrado y 500 sin pedido persistido) — corregido con la verificación temprana (TICK-201).
- **Stock descontado en pedidos rechazados** — corregido (TICK-205).
- **Errores de negocio como 500 crudos** — corregido con el mapeo a ProblemDetails (TICK-203).
- **Observabilidad:** fallos de pasarela, rechazos, topes de descuento y carreras de stock ahora dejan log estructurado (`ILogger` en `PedidoService`, opcional para no romper la construcción de los tests existentes).
- **Documentados sin corregir (fuera del alcance mínimo):** la pasarela se registra como `Singleton` compartiendo un `Random` (aceptable aquí, pero un cliente HTTP real debería ser `Scoped`/`HttpClientFactory`); no hay transacción que agrupe pedido+stock en un único commit (mitigado con compensación y logs; lo ideal sería `IDbContextTransaction` expuesto por el puerto); el endpoint de búsqueda no limita la longitud del término (abuso/DoS ligero); el reporte devuelve **todas** las filas del rango sin paginación de API (el panel pagina el render, pero la API debería soportar `take/skip`).

---

## Parte 4 — Tope de descuento · commit `28da32a`

- **Dónde va la regla:** en `PedidoService`, junto al cálculo del descuento (constante `TopeDescuentoCupon = 15.00m`). Es una regla de negocio de pedidos: ni en el controller (capa HTTP) ni en el cupón (el tope es *por pedido*, no por cupón).
- **Comportamiento:** si `subtotal × %` supera $15.00, se aplican $15.00 exactos y el impuesto se calcula sobre la base con el descuento ya topado.
- **Constancia (doble, pensada para soporte):**
  1. **Persistida:** `Pedido.NotaDescuento` = "Cupón X: descuento calculado 50.00 superó el tope; se aplicó 15.00" — viaja en la respuesta de la API y el panel la muestra; cualquier reclamo se resuelve viendo el pedido, sin ir a los logs.
  2. **Log estructurado** con cupón, monto calculado, tope y cliente.
- **Cómo lo probé:** dos pruebas nuevas en `tests/.../TopeDescuentoTests.cs`: cupón 50% sobre $100 → descuento 15.00, impuesto 11.05, total 96.05, nota presente; y cupón 10% → 10.00 sin nota (no altera descuentos legítimos).

---

## Parte 5 — Comunicación

Elegí **TICK-205** (pedido "Pagado" sin dinero) por su riesgo financiero.

### RCA breve (equipo técnico)

> **Incidente:** pedidos marcados `Pagado` sin cobro real, detectados por Conciliación (ej. pedido 1190, 02/06 13:05).
> **Causa raíz:** en `PedidoService.CrearPedido`, el `catch` de la excepción de la pasarela (timeout/503 del proveedor) asignaba `Estado = Pagado`. Es decir: la *indisponibilidad* del proveedor se trataba como cobro exitoso. Además la referencia de cobro nunca se persistía, por lo que ni siquiera los cobros buenos eran conciliables.
> **Impacto:** todo pedido creado durante una caída del proveedor (~20% del tiempo en la simulación) quedaba como ingreso inexistente; mercancía potencialmente despachada sin pago.
> **Corrección:** desplegada en `2125bae`. Excepción de pasarela → `Pendiente` + log de error; rechazo → `Rechazado` con motivo; aprobado → `Pagado` con `ReferenciaPago` persistida. El stock solo se descuenta en pedidos aprobados.
> **Acción preventiva:** (1) test de regresión `TICK205` activo en la suite — cualquier cambio que vuelva a marcar Pagado en fallo rompe el build; (2) propuesta: alerta/consulta de conciliación diaria `Estado=Pagado AND ReferenciaPago IS NULL` (hoy debe dar 0 filas) y revisión de los pedidos `Pendiente` con motivo de pasarela.

### Mensaje al área de negocio (3–5 líneas)

> Detectamos que, cuando el proveedor de cobros tenía caídas, el sistema registraba algunos pedidos como "pagados" aunque el cobro no se hubiera hecho. Ya lo corregimos: ahora esos casos quedan marcados como "pendientes", con su motivo, para que Conciliación los revise y nadie despache mercancía sin pago. Los pedidos afectados anteriores se pueden identificar porque están "pagados" pero sin referencia de cobro; les compartimos la lista para regularizarlos. Desde hoy, cada pago aprobado guarda su número de referencia, así que la conciliación contra el proveedor queda directa.

---

## Frontend (Parte 6)

Método idéntico al backend: reproducir en el navegador → aislar causa → cambio mínimo → verificar (el panel compila con `next build`, que incluye type-check y ESLint). Varios tickets del Anexo B eran **síntomas en el panel de bugs del backend** — los distingo explícitamente:

- **TICK-302 (parcial)** — "el total estimado no coincide con lo que cobra la API": mitad backend (impuesto sobre base sin descuento, TICK-202) y mitad frontend (orden de cálculo distinto + punto flotante).
- **TICK-306** — el rango lo arma el panel (frontend), aunque el filtro `<=` viva en el backend.
- **TICK-304** — el volumen viene del backend sin paginar, pero el congelamiento es del render del panel.

### TICK-301 — XSS en el buscador · commit `a2a7a01`

- **Síntoma:** buscar `<img src=x onerror=alert(1)>` (o un producto con ese nombre) ejecutaba el HTML en el panel.
- **Causa raíz:** `buscador-productos.tsx` renderizaba el término **y** `p.Nombre` con `dangerouslySetInnerHTML`.
- **Corrección:** render como texto plano (React escapa por defecto). Es la contraparte cliente del TICK-206: entrada no confiable jamás se interpreta.
- **Regresión posible:** ninguna — no existía contenido HTML legítimo que mostrar.

### TICK-307 — Búsquedas que se pisan · commit `a2a7a01`

- **Causa raíz:** un `fetch` por **cada tecla**, sin cancelación ni orden: la respuesta más lenta pisaba a la más nueva, y se inundaba la API.
- **Corrección:** debounce de 300 ms + `AbortController` (la petición anterior se cancela al teclear; una respuesta obsoleta se ignora). Botón/Enter reutilizan el mismo flujo.

### TICK-308 — Badge de stock engañoso · commit `a2a7a01`

- **Causa raíz:** `variant={p.Stock > 0 ? "success" : "warning"}` — verde aun con 1 unidad.
- **Corrección:** tres estados: `Agotado` (rojo), `Stock bajo: N` (ámbar, ≤3 unidades), `N en stock` (verde).

### TICK-303 — Pedidos duplicados por doble clic · commit `9d2e3a5`

- **Causa raíz:** `enviar()` no tenía guarda de reentrada y el botón no se deshabilitaba: cada clic era un `POST /api/pedidos` (y cada uno cobraba y descontaba stock).
- **Corrección:** guarda `if (enviando) return` + botón deshabilitado con "Enviando…". 
- **Nota de fondo (documentada):** la protección de UI reduce el caso real, pero la garantía fuerte sería **idempotencia en la API** (clave de idempotencia por intento de pedido); lo dejo propuesto porque excede el cambio mínimo.

### TICK-309 — Cantidades inválidas · commit `9d2e3a5`

- **Causa raíz:** `parseInt` sin validar (vacío → `NaN`), sin `min`, y el submit no comprobaba nada; el backend tampoco (hasta el hardening `8e9bbf3`).
- **Corrección:** la cantidad se captura como texto y se valida (entero ≥ 1); cliente y % de estimación también; los problemas se listan visibles y el botón queda bloqueado. Defensa en profundidad: el backend valida lo mismo (nunca confiar solo en el cliente).

### TICK-302 — Montos del panel · commits `217fb4f` y `9d2e3a5`

- **Síntoma:** subtotales tipo `149.70000000000002` sin formato; total estimado ≠ total cobrado.
- **Causa raíz:** (a) aritmética de punto flotante mostrada cruda; (b) `money.ts` calculaba `subtotal + impuesto − descuento` con el impuesto sobre el subtotal **sin** descuento — ni siquiera coincidía con el backend *bugueado*, y menos con el corregido.
- **Corrección:** `money.ts` replica exactamente el cálculo del backend corregido (descuento redondeado → IVA 13% sobre base imponible → todo al centavo) y `formatearMoneda` usa `Intl.NumberFormat`. El subtotal por línea se muestra redondeado y formateado.

### TICK-305 — Errores invisibles · commits `3bac5ba` + pantallas

- **Causa raíz:** `api.ts` capturaba fallos y devolvía `[]` (buscador/reporte) o parseaba la respuesta sin revisar `res.ok` (crear pedido): una API caída parecía "0 resultados" y un 500 parecía pedido exitoso.
- **Corrección:** el cliente HTTP valida `res.ok`, extrae el detalle del `ProblemDetails` del backend y lanza `Error`; cada pantalla muestra el mensaje en un alert (`role="alert"`) y distingue "sin resultados" de "falló la llamada".

### TICK-306 — Falta el último día del reporte · commit `c1354ec`

- **Causa raíz:** el panel enviaba `hasta=YYYY-MM-DD` (equivale a las 00:00) y el backend filtra `FechaUtc <= hasta`: los pedidos del propio día quedaban fuera.
- **Corrección:** el límite superior viaja como fin de día (`T23:59:59.999`) y se valida `desde <= hasta`. (Alternativa considerada: filtro exclusivo `< hasta+1día` en el backend; descartada por tocar el contrato de la API.)

### TICK-304 — El reporte congela el navegador · commit `c1354ec`

- **Causa raíz:** se renderizaban **todas** las filas del rango en una sola pasada (cientos de miles de `<tr>`).
- **Corrección:** render paginado (200 filas + "Mostrar más", con contador "mostrando X de Y"); los totales se calculan sobre el rango completo. 
- **Nota:** la solución completa sería paginar en la API (`take/skip`) o virtualizar la tabla; documentado como mejora.

### Extras de frontend (sin ticket)

- **Claves de React**: listas con `key={index}` (líneas del pedido, filas del reporte) → claves estables (`id` incremental / `PedidoId`).
- **Accesibilidad:** `aria-label` en botones de icono (buscar, eliminar línea), `label` reales en los selects/cantidades (antes `span`), `role="alert"` en los mensajes de error, `aria-invalid` en cantidades erróneas.
- **Estado del pedido:** la API serializa el enum como número; el panel mostraba `1` o un badge verde solo para `Pagado`; ahora se traduce (`Pendiente/Pagado/Rechazado/Cancelado`) con color por severidad y muestra referencia de pago, motivo de rechazo y nota de descuento.
- **`encodeURIComponent`** en todos los parámetros de query (un término con `&`, `%` o espacios ya no rompe la URL).

---

## Verificación final

1. **Tests:** `dotnet test MercadoVerde.sln` (SDK 8 en contenedor) → **8/8 en verde, 0 skipped**: los 4 tests del evaluador (`TICK202/203/205/206`, ya sin `Skip`), los 2 nuevos del tope de descuento y las 2 pruebas de humo.
2. **Build del panel:** `next build` (type-check + ESLint) sin errores.
3. **Sistema completo:** `docker compose down -v && docker compose up --build` (la base se recrea por las columnas nuevas de `Pedido`) y batería E2E contra los contenedores:
   - Búsqueda normal OK; `termino='` → 200 vacío (antes 500); payload `' OR 1=1 --` → **0 productos** (antes devolvía todo el catálogo).
   - `POST` cliente 2 (sin email) → 200 (antes 500). En esa corrida además la pasarela simulada cayó y el pedido quedó **Pendiente** sin referencia (antes: "Pagado" fantasma).
   - `POST` con `PROMO50` → **400** con detalle "El cupón 'PROMO50' no existe." (antes 500).
   - Cantidad 0 → **400** con detalle (antes se aceptaba).
   - `BIENVENIDA10` sobre $25.00 → Descuento 2.50, **Impuesto 2.93, Total 25.43** (antes 3.25/25.75) y `ReferenciaPago` persistida.
   - Tope: `BIENVENIDA10` sobre Monitor $180 → descuento calculado 18.00 → **aplicado 15.00**, con `NotaDescuento` visible en la respuesta.
   - Concurrencia: dos compras simultáneas de la última unidad → una gana (Pagado), la otra recibe 400 "Stock insuficiente" **sin ser cobrada**; stock final 0, nunca negativo.
   - Reporte con 20,000 pedidos sembrados: **6.97 s → 0.087 s** (~80×), incluyendo el día final del rango.
   - Panel: `/`, `/pedidos` y `/reportes` responden 200; `dangerouslySetInnerHTML` eliminado del código.

## Herramientas y tiempo

- Trabajé con mi IDE, Docker, `curl`/Swagger y **asistencia de IA (Claude Code)** para acelerar la exploración del código, la redacción de esta bitácora y la generación de casos de prueba; cada corrección fue reproducida antes de tocar código y verificada después con tests y la batería E2E de arriba (lo documenta la regla de la prueba sobre herramientas consultadas).
- Tiempo total efectivo de la sesión de resolución: **~2 horas** (backend + frontend + documentación), una vez instaladas las herramientas (la descarga inicial de imágenes de Docker corrió en paralelo).
