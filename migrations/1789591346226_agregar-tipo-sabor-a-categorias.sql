-- Up Migration

-- Los sabores se agrupan con su propia clasificación, distinta de la de
-- insumos y productos. Se reusa la tabla categorias sumando un tercer tipo
-- en vez de crear un catálogo paralelo.
ALTER TABLE categorias
  DROP CONSTRAINT categorias_tipo_check;

ALTER TABLE categorias
  ADD CONSTRAINT categorias_tipo_check
  CHECK (tipo IN ('INSUMO', 'PRODUCTO', 'SABOR'));

COMMENT ON TABLE categorias IS
  'Agrupaciones de insumos, de productos y de sabores. Es una lista plana, sin subcategorías.';

-- Down Migration

-- Si ya existieran categorías de tipo SABOR, este ALTER falla a propósito:
-- revertir dejaría filas que violan el CHECK viejo, así que hay que decidir
-- antes qué hacer con esos datos.
ALTER TABLE categorias
  DROP CONSTRAINT categorias_tipo_check;

ALTER TABLE categorias
  ADD CONSTRAINT categorias_tipo_check
  CHECK (tipo IN ('INSUMO', 'PRODUCTO'));

COMMENT ON TABLE categorias IS
  'Agrupaciones de insumos y de productos. Es una lista plana, sin subcategorías.';
