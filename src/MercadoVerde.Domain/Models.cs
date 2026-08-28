namespace MercadoVerde.Domain;

public class Producto
{
    public int Id { get; set; }
    public string Nombre { get; set; } = string.Empty;
    public decimal Precio { get; set; }
    public int Stock { get; set; }
    public bool Activo { get; set; } = true;

    // Token de concurrencia. Está declarado pero NO se usa en el flujo de descuento de stock.
    public byte[]? RowVersion { get; set; }
}

public class Cliente
{
    public int Id { get; set; }
    public string Nombre { get; set; } = string.Empty;
    public string? Email { get; set; }
}

public class Cupon
{
    public int Id { get; set; }
    public string Codigo { get; set; } = string.Empty;
    public decimal PorcentajeDescuento { get; set; }   // 0..100
    public DateTime FechaExpiracionUtc { get; set; }    // se persiste en UTC
    public bool Activo { get; set; } = true;
}

public class Pedido
{
    public int Id { get; set; }
    public int ClienteId { get; set; }
    public Cliente? Cliente { get; set; }
    public DateTime FechaUtc { get; set; }
    public string? CodigoCupon { get; set; }

    public decimal Subtotal { get; set; }
    public decimal Descuento { get; set; }
    public decimal Impuesto { get; set; }
    public decimal Total { get; set; }

    public EstadoPedido Estado { get; set; } = EstadoPedido.Pendiente;

    // Trazabilidad del cobro: referencia devuelta por la pasarela cuando el
    // pago fue aprobado, y motivo cuando no lo fue (para conciliación/soporte).
    public string? ReferenciaPago { get; set; }
    public string? MotivoRechazo { get; set; }

    public List<LineaPedido> Lineas { get; set; } = new();
}

public class LineaPedido
{
    public int Id { get; set; }
    public int PedidoId { get; set; }
    public int ProductoId { get; set; }
    public Producto? Producto { get; set; }
    public int Cantidad { get; set; }
    public decimal PrecioUnitario { get; set; }
}
