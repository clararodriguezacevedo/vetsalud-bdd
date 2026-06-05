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

  const propietarios = readCsv('propietarios.csv').map((r) => ({
    _id: r.id_propietario,
    nombre: r.nombre,
    apellido: r.apellido,
    dni: r.dni,
    email: r.email,
    telefono: r.telefono,
    ciudad: r.ciudad,
    provincia: r.provincia,
    activo: r.activo === undefined ? true : bool(r.activo),
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
    tipo: r.tipo || 'Consulta',
    motivo: r.motivo,
    diagnostico: r.diagnostico,
    costo: Number(r.costo),
    estado: r.estado,
  }));

  // Inyectar consultas del mes en curso para que Q11 (ingresos del mes) siempre
  // tenga datos sin importar cuándo se corra el seed.
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = ahora.getMonth();
  const diaActual = ahora.getDate();
  const ultimoId = consultas.reduce(
    (max, c) => Math.max(max, Number(String(c._id).replace(/\D/g, ''))), 0,
  );
  const extras = [
    { paciente: 'P001', vet: 'V001', costo: 4500,  motivo: 'Control mensual',   diagnostico: 'Sano',                 tipo: 'Consulta' },
    { paciente: 'P002', vet: 'V003', costo: 5500,  motivo: 'Alergia',           diagnostico: 'Dermatitis atópica',   tipo: 'Consulta' },
    { paciente: 'P004', vet: 'V001', costo: 3200,  motivo: 'Control',           diagnostico: 'Sano',                 tipo: 'Consulta' },
    { paciente: 'P005', vet: 'V002', costo: 18000, motivo: 'Esterilización',    diagnostico: 'Cirugía exitosa',      tipo: 'Cirugia' },
    { paciente: 'P006', vet: 'V003', costo: 3800,  motivo: 'Picazón',           diagnostico: 'Otitis externa',       tipo: 'Consulta' },
    { paciente: 'P008', vet: 'V007', costo: 4200,  motivo: 'Plumas decaídas',   diagnostico: 'Carencia nutricional', tipo: 'Consulta' },
    { paciente: 'P009', vet: 'V001', costo: 3200,  motivo: 'Pulgas',            diagnostico: 'Infestación parasitaria', tipo: 'Consulta' },
    { paciente: 'P014', vet: 'V006', costo: 25000, motivo: 'Tumor cutáneo',     diagnostico: 'Resección de masa',    tipo: 'Cirugia' },
    { paciente: 'P017', vet: 'V001', costo: 4100,  motivo: 'Otitis',            diagnostico: 'Otitis externa',       tipo: 'Consulta' },
  ];
  extras.forEach((e, i) => {
    const dia = Math.max(1, Math.min(diaActual, 28) - i);
    consultas.push({
      _id: 'CON' + String(ultimoId + i + 1).padStart(3, '0'),
      id_paciente: e.paciente,
      id_vet: e.vet,
      fecha: new Date(año, mes, dia),
      tipo: e.tipo,
      motivo: e.motivo,
      diagnostico: e.diagnostico,
      costo: e.costo,
      estado: 'Cerrada',
    });
  });

  const vacunaciones = readCsv('vacunaciones.csv').map((r) => ({
    _id: r.id_vacuna,
    id_paciente: r.id_paciente,
    id_vet: r.id_vet,
    fecha_aplicacion: new Date(r.fecha_aplicacion),
    nombre_vacuna: r.nombre_vacuna,
    proxima_dosis: new Date(r.proxima_dosis),
  }));

  const stockCsv = readCsv('stock_farmaceutico.csv');
  const productos = stockCsv.map((p) => ({
    _id: p.id_producto,
    nombre: p.nombre,
    categoria: p.categoria,
    precio_unit: Number(p.precio_unit),
    vencimiento: new Date(p.vencimiento),
    proveedor: p.proveedor,
  }));

  const colecciones = { propietarios, pacientes, veterinarios, consultas, vacunaciones, productos };
  for (const [nombre, docs] of Object.entries(colecciones)) {
    const col = db.collection(nombre);
    await col.deleteMany({});
    if (docs.length) await col.insertMany(docs);
    console.log(`Mongo ${nombre}: ${docs.length} documentos`);
  }

  await db.collection('consultas').createIndex({ fecha: 1 });
  await db.collection('consultas').createIndex({ id_vet: 1 });
  await db.collection('pacientes').createIndex({ id_propietario: 1 });
  await db.collection('productos').createIndex({ proveedor: 1 });
  await db.collection('productos').createIndex({ vencimiento: 1 });

  const viejas = await redis.keys('producto:*');
  if (viejas.length) await redis.del(viejas);
  await redis.del('stock:unidades');

  for (const p of stockCsv) {
    await redis.zAdd('stock:unidades', { score: Number(p.unidades), value: p.id_producto });
  }
  console.log(`Redis stock:unidades: ${stockCsv.length} productos`);

  await close();
  console.log('\nSeed completado correctamente.');
}

main().catch(async (e) => {
  console.error('Error en el seed:', e);
  await close();
  process.exit(1);
});
