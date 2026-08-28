using System.Linq;
using MercadoVerde.Application.Abstractions;
using MercadoVerde.Application.Dtos;
using MercadoVerde.Domain;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace MercadoVerde.Application.Services;

public class PedidoService
{
    private const decimal TasaImpuesto = 0.13m; // IVA 13%

    private readonly ITiendaDbContext _db;
    private readonly InventarioService _inventario;
    private readonly IPasarelaPagoService _pasarela;
    private readonly ILogger<PedidoService> _logger;

    public PedidoService(ITiendaDbContext db, InventarioService inventario, IPasarelaPagoService pasarela,
        ILogger<PedidoService>? logger = null)
    {
        _db = db;
        _inventario = inventario;
        _pasarela = pasarela;
        _logger = logger ?? NullLogger<PedidoService>.Instance;
    }

    public Pedido CrearPedido(CrearPedidoDto dto)
    {
        var cliente = _db.Clientes.FirstOrDefault(c => c.Id == dto.ClienteId);
        if (cliente == null)
            throw new InvalidOperationException("Cliente no encontrado.");

        var pedido = new Pedido
        {
            ClienteId = cliente.Id,
            FechaUtc = DateTime.UtcNow,
            CodigoCupon = dto.CodigoCupon,
            Estado = EstadoPedido.Pendiente
        };

        // 1) Construir líneas y subtotal
        decimal subtotal = 0m;
        foreach (var l in dto.Lineas)
        {
            var producto = _db.Productos.FirstOrDefault(p => p.Id == l.ProductoId);
            if (producto == null)
                throw new InvalidOperationException($"Producto {l.ProductoId} no existe.");

            // Verificación temprana de stock: si no alcanza, se rechaza el pedido
            // ANTES de cobrar (evita cobros por mercancía inexistente).
            if (producto.Stock < l.Cantidad)
                throw new InvalidOperationException(
                    $"Stock insuficiente para el producto {producto.Nombre}.");

            var linea = new LineaPedido
            {
                ProductoId = producto.Id,
                Cantidad = l.Cantidad,
                PrecioUnitario = producto.Precio
            };
            pedido.Lineas.Add(linea);
            subtotal += producto.Precio * l.Cantidad;
        }

        // 2) Aplicar cupón (si viene)
        decimal descuento = 0m;
        if (!string.IsNullOrWhiteSpace(dto.CodigoCupon))
        {
            var cupon = _db.Cupones.FirstOrDefault(c => c.Codigo == dto.CodigoCupon);

            // Un código que no existe en la base (p. ej. una campaña publicada
            // pero nunca registrada) es un error de negocio controlado, no un 500.
            if (cupon == null)
                throw new InvalidOperationException($"El cupón '{dto.CodigoCupon}' no existe.");

            // Validar vigencia del cupón. La expiración se persiste en UTC, así
            // que se compara contra la hora UTC (no la hora local del servidor).
            if (cupon.FechaExpiracionUtc >= DateTime.UtcNow && cupon.Activo)
            {
                descuento = Math.Round(subtotal * (cupon.PorcentajeDescuento / 100m),
                    2, MidpointRounding.AwayFromZero);
            }
            else
            {
                throw new InvalidOperationException($"El cupón '{dto.CodigoCupon}' no está vigente.");
            }
        }

        // 3) Calcular impuesto y total. El impuesto grava la base imponible
        //    (subtotal - descuento) y todos los montos se redondean al centavo.
        decimal baseImponible = subtotal - descuento;
        decimal impuesto = Math.Round(baseImponible * TasaImpuesto,
            2, MidpointRounding.AwayFromZero);
        decimal total = baseImponible + impuesto;

        pedido.Subtotal = subtotal;
        pedido.Descuento = descuento;
        pedido.Impuesto = impuesto;
        pedido.Total = total;

        // 4) Cobrar con la pasarela de pago
        try
        {
            var resultado = _pasarela.Cobrar(total, $"Pedido cliente {cliente.Nombre}");
            if (resultado.Aprobado)
            {
                pedido.Estado = EstadoPedido.Pagado;
                pedido.ReferenciaPago = resultado.Referencia;
            }
            else
            {
                pedido.Estado = EstadoPedido.Rechazado;
                pedido.MotivoRechazo = resultado.MotivoRechazo;
                _logger.LogWarning(
                    "Cobro rechazado por la pasarela (cliente {ClienteId}): {Motivo}",
                    cliente.Id, resultado.MotivoRechazo);
            }
        }
        catch (Exception ex)
        {
            // El proveedor no respondió: el cobro NO está confirmado, así que el
            // pedido no puede quedar Pagado. Queda Pendiente para reintento o
            // conciliación, y la falla queda registrada (nunca invisible).
            pedido.Estado = EstadoPedido.Pendiente;
            pedido.MotivoRechazo = "La pasarela de pago no respondió; cobro no confirmado.";
            _logger.LogError(ex,
                "Fallo de la pasarela al cobrar pedido del cliente {ClienteId}; el pedido queda Pendiente para conciliación.",
                cliente.Id);
        }

        // 5) Descontar inventario, solo si el cobro fue aprobado: un pedido
        //    rechazado o pendiente no debe consumir stock.
        if (pedido.Estado == EstadoPedido.Pagado)
        {
            var lineasDescontadas = new List<LineaPedido>();
            try
            {
                foreach (var linea in pedido.Lineas)
                {
                    _inventario.DescontarStock(linea.ProductoId, linea.Cantidad);
                    lineasDescontadas.Add(linea);
                }
            }
            catch (InvalidOperationException ex)
            {
                // Carrera residual: otro pedido consumió el stock entre la
                // verificación inicial y el descuento, con el cobro ya hecho.
                // Se repone lo descontado, el pedido queda Pendiente (no Pagado)
                // y la situación queda registrada para reversar el cobro.
                foreach (var linea in lineasDescontadas)
                    _inventario.ReponerStock(linea.ProductoId, linea.Cantidad);

                pedido.Estado = EstadoPedido.Pendiente;
                pedido.MotivoRechazo =
                    $"Stock agotado tras el cobro (ref {pedido.ReferenciaPago}); requiere reverso del pago.";
                _logger.LogCritical(ex,
                    "Pedido del cliente {ClienteId} cobrado (ref {Referencia}) sin stock disponible; requiere reverso del pago.",
                    cliente.Id, pedido.ReferenciaPago);
            }
        }

        // 6) Generar el comprobante de confirmación que se envía por correo al cliente.
        GenerarLineaComprobante(pedido);

        // 7) Persistir el pedido
        _db.Pedidos.Add(pedido);
        _db.SaveChanges();

        return pedido;
    }

    // Envía el comprobante por correo. El email del cliente puede no estar registrado.
    public string GenerarLineaComprobante(Pedido pedido)
    {
        var cliente = _db.Clientes.FirstOrDefault(c => c.Id == pedido.ClienteId);
        var destinatario = string.IsNullOrWhiteSpace(cliente?.Email)
            ? $"{cliente?.Nombre ?? "cliente " + pedido.ClienteId} (sin correo registrado)"
            : cliente!.Email.ToUpperInvariant();
        return $"Comprobante para {destinatario} - Total: {pedido.Total:C}";
    }
}
