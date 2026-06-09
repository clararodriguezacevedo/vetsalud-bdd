import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';
import { cacheCtx, flushCache } from './queries/cache.js';
import * as q from './queries/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

const wrap = (fn) => async (req, res) => {
  await cacheCtx.run({ events: [] }, async () => {
    try {
      const result = await fn(req);
      const { events } = cacheCtx.getStore();
      if (events.length) {
        res.set('X-Cache', events.map((e) => `${e.status} ${e.key} ttl=${e.ttl}`).join(', '));
        res.set('Access-Control-Expose-Headers', 'X-Cache');
      }
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
};

const positiveParam = (raw, def, name) => {
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`El parámetro '${name}' debe ser un número positivo`);
  }
  return n;
};

app.get('/api/pacientes-activos',                wrap(()    => q.pacientesActivosConPropietario()));
app.get('/api/consultas-seguimiento',            wrap(()    => q.consultasEnSeguimiento()));
app.get('/api/historial-paciente/:id',           wrap((req) => q.historialPaciente(req.params.id)));
app.get('/api/propietarios-multiples-pacientes', wrap(()    => q.propietariosConMultiplesPacientes()));
app.get('/api/vets-activos-consultas-60d',       wrap(()    => q.veterinariosActivosConConsultas60d()));
app.get('/api/pacientes-vacunas-vencidas',       wrap(()    => q.pacientesConVacunasVencidas()));
app.get('/api/top-diagnosticos',                 wrap(()    => q.topDiagnosticos()));
app.get('/api/stock-bajo',                       wrap((req) => q.stockBajo(positiveParam(req.query.umbral, 50, 'umbral'))));
app.get('/api/controles-baratos',                wrap((req) => q.controlesBaratos(positiveParam(req.query.max, 5000, 'max'))));
app.get('/api/pacientes-sucursal',               wrap((req) => q.pacientesPorSucursal(req.query.sucursal || 'Palermo')));
app.get('/api/ingresos-vet-mes',                 wrap(()    => q.ingresosPorVetMesActual()));
app.get('/api/propietarios-sin-consultas',       wrap(()    => q.propietariosSinConsultasUltimoAnio()));

app.post  ('/api/propietarios',                  wrap((req) => q.altaPropietario(req.body)));
app.put   ('/api/propietarios/:id',              wrap((req) => q.modificarPropietario(req.params.id, req.body)));
app.delete('/api/propietarios/:id',              wrap((req) => q.bajaPropietario(req.params.id)));

app.post('/api/consultas',                       wrap((req) => q.altaConsulta(req.body)));
app.post('/api/decrementar-stock',               wrap((req) => q.decrementarStock(req.body.id_producto, Number(req.body.cantidad))));

app.post('/api/cache/flush',                     wrap(()    => flushCache()));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API escuchando en http://localhost:${PORT}`));
