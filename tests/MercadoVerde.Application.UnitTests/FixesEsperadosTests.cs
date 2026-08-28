using FluentAssertions;
using MercadoVerde.Application.Abstractions;
using MercadoVerde.Application.Dtos;
using MercadoVerde.Application.Services;
using MercadoVerde.Domain;
using MercadoVerde.Infrastructure.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace MercadoVerde.Application.UnitTests;

/// <summary>
/// Tests que describen el comportamiento CORRECTO esperado tras corregir cada
/// defecto. Están en <c>Skip</c> a propósito: con los bugs presentes fallarían.
/// Criterio objetivo de corrección: el candidato quita el <c>Skip</c> del ticket
/// que resolvió y el test debe pasar (sin romper los demás).
/// </summary>
public class FixesEsperadosTests
{
    // ---------- helpers ----------

    private static TiendaDbContext NuevaBdEnMemoria()
    {
        var options = new DbContextOptionsBuilder<TiendaDbContext>()
            .UseInMemoryDatabase($"mv-{Guid.NewGuid()}")
            .Options;
        return new TiendaDbContext(options);
    }

    private static PedidoService NuevoServicio(TiendaDbContext db, IPasarelaPagoService pasarela)
        => new(db, new InventarioService(db), pasarela);

    // ====================================================================
    // TICK-202 — El impuesto debe calcularse sobre (subtotal - descuento)
    // ====================================================================
    [Fact]
    public void TICK202_Impuesto_SeCalculaSobreSubtotalConDescuento()
    {
        using var db = NuevaBdEnMemoria();
        db.Clientes.Add(new Cliente { Id = 1, Nombre = "Ana", Email = "ana@example.com" });
        db.Productos.Add(new Producto { Id = 1, Nombre = "Producto", Precio = 100m, Stock = 10, Activo = true });
        db.Cupones.Add(new Cupon { Id = 1, Codigo = "DESC10", PorcentajeDescuento = 10m,
            FechaExpiracionUtc = DateTime.UtcNow.AddYears(1), Activo = true });
        db.SaveChanges();

        var pedido = NuevoServicio(db, new PasarelaAprueba()).CrearPedido(new CrearPedidoDto
        {
            ClienteId = 1,
            CodigoCupon = "DESC10",
            Lineas = { new LineaPedidoDto { ProductoId = 1, Cantidad = 1 } }
        });

        // subtotal 100 · descuento 10 · base imponible 90 · impuesto 90*0.13 = 11.70
        pedido.Subtotal.Should().Be(100m);
        pedido.Descuento.Should().Be(10m);
        pedido.Impuesto.Should().Be(11.70m);   // bug actual: 13.00
        pedido.Total.Should().Be(101.70m);      // bug actual: 103.00
    }

    // ====================================================================
    // TICK-203 — Un cupón inexistente no debe reventar con NullReference (500)
    // ====================================================================
    [Fact]
    public void TICK203_CuponInexistente_NoLanzaNullReference()
    {
        using var db = NuevaBdEnMemoria();
        db.Clientes.Add(new Cliente { Id = 1, Nombre = "Ana", Email = "ana@example.com" });
        db.Productos.Add(new Producto { Id = 1, Nombre = "Producto", Precio = 50m, Stock = 10, Activo = true });
        db.SaveChanges();

        var act = () => NuevoServicio(db, new PasarelaAprueba()).CrearPedido(new CrearPedidoDto
        {
            ClienteId = 1,
            CodigoCupon = "PROMO50", // no existe en la base
            Lineas = { new LineaPedidoDto { ProductoId = 1, Cantidad = 1 } }
        });

        // Aceptable: ignorar el cupón inválido (descuento 0) o un error de dominio
        // controlado. Lo que NO es aceptable es la NullReferenceException actual.
        act.Should().NotThrow<NullReferenceException>();
    }

    // ====================================================================
    // TICK-205 — Si el cobro falla, el pedido NO puede quedar "Pagado"
    // ====================================================================
    [Fact]
    public void TICK205_CobroQueFalla_NoDejaPedidoPagado()
    {
        using var db = NuevaBdEnMemoria();
        db.Clientes.Add(new Cliente { Id = 1, Nombre = "Ana", Email = "ana@example.com" });
        db.Productos.Add(new Producto { Id = 1, Nombre = "Producto", Precio = 50m, Stock = 10, Activo = true });
        db.SaveChanges();

        var pedido = NuevoServicio(db, new PasarelaCae()).CrearPedido(new CrearPedidoDto
        {
            ClienteId = 1,
            Lineas = { new LineaPedidoDto { ProductoId = 1, Cantidad = 1 } }
        });

        // bug actual: el catch marca Pagado. Tras el fix debe quedar Pendiente/Rechazado.
        pedido.Estado.Should().NotBe(EstadoPedido.Pagado);
    }

    // ====================================================================
    // TICK-206 — El buscador no debe ser vulnerable a inyección SQL
    // (usa SQLite real en memoria porque el repo usa FromSqlRaw)
    // ====================================================================
    [Fact]
    public void TICK206_Buscador_NoPermiteInyeccionNiRompeConComilla()
    {
        using var conn = new SqliteConnection("DataSource=:memory:");
        conn.Open();
        var options = new DbContextOptionsBuilder<TiendaDbContext>().UseSqlite(conn).Options;
        using var db = new TiendaDbContext(options);
        db.Database.EnsureCreated();
        db.Productos.Add(new Producto { Nombre = "Mouse", Precio = 10m, Stock = 1, Activo = true });
        db.SaveChanges();

        var repo = new ProductoRepository(db);

        // (a) un término con comilla no debe romper la consulta (bug actual: SqliteException)
        var conComilla = () => repo.BuscarPorNombre("x'");
        conComilla.Should().NotThrow();

        // (b) un payload de inyección no debe devolver todo el catálogo (bug actual: lo devuelve)
        repo.BuscarPorNombre("' OR 1=1 --").Should().BeEmpty();
    }

    // ---------- pasarelas de prueba ----------

    private sealed class PasarelaAprueba : IPasarelaPagoService
    {
        public ResultadoCobro Cobrar(decimal monto, string descripcion)
            => new() { Aprobado = true, Referencia = "TEST-REF" };
    }

    private sealed class PasarelaCae : IPasarelaPagoService
    {
        public ResultadoCobro Cobrar(decimal monto, string descripcion)
            => throw new TimeoutException("Proveedor de pago caído (simulado).");
    }
}
