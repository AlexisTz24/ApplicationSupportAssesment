# Prueba técnica — Soporte de Sistemas .NET · MercadoVerde

Bienvenido/a. Este repositorio contiene una **aplicación real con problemas reales**. Tu objetivo es comportarte como lo harías en un equipo de soporte de aplicaciones: entender un sistema que no escribiste, diagnosticar fallas a partir de evidencia, corregirlas con cuidado y comunicar lo que hiciste.

> Es un sistema de e-commerce (no bancario) a propósito: queremos ver tu capacidad técnica y de razonamiento, no tu conocimiento previo de un dominio. **Si algo no funciona, ese suele ser el punto.**

## 📋 Antes de empezar

**Requisitos previos**
- [Docker](https://docs.docker.com/get-docker/) con **Docker Compose v2** (`docker compose version`). Es la forma recomendada de levantar todo.
- Git.
- *Opcional (solo si quieres correr/depurar fuera de contenedores):* [.NET SDK 8](https://dotnet.microsoft.com/download) y [Node.js 18+](https://nodejs.org).

**Pasos**
1. Lee **[`PRUEBA.md`](./PRUEBA.md)** completo. Ahí están las 6 partes del ejercicio, los tiempos sugeridos y lo que debes entregar.
2. Revisa la bandeja de incidentes (Anexos A y B de `PRUEBA.md`) y los logs en **[`logs-produccion.txt`](./logs-produccion.txt)**.
3. **Levanta el sistema** con `docker compose up --build` (ver abajo). Arranca base de datos, API y panel juntos.
4. Crea tu rama de trabajo antes de tocar nada: `git checkout -b solucion-<tu-nombre>`.

## 🧱 El sistema

Tienda en línea de accesorios tecnológicos, en dos piezas:

- **Backend** (`src/`) — API REST con arquitectura por capas (Clean Architecture).
  - **Stack:** ASP.NET Core 8 · Entity Framework Core · **PostgreSQL**
  - **Capas:** `MercadoVerde.Domain` (entidades) · `MercadoVerde.Application` (DTOs, puertos y servicios) · `MercadoVerde.Infrastructure` (EF Core, repositorio, pasarela, seed) · `MercadoVerde.WebApi` (controllers + arranque).
  - **Módulos:** catálogo, pedidos (con cupones e impuestos), cobro vía pasarela externa simulada, y reportes de ventas.
- **Frontend** (`frontend/`) — panel interno de soporte que consume la API.
  - **Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui
  - **Pantallas:** buscador de catálogo, alta de pedidos y reporte de ventas.

> El frontend **también tiene incidentes a propósito**, de distinta naturaleza y
> dificultad (desde detalles mecánicos hasta problemas sutiles de concurrencia,
> fechas y rendimiento). Si el rol incluye soporte de frontend, revisa la
> **Parte 6** y el **Anexo B** de `PRUEBA.md` y el
> [`frontend/README.md`](./frontend/README.md).

### Cómo ejecutarlo (Docker Compose — recomendado)

Toda la solución corre en contenedores: PostgreSQL, la API y el panel.

```bash
docker compose up --build
```

Esto levanta tres servicios:

| Servicio | URL / puerto | Qué es |
|---|---|---|
| `db`  | `localhost:5433` → 5432 | PostgreSQL 16 (datos en el volumen `pgdata`) |
| `api` | `http://localhost:5080/swagger` | API .NET (se conecta a `db` y siembra la base al iniciar) |
| `web` | `http://localhost:3000` | Panel de soporte (Next.js) |

Para detener: `Ctrl+C` (o `docker compose down`). Para **reiniciar los datos** desde cero:
`docker compose down -v` (borra el volumen de PostgreSQL) y vuelve a `docker compose up`.

> **Tests:** `dotnet test MercadoVerde.sln` corre la batería de pruebas sin
> necesidad de PostgreSQL (usan SQLite en memoria). Requiere el SDK de .NET.

> *Sin contenedores (opcional):* puedes correr la API con
> `dotnet run --project src/MercadoVerde.WebApi` y el panel con `npm run dev`
> (en `frontend/`), pero necesitas un PostgreSQL accesible y ajustar la cadena de
> conexión (`ConnectionStrings__Default`) y `NEXT_PUBLIC_API_BASE`.

| Método | Ruta | Descripción |
|---|---|---|
| GET  | `/api/productos/buscar?termino=mouse` | Busca productos por nombre |
| POST | `/api/pedidos` | Crea un pedido (cobra y descuenta stock) |
| GET  | `/api/reportes/ventas?desde=...&hasta=...` | Reporte de ventas por rango |

Cuerpo de ejemplo para `POST /api/pedidos`:
```json
{ "clienteId": 1, "codigoCupon": "BIENVENIDA10", "lineas": [ { "productoId": 2, "cantidad": 1 } ] }
```

## 📦 Qué entregar

1. **Tu código corregido.** Trabaja en una rama (`git checkout -b solucion-<tu-nombre>`) con **commits pequeños y mensajes claros** (uno por incidente, idealmente).
2. **`HALLAZGOS.md`** — tu bitácora: qué encontraste, en qué archivo, por qué pasaba y cómo lo resolviste.
3. **Tus respuestas a las Partes 0, 1, 2 y 5** (van dentro de `HALLAZGOS.md`; sigue la plantilla que trae `PRUEBA.md`).

Entrega como Pull Request hacia este repositorio (o como `.zip` si así se acordó). Trabaja en una rama `solucion-<tu-nombre>` con commits atómicos.

## ✅ Qué evaluamos

Diagnóstico y causa raíz · corrección de código y dominio de .NET/EF · pensamiento crítico · calidad y **seguridad** · gestión y priorización de incidentes · comunicación. No buscamos que lo termines todo: valoramos **cómo** razonas y trabajas tanto como el resultado.

### Verifica que todo funciona (línea base)

Tras `docker compose up --build`, confirma cómo se ve el sistema **sano**. Así tendrás contra qué comparar los síntomas de los tickets:

1. **API:** abre `http://localhost:5080/swagger` y ejecuta `GET /api/productos/buscar?termino=mouse`. Debe responder `200` con productos.
2. **Pedido:** ejecuta `POST /api/pedidos` con el cuerpo de ejemplo de arriba. Debe devolver un pedido con su total.
3. **Panel (si aplica):** abre `http://localhost:3000`, busca un producto y crea un pedido desde la interfaz.

### Problemas comunes

- **Algún puerto está ocupado** (`5080`, `3000` o `5433`): libera el proceso que lo usa o cambia el mapeo en `docker-compose.yml`. Ojo: la API espera al panel en `http://localhost:3000` (CORS) y el panel llama a la API en `http://localhost:5080`; si cambias esos puertos, ajusta también el origen de CORS en `src/MercadoVerde.WebApi/Program.cs` y el build arg `NEXT_PUBLIC_API_BASE` del servicio `web`.
- **El panel no trae datos o muestra errores de red:** confirma que el servicio `api` está arriba (`docker compose ps`) y revisa sus logs (`docker compose logs api`).
- **La API no conecta a la base:** Compose espera a que `db` esté *healthy* antes de arrancar `api`; si falla, mira `docker compose logs db`.
- **Quiero reiniciar los datos:** `docker compose down -v` borra el volumen `pgdata`; al volver a `up` la base se siembra de nuevo.
- **Vengo de la rama `main` con un volumen viejo:** la rama de solución agrega columnas a `Pedido` (`ReferenciaPago`, `MotivoRechazo`, `NotaDescuento`) y el esquema se crea con `EnsureCreated`, así que es **obligatorio** `docker compose down -v` antes de `docker compose up --build`; de lo contrario verás errores `column ... does not exist`.

## 📁 Mapa de archivos clave

**Backend**
- `src/MercadoVerde.Application/Services/PedidoService.cs` — cálculo, cobro y descuento de stock.
- `src/MercadoVerde.Application/Services/InventarioService.cs` — descuento de stock.
- `src/MercadoVerde.Application/Services/ReporteService.cs` — reporte de ventas.
- `src/MercadoVerde.Application/Abstractions/` — puertos (`ITiendaDbContext`, `IProductoRepository`, `IPasarelaPagoService`).
- `src/MercadoVerde.Infrastructure/Data/ProductoRepository.cs` — búsqueda de catálogo.
- `src/MercadoVerde.Infrastructure/Data/TiendaDbContext.cs` — contexto EF Core y configuración.
- `src/MercadoVerde.Infrastructure/Payments/PasarelaPagoService.cs` — pasarela de pago simulada.
- `src/MercadoVerde.Domain/Models.cs` — entidades de dominio.

**Frontend**
- `frontend/lib/api.ts` — cliente HTTP hacia la API.
- `frontend/lib/money.ts` — cálculo y formato de montos del panel.
- `frontend/components/buscador-productos.tsx` — buscador del catálogo.
- `frontend/components/crear-pedido-form.tsx` — alta de pedidos y cobro.
- `frontend/components/reporte-ventas.tsx` — reporte de ventas.

**Contenedores**
- `docker-compose.yml` — orquesta `db` (PostgreSQL), `api` y `web`.
- `src/MercadoVerde.WebApi/Dockerfile` — imagen de la API (.NET 8).
- `frontend/Dockerfile` — imagen del panel (Next.js standalone).

¡Éxitos! Trabaja con calma y documenta tu razonamiento.
