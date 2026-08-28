using Microsoft.EntityFrameworkCore;
using MercadoVerde.Application.Abstractions;
using MercadoVerde.Domain;

namespace MercadoVerde.Infrastructure.Data;

public class TiendaDbContext : DbContext, ITiendaDbContext
{
    public TiendaDbContext(DbContextOptions<TiendaDbContext> options) : base(options) { }

    public DbSet<Producto> Productos => Set<Producto>();
    public DbSet<Cliente> Clientes => Set<Cliente>();
    public DbSet<Cupon> Cupones => Set<Cupon>();
    public DbSet<Pedido> Pedidos => Set<Pedido>();
    public DbSet<LineaPedido> LineasPedido => Set<LineaPedido>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Producto>().Property(p => p.Precio).HasColumnType("decimal(18,2)");
        modelBuilder.Entity<Pedido>().Property(p => p.Total).HasColumnType("decimal(18,2)");

        // Concurrencia optimista sobre el stock: si dos peticiones leen el mismo
        // valor y ambas intentan escribir, la segunda recibe
        // DbUpdateConcurrencyException en vez de pisar el descuento de la primera.
        // (Se usa el propio Stock como token por ser portable entre PostgreSQL,
        // SQLite e InMemory, los tres proveedores con los que corre la solución.)
        modelBuilder.Entity<Producto>().Property(p => p.Stock).IsConcurrencyToken();

        // Un código de cupón no puede existir dos veces: sin este índice, un
        // re-registro de campaña duplicado haría que FirstOrDefault aplique un
        // cupón no determinista.
        modelBuilder.Entity<Cupon>().HasIndex(c => c.Codigo).IsUnique();

        base.OnModelCreating(modelBuilder);
    }
}
