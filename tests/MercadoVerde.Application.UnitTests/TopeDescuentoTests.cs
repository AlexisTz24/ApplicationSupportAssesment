using FluentAssertions;
using MercadoVerde.Application.Abstractions;
using MercadoVerde.Application.Dtos;
using MercadoVerde.Application.Services;
using MercadoVerde.Domain;
using MercadoVerde.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace MercadoVerde.Application.UnitTests;

/// <summary>
/// Parte 4 — Regla de negocio nueva: ningún cupón puede descontar más de
/// $15.00 por pedido. Si el cálculo lo supera se aplica el tope y se deja
/// constancia (Pedido.NotaDescuento + log).
/// </summary>
public class TopeDescuentoTests
{
    private static TiendaDbContext NuevaBdEnMemoria()
    {
        var options = new DbContextOptionsBuilder<TiendaDbContext>()
            .UseInMemoryDatabase($"mv-tope-{Guid.NewGuid()}")
            .Options;
        return new TiendaDbContext(options);
    }

    private static PedidoService NuevoServicio(TiendaDbContext db)
        => new(db, new InventarioService(db), new PasarelaAprueba());

    [Fact]
    public void DescuentoQueSuperaElTope_AplicaQuinceYDejaConstancia()
    {
        using var db = NuevaBdEnMemoria();
        db.Clientes.Add(new Cliente { Id = 1, Nombre = "Ana", Email = "ana@example.com" });
        db.Productos.Add(new Producto { Id = 1, Nombre = "Producto", Precio = 100m, Stock = 10, Activo = true });
        db.Cupones.Add(new Cupon { Id = 1, Codigo = "MEGA50", PorcentajeDescuento = 50m,
            FechaExpiracionUtc = DateTime.UtcNow.AddYears(1), Activo = true });
        db.SaveChanges();

        var pedido = NuevoServicio(db).CrearPedido(new CrearPedidoDto
        {
            ClienteId = 1,
            CodigoCupon = "MEGA50",
            Lineas = { new LineaPedidoDto { ProductoId = 1, Cantidad = 1 } }
        });

        // 50% de 100 = 50.00 → supera el tope → se aplican 15.00.
        // Impuesto sobre la base con descuento: (100 - 15) * 0.13 = 11.05.
        pedido.Descuento.Should().Be(15.00m);
        pedido.Impuesto.Should().Be(11.05m);
        pedido.Total.Should().Be(96.05m);
        pedido.NotaDescuento.Should().NotBeNullOrEmpty("debe quedar constancia del tope aplicado");
    }

    [Fact]
    public void DescuentoBajoElTope_NoSeAlteraNiDejaNota()
    {
        using var db = NuevaBdEnMemoria();
        db.Clientes.Add(new Cliente { Id = 1, Nombre = "Ana", Email = "ana@example.com" });
        db.Productos.Add(new Producto { Id = 1, Nombre = "Producto", Precio = 100m, Stock = 10, Activo = true });
        db.Cupones.Add(new Cupon { Id = 1, Codigo = "DESC10", PorcentajeDescuento = 10m,
            FechaExpiracionUtc = DateTime.UtcNow.AddYears(1), Activo = true });
        db.SaveChanges();

        var pedido = NuevoServicio(db).CrearPedido(new CrearPedidoDto
        {
            ClienteId = 1,
            CodigoCupon = "DESC10",
            Lineas = { new LineaPedidoDto { ProductoId = 1, Cantidad = 1 } }
        });

        pedido.Descuento.Should().Be(10.00m);
        pedido.NotaDescuento.Should().BeNull();
    }

    private sealed class PasarelaAprueba : IPasarelaPagoService
    {
        public ResultadoCobro Cobrar(decimal monto, string descripcion)
            => new() { Aprobado = true, Referencia = "TEST-REF" };
    }
}
