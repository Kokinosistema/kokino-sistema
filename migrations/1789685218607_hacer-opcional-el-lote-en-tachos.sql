-- Up Migration

-- El dia que arranque el sistema va a haber tachos en el freezer que no
-- salieron de ninguna produccion registrada. Para poder contarlos, el lote
-- pasa a ser opcional: exigirlo obligaria a inventar una receta y una
-- produccion falsas solo para poder cargar helado que ya existia.
--
-- Precio de esta decision: un tacho sin lote queda sin fecha de vencimiento,
-- porque el vencimiento vive en el lote. En la practica pesa poco, porque los
-- tachos del arranque se venden en semanas; pero si mas adelante quieren
-- anotarles el vencimiento, habria que sumarle una columna propia al tacho.
--
-- De aca en adelante todo tacho nuevo va a tener lote igual, porque nace de
-- una produccion cargada en el sistema. El nulo es la excepcion del arranque,
-- no la norma.
ALTER TABLE tachos ALTER COLUMN id_lote DROP NOT NULL;

COMMENT ON COLUMN tachos.id_lote IS
  'Lote del que salio el tacho. Nulo solo en los tachos que ya existian cuando se puso en marcha el sistema y se cargaron contando el freezer: esos no tienen produccion registrada, y por lo tanto tampoco fecha de vencimiento. Un tacho producido con el sistema andando siempre tiene lote.';

-- Down Migration

-- Falla a proposito si quedaron tachos sin lote: revertir exigiria borrarlos o
-- inventarles un lote, y eso hay que decidirlo antes, no que lo resuelva una
-- migracion en silencio.
ALTER TABLE tachos ALTER COLUMN id_lote SET NOT NULL;
