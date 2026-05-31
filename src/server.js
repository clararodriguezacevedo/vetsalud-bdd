import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';
import * as q from './queries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

// Envuelve un handler async y maneja errores de forma uniforme
const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

// Endpoints de las consultas implementadas
app.get('/api/pacientes-activos', wrap(() => q.pacientesActivosConPropietario()));
app.get('/api/top-diagnosticos', wrap(() => q.topDiagnosticos()));
app.get('/api/stock-bajo', wrap((req) => q.stockBajo(Number(req.query.umbral) || 50)));
app.post('/api/decrementar-stock', wrap((req) =>
  q.decrementarStock(req.body.id_producto, Number(req.body.cantidad))
));
app.get('/api/controles-baratos', wrap((req) => q.controlesBaratos(Number(req.query.max) || 5000)));
app.get('/api/pacientes-sucursal', wrap((req) => q.pacientesPorSucursal(req.query.sucursal || 'Palermo')));
app.get('/api/ingresos-vet-mes', wrap(() => q.ingresosPorVetMesActual()));
app.get('/api/propietarios-inactivos', wrap(() => q.propietariosSinConsultasUltimoAnio()));

// 13 ABM de propietarios
app.post('/api/propietarios', wrap((req) => q.altaPropietario(req.body)));
app.put('/api/propietarios/:id', wrap((req) => q.modificarPropietario(req.params.id, req.body)));
app.delete('/api/propietarios/:id', wrap((req) => q.bajaPropietario(req.params.id)));

// 14 Alta de consulta con validación
app.post('/api/consultas', wrap((req) => q.altaConsulta(req.body)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API escuchando en http://localhost:${PORT}`));
