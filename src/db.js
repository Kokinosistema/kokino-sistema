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

module.exports = { consultar, pool };
