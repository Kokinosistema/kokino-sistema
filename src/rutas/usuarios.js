'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { consultar } = require('../db');
const { exigirRol } = require('../middleware/sesion');

const router = express.Router();

// Mismas vueltas que usa el script de arranque. Si alguna vez se suben, las
// cuentas viejas siguen entrando igual: el costo viaja adentro del hash, asi
// que bcrypt sabe con cuantas vueltas comparar cada una.
const VUELTAS_BCRYPT = 12;

const LARGO_MINIMO_CLAVE = 8;

// Dar de alta cuentas es de los duenos. No es solo una cuestion de permisos:
// quien puede crear usuarios puede crearse uno con mas poder del que tiene.
router.use(exigirRol('administrador'));

function validarClave(clave, repetida) {
  if (clave.length < LARGO_MINIMO_CLAVE) {
    return 'La contrasena necesita al menos ' + LARGO_MINIMO_CLAVE + ' caracteres.';
  }
  if (clave !== repetida) {
    return 'Las dos contrasenas no coinciden.';
  }
  return null;
}

function validarUsuario(nombreUsuario) {
  if (nombreUsuario.length < 3) return 'El usuario necesita al menos 3 caracteres.';
  if (!/^[a-z0-9._-]+$/.test(nombreUsuario)) {
    return 'El usuario solo puede tener letras, numeros, puntos, guiones y guiones bajos.';
  }
  return null;
}

// La regla que evita el peor error posible de esta pantalla: quedarse sin
// ningun administrador activo.
//
// Si pasara, nadie podria volver a entrar a configurar el sistema, ni siquiera
// para arreglarlo, y habria que volver a la consola a correr el script de
// arranque. Es el tipo de error que se comete una sola vez y a las siete de la
// tarde de un sabado.
async function quedaOtroAdministrador(idUsuarioQueCambia) {
  const { rows } = await consultar(
    `SELECT count(*)::int AS n
       FROM usuarios u
       JOIN roles r ON r.id_rol = u.id_rol
      WHERE r.nombre_rol = 'administrador'
        AND u.activo
        AND u.id_usuario <> $1`,
    [idUsuarioQueCambia]
  );
  return rows[0].n > 0;
}

async function traerRoles() {
  const { rows } = await consultar('SELECT id_rol, nombre_rol FROM roles ORDER BY id_rol');
  return rows;
}

router.get('/', async (req, res, siguiente) => {
  try {
    const { rows } = await consultar(
      `SELECT u.id_usuario,
              u.username,
              u.activo,
              r.nombre_rol,
              e.nombre,
              coalesce(e.apellido, '')      AS apellido,
              coalesce(s.nombre, 'las dos') AS sucursal
         FROM usuarios u
         JOIN roles r     ON r.id_rol = u.id_rol
         JOIN empleados e ON e.id_empleado = u.id_empleado
         LEFT JOIN sucursales s ON s.id_sucursal = e.id_sucursal_asignada
        -- Los de la sucursal de trabajo, mas los duenos, que no tienen
        -- sucursal porque trabajan sobre las dos.
        WHERE e.id_sucursal_asignada = $1 OR e.id_sucursal_asignada IS NULL
        ORDER BY u.activo DESC, e.nombre`,
      [req.sucursal.id_sucursal]
    );

    // Para saber si tiene sentido ofrecer el boton de agregar: si todos los
    // empleados ya tienen cuenta, primero hay que cargar al empleado.
    const { rows: pendientes } = await consultar(
      `SELECT count(*)::int AS n
         FROM empleados e
        WHERE e.activo
          AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id_empleado = e.id_empleado)`
    );

    res.render('usuarios/lista', {
      usuarios: rows,
      hayEmpleadosSinCuenta: pendientes[0].n > 0,
    });
  } catch (error) {
    siguiente(error);
  }
});

// Solo se listan los empleados que todavia no tienen cuenta: la base ya impide
// que un empleado tenga dos, asi que mostrarlos seria ofrecer algo que va a
// fallar al guardar.
async function traerEmpleadosSinCuenta() {
  const { rows } = await consultar(
    `SELECT e.id_empleado,
            e.nombre,
            coalesce(e.apellido, '')      AS apellido,
            coalesce(s.nombre, 'las dos') AS sucursal
       FROM empleados e
       LEFT JOIN sucursales s ON s.id_sucursal = e.id_sucursal_asignada
      WHERE e.activo
        AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id_empleado = e.id_empleado)
      ORDER BY e.nombre`
  );
  return rows;
}

router.get('/nuevo', async (req, res, siguiente) => {
  try {
    res.render('usuarios/nuevo', {
      empleados: await traerEmpleadosSinCuenta(),
      roles: await traerRoles(),
      datos: { id_empleado: '', username: '', id_rol: '' },
      errores: [],
    });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/', async (req, res, siguiente) => {
  const datos = {
    id_empleado: req.body.id_empleado || '',
    username: (req.body.username || '').trim().toLowerCase(),
    id_rol: req.body.id_rol || '',
  };
  const clave = req.body.clave || '';
  const repetida = req.body.repetida || '';
  const errores = [];

  if (!datos.id_empleado) errores.push('Elegi de que empleado es la cuenta.');
  if (!datos.id_rol) errores.push('Elegi el rol.');

  const errorUsuario = validarUsuario(datos.username);
  if (errorUsuario) errores.push(errorUsuario);

  const errorClave = validarClave(clave, repetida);
  if (errorClave) errores.push(errorClave);

  try {
    if (errores.length > 0) {
      return res.status(400).render('usuarios/nuevo', {
        empleados: await traerEmpleadosSinCuenta(),
        roles: await traerRoles(),
        datos,
        errores,
      });
    }

    const hash = await bcrypt.hash(clave, VUELTAS_BCRYPT);
    await consultar(
      `INSERT INTO usuarios (id_empleado, id_rol, username, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [datos.id_empleado, datos.id_rol, datos.username, hash]
    );

    req.session.aviso = 'La cuenta "' + datos.username + '" ya puede entrar.';
    res.redirect('/usuarios');
  } catch (error) {
    if (error.code === '23505') {
      try {
        return res.status(409).render('usuarios/nuevo', {
          empleados: await traerEmpleadosSinCuenta(),
          roles: await traerRoles(),
          datos,
          errores: ['Ese nombre de usuario ya esta tomado.'],
        });
      } catch (otro) {
        return siguiente(otro);
      }
    }
    siguiente(error);
  }
});

async function traerUsuario(id) {
  const { rows } = await consultar(
    `SELECT u.id_usuario,
            u.username,
            u.activo,
            u.id_rol,
            r.nombre_rol,
            e.nombre,
            coalesce(e.apellido, '')      AS apellido,
            coalesce(s.nombre, 'las dos') AS sucursal
       FROM usuarios u
       JOIN roles r     ON r.id_rol = u.id_rol
       JOIN empleados e ON e.id_empleado = u.id_empleado
       LEFT JOIN sucursales s ON s.id_sucursal = e.id_sucursal_asignada
      WHERE u.id_usuario = $1`,
    [id]
  );
  return rows[0];
}

router.get('/:id/editar', async (req, res, siguiente) => {
  try {
    const usuarioEditado = await traerUsuario(req.params.id);
    if (!usuarioEditado) return siguiente();
    res.render('usuarios/editar', {
      editado: usuarioEditado,
      roles: await traerRoles(),
      errores: [],
    });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/:id', async (req, res, siguiente) => {
  try {
    const editado = await traerUsuario(req.params.id);
    if (!editado) return siguiente();

    const username = (req.body.username || '').trim().toLowerCase();
    const idRol = Number(req.body.id_rol);
    const errores = [];

    const errorUsuario = validarUsuario(username);
    if (errorUsuario) errores.push(errorUsuario);

    const roles = await traerRoles();
    const rolNuevo = roles.find((r) => r.id_rol === idRol);
    if (!rolNuevo) errores.push('Ese rol no existe.');

    // Bajarle el rol al ultimo administrador deja el sistema sin nadie que
    // pueda configurarlo.
    if (
      rolNuevo &&
      editado.nombre_rol === 'administrador' &&
      rolNuevo.nombre_rol !== 'administrador' &&
      !(await quedaOtroAdministrador(editado.id_usuario))
    ) {
      errores.push('Es el unico administrador activo: si le sacas el rol, nadie va a poder volver a configurar el sistema.');
    }

    if (errores.length > 0) {
      return res.status(400).render('usuarios/editar', {
        editado: Object.assign({}, editado, { username, id_rol: idRol }),
        roles,
        errores,
      });
    }

    await consultar('UPDATE usuarios SET username = $1, id_rol = $2 WHERE id_usuario = $3', [
      username,
      idRol,
      editado.id_usuario,
    ]);

    req.session.aviso = 'Se guardaron los cambios de "' + username + '".';
    res.redirect('/usuarios');
  } catch (error) {
    if (error.code === '23505') {
      try {
        return res.status(409).render('usuarios/editar', {
          editado: await traerUsuario(req.params.id),
          roles: await traerRoles(),
          errores: ['Ese nombre de usuario ya esta tomado.'],
        });
      } catch (otro) {
        return siguiente(otro);
      }
    }
    siguiente(error);
  }
});

// Cambiar la contrasena de otro. No se pide la actual: el dueno no la sabe, y
// justamente se usa cuando alguien la olvido. Queda dicho aca porque es una
// decision, no un olvido: si mas adelante hay una pantalla donde cada uno se
// cambia la suya, esa si tiene que pedir la vieja.
router.post('/:id/clave', async (req, res, siguiente) => {
  try {
    const editado = await traerUsuario(req.params.id);
    if (!editado) return siguiente();

    const error = validarClave(req.body.clave || '', req.body.repetida || '');
    if (error) {
      return res.status(400).render('usuarios/editar', {
        editado,
        roles: await traerRoles(),
        errores: [error],
      });
    }

    const hash = await bcrypt.hash(req.body.clave, VUELTAS_BCRYPT);
    await consultar('UPDATE usuarios SET password_hash = $1 WHERE id_usuario = $2', [
      hash,
      editado.id_usuario,
    ]);

    req.session.aviso = 'Se cambio la contrasena de "' + editado.username + '".';
    res.redirect('/usuarios');
  } catch (otro) {
    siguiente(otro);
  }
});

router.post('/:id/baja', async (req, res, siguiente) => {
  try {
    const editado = await traerUsuario(req.params.id);
    if (!editado) return siguiente();

    const activar = req.body.activar === '1';

    // Desactivarse a uno mismo es cerrarse la puerta con la llave adentro:
    // la sesion sigue abierta hasta que se va, y despues no puede volver.
    if (!activar && editado.id_usuario === req.session.usuario.id_usuario) {
      req.session.aviso = 'No podes darte de baja a vos misma.';
      return res.redirect('/usuarios');
    }

    if (
      !activar &&
      editado.nombre_rol === 'administrador' &&
      !(await quedaOtroAdministrador(editado.id_usuario))
    ) {
      req.session.aviso = 'Es el unico administrador activo: si lo das de baja, nadie va a poder volver a configurar el sistema.';
      return res.redirect('/usuarios');
    }

    await consultar('UPDATE usuarios SET activo = $1 WHERE id_usuario = $2', [
      activar,
      editado.id_usuario,
    ]);

    req.session.aviso = activar
      ? '"' + editado.username + '" vuelve a poder entrar.'
      : '"' + editado.username + '" ya no puede entrar.';
    res.redirect('/usuarios');
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
