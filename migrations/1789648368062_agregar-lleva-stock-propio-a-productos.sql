-- Up Migration

-- Un termico y un familiar tienen el mismo tipo_origen y sin embargo se cuentan
-- al reves: el termico se llena en el momento sacando helado de un tacho del
-- pozo, asi que no existe una pila de termicos que contar y su helado ya lo
-- lleva la tabla tachos; el familiar se llena antes y se guarda, asi que si hay
-- unidades contables. Sin esta columna, vender un termico descontaria el mismo
-- helado dos veces: una en tachos y otra en movimientos_producto.
ALTER TABLE productos
  ADD COLUMN lleva_stock_propio BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN productos.lleva_stock_propio IS
  'true si existen unidades de este producto que se puedan contar: alfajores, tortas, cucuruchos, cafetería y envases familiares, que se llenan con anticipación y se guardan. false para los que se arman recién al venderlos sacando helado de un tacho, como los térmicos, cuyo stock ya lo lleva la tabla tachos. Por defecto true porque el caso común es tener stock propio; el térmico es la excepción.';

-- Down Migration

ALTER TABLE productos
  DROP COLUMN lleva_stock_propio;
