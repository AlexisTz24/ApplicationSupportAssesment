using Microsoft.AspNetCore.Mvc;
using MercadoVerde.Application.Abstractions;
using MercadoVerde.Application.Dtos;
using MercadoVerde.Application.Services;

namespace MercadoVerde.WebApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProductosController : ControllerBase
{
    private readonly IProductoRepository _repo;
    public ProductosController(IProductoRepository repo) => _repo = repo;

    // GET /api/productos/buscar?termino=mouse
    [HttpGet("buscar")]
    public IActionResult Buscar([FromQuery] string termino)
    {
        var resultado = _repo.BuscarPorNombre(termino ?? string.Empty);
        return Ok(resultado);
    }
}

[ApiController]
[Route("api/[controller]")]
public class PedidosController : ControllerBase
{
    private readonly PedidoService _pedidos;
    private readonly ILogger<PedidosController> _logger;

    public PedidosController(PedidoService pedidos, ILogger<PedidosController> logger)
    {
        _pedidos = pedidos;
        _logger = logger;
    }

    // POST /api/pedidos
    [HttpPost]
    public IActionResult Crear([FromBody] CrearPedidoDto dto)
    {
        try
        {
            var pedido = _pedidos.CrearPedido(dto);
            return Ok(pedido);
        }
        catch (InvalidOperationException ex)
        {
            // Error de negocio esperado (cliente/producto/cupón inválido, stock
            // insuficiente): se responde 400 con el detalle en vez de un 500 crudo.
            _logger.LogWarning("Pedido rechazado por regla de negocio: {Motivo}", ex.Message);
            return BadRequest(new ProblemDetails
            {
                Title = "No se pudo crear el pedido.",
                Detail = ex.Message,
                Status = StatusCodes.Status400BadRequest
            });
        }
    }
}

[ApiController]
[Route("api/[controller]")]
public class ReportesController : ControllerBase
{
    private readonly ReporteService _reportes;
    public ReportesController(ReporteService reportes) => _reportes = reportes;

    // GET /api/reportes/ventas?desde=2025-01-01&hasta=2025-12-31
    [HttpGet("ventas")]
    public IActionResult Ventas([FromQuery] DateTime desde, [FromQuery] DateTime hasta)
    {
        return Ok(_reportes.GenerarReporteVentas(desde, hasta));
    }
}
