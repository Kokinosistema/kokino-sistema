-- Up Migration

-- Un tacho que se lleva un mayorista se va del local lleno. Sin un estado propio
-- habria que mentir: dejarlo LLENO lo seguiria contando como stock que ya no
-- esta, y marcarlo VACIO borraria la diferencia entre el helado que se vendio de
-- a cuartos en el mostrador y el que salio entero, que es justo lo que los
-- duenos van a querer medir.
ALTER TABLE tachos
  DROP CONSTRAINT tachos_estado_check;

ALTER TABLE tachos
  ADD CONSTRAINT tachos_estado_check
  CHECK (estado IN ('LLENO', 'EN_POZO', 'VACIO', 'ENTREGADO_MAYORISTA'));

-- El indice enumeraba los estados que NO son stock, asi que el estado nuevo
-- habria entrado al stock solo por no ser VACIO. Enumerar los que SI cuentan
-- deja afuera por omision a cualquier estado futuro, que es el lado seguro del
-- error: se nota al agregarlo en vez de falsear el stock en silencio.
DROP INDEX tachos_stock_idx;

CREATE INDEX tachos_stock_idx
  ON tachos (id_sucursal, estado, id_lote)
  WHERE estado IN ('LLENO', 'EN_POZO');

COMMENT ON COLUMN tachos.estado IS
  'LLENO recién fraccionado o guardado, EN_POZO abierto y vendiéndose por peso, VACIO consumido, ENTREGADO_MAYORISTA salió entero con un cliente mayorista. Solo LLENO y EN_POZO cuentan como stock. El empleado no identifica el tacho: informa qué sabor se acabó y en qué sucursal, y el sistema toma el más viejo de esa sucursal.';

COMMENT ON INDEX tachos_stock_idx IS
  'Sostiene la consulta central del sistema: qué tachos disponibles hay de cada sabor en cada sucursal. Enumera los estados que cuentan como stock en vez de los que no, para que un estado nuevo no se sume solo.';

-- Down Migration

DROP INDEX tachos_stock_idx;

CREATE INDEX tachos_stock_idx
  ON tachos (id_sucursal, estado, id_lote)
  WHERE estado <> 'VACIO';

ALTER TABLE tachos
  DROP CONSTRAINT tachos_estado_check;

-- Falla a proposito si algun tacho quedo en ENTREGADO_MAYORISTA: mejor un error
-- claro que perder el rastro de un tacho que se fue del local.
ALTER TABLE tachos
  ADD CONSTRAINT tachos_estado_check
  CHECK (estado IN ('LLENO', 'EN_POZO', 'VACIO'));

COMMENT ON COLUMN tachos.estado IS
  'LLENO recién fraccionado o guardado, EN_POZO abierto y vendiéndose por peso, VACIO consumido. Al marcarlo vacío sale del stock. El empleado no identifica el tacho: informa qué sabor se acabó y en qué sucursal, y el sistema toma el más viejo de esa sucursal.';
