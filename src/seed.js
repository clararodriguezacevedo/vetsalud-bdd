import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { connect, close } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');

function readCsv(name) {
  const raw = readFileSync(join(dataDir, name), 'utf8');
  return parse(raw, { columns: true, skip_empty_lines: true, trim: true });
}

const bool = (v) => String(v).toLowerCase() === 'true';

async function main() {
  const { db, redis } = await connect();

  // ----------------------------- MongoDB -----------------------------
  const propietarios = readCsv('propietarios.csv').map((r) => ({
    _id: r.id_propietario,
    nombre: r.nombre,
    apellido: r.apellido,
    dni: r.dni,
    email: r.email,
    telefono: r.telefono,
    ciudad: r.ciudad,
    provincia: r.provincia,
    activo: true, // campo agregado para la baja lógica (consulta 13)
  }));

  const pacientes = readCsv('pacientes.csv').map((r) => ({
    _id: r.id_paciente,
    nombre: r.nombre,
    especie: r.especie,
    raza: r.raza,
    fecha_nac: new Date(r.fecha_nac),
    id_propietario: r.id_propietario,
    activo: bool(r.activo),
  }));

  const veterinarios = readCsv('veterinarios.csv').map((r) => ({
    _id: r.id_vet,
    nombre: r.nombre,
    apellido: r.apellido,
    matricula: r.matricula,
    especialidad: r.especialidad,
    sucursal: r.sucursal,
    activo: bool(r.activo),
  }));

  const consultas = readCsv('consultas.csv').map((r) => ({
    _id: r.id_consulta,
    id_paciente: r.id_paciente,
    id_vet: r.id_vet,
    fecha: new Date(r.fecha),
    motivo: r.motivo,
    diagnostico: r.diagnostico,
    costo: Number(r.costo),
    estado: r.estado,
  }));

  const vacunaciones = readCsv('vacunaciones.csv').map((r) => ({
    _id: r.id_vacuna,
    id_paciente: r.id_paciente,
    id_vet: r.id_vet,
    fecha_aplicacion: new Date(r.fecha_aplicacion),
    nombre_vacuna: r.nombre_vacuna,
    proxima_dosis: new Date(r.proxima_dosis),
  }));

  const colecciones = { propietarios, pacientes, veterinarios, consultas, vacunaciones };
  for (const [nombre, docs] of Object.entries(colecciones)) {
    const col = db.collection(nombre);
    await col.deleteMany({});
    if (docs.length) await col.insertMany(docs);
    console.log(`Mongo · ${nombre}: ${docs.length} documentos`);
  }

  // Índices que aceleran las consultas por fecha y por referencias
  await db.collection('consultas').createIndex({ fecha: 1 });
  await db.collection('consultas').createIndex({ id_vet: 1 });
  await db.collection('pacientes').createIndex({ id_propietario: 1 });

  // ------------------------------ Redis -------------------------------
  const stock = readCsv('stock_farmaceutico.csv');

  const viejas = await redis.keys('producto:*');
  if (viejas.length) await redis.del(viejas);
  await redis.del('stock:unidades');

  for (const p of stock) {
    await redis.hSet(`producto:${p.id_producto}`, {
      nombre: p.nombre,
      categoria: p.categoria,
      unidades: p.unidades,
      precio_unit: p.precio_unit,
      vencimiento: p.vencimiento,
      proveedor: p.proveedor,
    });
    // Sorted Set: score = unidades → permite buscar bajo stock por rango (consulta 8)
    await redis.zAdd('stock:unidades', { score: Number(p.unidades), value: p.id_producto });
  }
  console.log(`Redis · stock: ${stock.length} productos`);

  await close();
  console.log('\nSeed completado correctamente.');
}

main().catch(async (e) => {
  console.error('Error en el seed:', e);
  await close();
  process.exit(1);
});
