import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';
import * as q from './queries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

// Envuelve un handler async, abre un contexto de caché por request, maneja
// errores de forma uniforme, y emite el header X-Cache con los eventos de
// caché que ocurrieron durante el request (formato 'HIT cache:key ttl=180'
// o 'MISS cache:key ttl=300', múltiples eventos separados por coma).
const wrap = (fn) => async (req, res) => {
  await q.cacheCtx.run({ events: [] }, async () => {
    try {
      const result = await fn(req);
      const { events } = q.cacheCtx.getStore();
      if (events.length) {
        res.set('X-Cache', events.map((e) => `${e.status} ${e.key} ttl=${e.ttl}`).join(', '));
        // Header expuesto al frontend (CORS-friendly aunque sea same-origin)
        res.set('Access-Control-Expose-Headers', 'X-Cache');
      }
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
};

// 1 - Pacientes activos con propietario
app.get('/api/pacientes-activos', wrap(() => q.pacientesActivosConPropietario()));

// 2 - Consultas en seguimiento
app.get('/api/consultas-seguimiento', wrap(() => q.consultasEnSeguimiento()));

// 3 - Historial completo de un paciente
app.get('/api/historial-paciente/:id', wrap((req) => q.historialPaciente(req.params.id)));

// 4 - Propietarios con múltiples pacientes
app.get('/api/propietarios-multiples-pacientes', wrap(() => q.propietariosConMultiplesPacientes()));

// 5 - Veterinarios activos con consultas en 60 días
app.get('/api/vets-activos-consultas-60d', wrap(() => q.veterinariosActivosConConsultas60d()));

// 6 - Pacientes con vacunas vencidas
app.get('/api/pacientes-vacunas-vencidas', wrap(() => q.pacientesConVacunasVencidas()));

// 7 - Top 5 diagnósticos
app.get('/api/top-diagnosticos', wrap(() => q.topDiagnosticos()));

const positiveParam = (raw, def, name) => {
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`El parámetro '${name}' debe ser un número positivo`);
  }
  return n;
};

// 8 - Stock bajo
app.get('/api/stock-bajo', wrap((req) => q.stockBajo(positiveParam(req.query.umbral, 50, 'umbral'))));

// 9 - Controles con costo menor a 5000
app.get('/api/controles-baratos', wrap((req) => q.controlesBaratos(positiveParam(req.query.max, 5000, 'max'))));

// 10 - Pacientes de una sucursal
app.get('/api/pacientes-sucursal', wrap((req) => q.pacientesPorSucursal(req.query.sucursal || 'Palermo')));

// 11 - Ingresos por veterinario (mes actual)
app.get('/api/ingresos-vet-mes', wrap(() => q.ingresosPorVetMesActual()));

// 12 - Propietarios sin consultas en el último año
app.get('/api/propietarios-inactivos', wrap(() => q.propietariosSinConsultasUltimoAnio()));

// 13 - ABM de propietarios
app.post('/api/propietarios', wrap((req) => q.altaPropietario(req.body)));
app.put('/api/propietarios/:id', wrap((req) => q.modificarPropietario(req.params.id, req.body)));
app.delete('/api/propietarios/:id', wrap((req) => q.bajaPropietario(req.params.id)));

// 14 - Alta de consulta con validación
app.post('/api/consultas', wrap((req) => q.altaConsulta(req.body)));

// 15 - Decrementar stock
app.post('/api/decrementar-stock', wrap((req) =>
  q.decrementarStock(req.body.id_producto, Number(req.body.cantidad))
));

// Caché - vaciar todas las entradas (útil para demo o tras un reseed)
app.post('/api/cache/flush', wrap(() => q.flushCache()));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API escuchando en http://localhost:${PORT}`));
