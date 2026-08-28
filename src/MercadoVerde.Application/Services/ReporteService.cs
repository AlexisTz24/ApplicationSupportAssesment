using System.Linq;
using MercadoVerde.Application.Abstractions;

namespace MercadoVerde.Application.Services;

public class ReporteService
{
    private readonly ITiendaDbContext _db;

    public ReporteService(ITiendaDbContext db)
    {
        _db = db;
    }

    public class FilaReporte
    {
        public int PedidoId { get; set; }
        public string Cliente { get; set; } = string.Empty;
        public int CantidadArticulos { get; set; }
        public decimal Total { get; set; }
    }

    // Genera el reporte de ventas de un rango de fechas.
    // En producción la tabla Pedidos tiene cientos de miles de filas, por lo que
    // el reporte se resuelve en UNA sola consulta proyectada en la base de datos
    // (nada de volver por las líneas y el cliente pedido por pedido: eso eran
    // 2N+1 consultas y decenas de segundos).
    public List<FilaReporte> GenerarReporteVentas(DateTime desdeUtc, DateTime hastaUtc)
    {
        return _db.Pedidos
            .Where(p => p.FechaUtc >= desdeUtc && p.FechaUtc <= hastaUtc)
            .Select(p => new FilaReporte
            {
                PedidoId = p.Id,
                Cliente = p.Cliente != null ? p.Cliente.Nombre : "(desconocido)",
                CantidadArticulos = p.Lineas.Sum(l => (int?)l.Cantidad) ?? 0,
                Total = p.Total
            })
            .ToList();
    }
}
