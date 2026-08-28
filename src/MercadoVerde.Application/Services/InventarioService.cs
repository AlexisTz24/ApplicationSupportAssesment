using System.Linq;
using MercadoVerde.Application.Abstractions;
using Microsoft.EntityFrameworkCore;

namespace MercadoVerde.Application.Services;

public class InventarioService
{
    private const int MaxIntentos = 3;

    private readonly ITiendaDbContext _db;

    public InventarioService(ITiendaDbContext db)
    {
        _db = db;
    }

    // Descuenta 'cantidad' unidades del stock del producto.
    // Este método es invocado al confirmar cada pedido.
    //
    // El descuento es seguro bajo concurrencia: Producto.Stock actúa como token
    // de concurrencia optimista (ver TiendaDbContext), así que si otra petición
    // modificó el stock entre la lectura y la escritura, SaveChanges lanza
    // DbUpdateConcurrencyException; se recarga el valor real y se reintenta,
    // re-validando que el stock siga alcanzando (nunca queda negativo).
    public void DescontarStock(int productoId, int cantidad)
    {
        for (var intento = 1; ; intento++)
        {
            var producto = _db.Productos.FirstOrDefault(p => p.Id == productoId);
            if (producto == null)
                throw new InvalidOperationException($"Producto {productoId} no existe.");

            // Se lee el stock, se valida y luego se actualiza.
            if (producto.Stock < cantidad)
                throw new InvalidOperationException(
                    $"Stock insuficiente para el producto {producto.Nombre}.");

            producto.Stock = producto.Stock - cantidad;
            try
            {
                _db.SaveChanges();
                return;
            }
            catch (DbUpdateConcurrencyException ex) when (intento < MaxIntentos)
            {
                // Otra petición ganó la carrera: recargar el estado real de la
                // base y volver a validar/descontar.
                foreach (var entry in ex.Entries)
                    entry.Reload();
            }
        }
    }

    // Repone unidades al stock (compensación cuando un pedido cobrado no pudo
    // completar el descuento de todas sus líneas).
    public void ReponerStock(int productoId, int cantidad)
    {
        for (var intento = 1; ; intento++)
        {
            var producto = _db.Productos.FirstOrDefault(p => p.Id == productoId);
            if (producto == null)
                return;

            producto.Stock = producto.Stock + cantidad;
            try
            {
                _db.SaveChanges();
                return;
            }
            catch (DbUpdateConcurrencyException ex) when (intento < MaxIntentos)
            {
                foreach (var entry in ex.Entries)
                    entry.Reload();
            }
        }
    }
}
