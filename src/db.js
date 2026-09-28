'use strict';

// Un unico pool de conexiones para toda la aplicacion.
//
// Los seeds abren un Client, hacen lo suyo y cierran: son scripts que corren
// una vez. El servidor es otra cosa, atiende muchos pedidos a la vez y durante
// meses. El pool mantiene unas pocas conexiones abiertas y las reparte, en vez
// de pagar el saludo a PostgreSQL en cada consulta.
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
