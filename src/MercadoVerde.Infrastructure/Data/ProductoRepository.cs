using System.Linq;
using Microsoft.EntityFrameworkCore;
using MercadoVerde.Application.Abstractions;
using MercadoVerde.Domain;

namespace MercadoVerde.Infrastructure.Data;

public class ProductoRepository : IProductoRepository
{
    private readonly TiendaDbContext _db;

    public ProductoRepository(TiendaDbContext db)
    {
        _db = db;
    }

    // Búsqueda de productos por nombre para el catálogo público.
    // El término de búsqueda llega directamente desde la query string del usuario,
    // por lo que SIEMPRE debe viajar como parámetro (nunca concatenado al SQL).
    public List<Producto> BuscarPorNombre(string termino)
    {
        // Los comodines de LIKE (%, _) se escapan para que se busquen literalmente.
        var patron = "%" + EscaparComodinesLike(termino.ToLower()) + "%";
        return _db.Productos
            .Where(p => p.Activo && EF.Functions.Like(p.Nombre.ToLower(), patron, "\\"))
            .ToList();
    }

    private static string EscaparComodinesLike(string termino) =>
        termino.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    public Producto? ObtenerPorId(int id) => _db.Productos.FirstOrDefault(p => p.Id == id);
}
