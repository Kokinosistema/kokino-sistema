'use strict';

// Un unico pool de conexiones para toda la aplicacion.
//
// Los seeds abren un Client, hacen lo suyo y cierran: son scripts que corren
// una vez. El servidor es otra cosa, atiende muchos pedidos a la vez y durante
// meses. El pool mantiene unas pocas conexiones abiertas y las reparte, en vez
// de pagar el saludo a PostgreSQL en cada consulta.
const { Pool } = require('pg');

// La hora argentina de la base la fija la migracion
// 1793400000000_zona-horaria-de-la-base: "hoy", "esta semana" y las fechas que
// se guardan no dependen de como este configurado PostgreSQL donde se instale.
// Antes se pedia en cada conexion, pero el pooler de Supabase no deja mandar
// esa opcion al conectarse.
//
// En Vercel cada copia del sistema atiende pocas visitas a la vez y la que
// reparte las conexiones es Supabase, asi que alcanzan pocas por copia.
const enVercel = Boolean(process.env.VERCEL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: enVercel ? 3 : 10,
  idleTimeoutMillis: enVercel ? 5000 : 10000,
});

// Si una conexion que estaba esperando se corta (pasa en la nube cuando la
// base o la red la cierran), el pool la descarta y abre otra cuando haga
// falta. Sin esto, ese corte tiraria el servidor entero.
pool.on('error', (error) => {
  console.error('Se corto una conexion con la base:', error.message);
});

// Vercel congela el sistema entre visita y visita; esto le avisa que cierre
// las conexiones que quedaron sin usar antes de congelarlo.
if (enVercel) require('@vercel/functions').attachDatabasePool(pool);

// Todas las consultas pasan por aca para tener un solo lugar donde agregar
// log, metricas o reintentos el dia que hagan falta.
function consultar(sql, parametros) {
  return pool.query(sql, parametros);
}

// Corre varias consultas como una sola operacion: o pasan todas o no pasa
// ninguna.
//
// Hace falta apenas una pantalla escribe en mas de una tabla. Guardar una
// receta, por ejemplo, borra los ingredientes viejos y escribe los nuevos: si
// fallara en el medio, la receta quedaria sin ingredientes y nadie se
// enteraria hasta que alguien fuera a producir con ella.
//
// Se toma una conexion del pool y se usa la misma para todo, porque una
// transaccion vive en una conexion: repartir las consultas entre varias haria
// que el BEGIN y el COMMIT no se hablen entre si. Siempre se devuelve al pool,
// haya salido bien o mal.
async function conTransaccion(tarea) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await tarea((sql, parametros) => cliente.query(sql, parametros));
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    // El ROLLBACK va en su propio try: si la conexion se cayo, el rollback
    // tambien falla, y sin esto su excepcion reemplazaria a la original y nos
    // dejaria sin saber que fue lo que salio mal de verdad.
    try {
      await cliente.query('ROLLBACK');
    } catch (errorAlRevertir) {
      console.error('Fallo el ROLLBACK:', errorAlRevertir.message);
    }
    throw error;
  } finally {
    cliente.release();
  }
}

module.exports = { consultar, conTransaccion, pool };
