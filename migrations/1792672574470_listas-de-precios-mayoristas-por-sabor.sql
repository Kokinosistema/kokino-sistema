-- Up Migration

-- Listas de precios mayoristas por sabor, traidas del Sistema Rody (definido
-- con la usuaria el 2026-10-22). Reemplazan al precio unico por linea y envase
-- de precios_mayoristas, que se va a quitar cuando la venta vieja deje de usarse.
--
--   - Cada lista dice que lineas incluye. La Lista general tiene las dos y la
--     usa cualquier cliente sin lista propia; la de Terminal solo Familiar.
--   - Cada sabor tiene su precio en cada lista. Sin fila, no tiene precio en
--     esa lista: asi quedan los que los duenos todavia no definieron.
--   - El envase se cobra aparte, con un precio unico.
--   - El usuario que cargo un precio es opcional: vacio quiere decir que vino
--     de la carga inicial (el Excel "Precios 22/04/26 Terminal").
--
-- Los precios en si se cargan con npm run seed:precios-mayoristas.

-- ------------------------------------------------------------------ listas

CREATE TABLE listas_precios_mayoristas (
  id_lista_precios  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre            VARCHAR(100) NOT NULL UNIQUE,
  incluye_familiar  BOOLEAN      NOT NULL,
  incluye_artesanal BOOLEAN      NOT NULL,
  es_general        BOOLEAN      NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT listas_precios_mayoristas_alguna_linea_check
    CHECK (incluye_familiar OR incluye_artesanal),
  CONSTRAINT listas_precios_mayoristas_general_completa_check
    CHECK (NOT es_general OR (incluye_familiar AND incluye_artesanal))
);

-- Una sola Lista general.
CREATE UNIQUE INDEX listas_precios_mayoristas_una_general_idx
  ON listas_precios_mayoristas (es_general) WHERE es_general;

CREATE TRIGGER trg_listas_precios_mayoristas_set_updated_at
  BEFORE UPDATE ON listas_precios_mayoristas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE listas_precios_mayoristas IS
  'Listas de precios para cotizar a los mayoristas. La general la usa todo cliente sin lista propia; un cliente fijo (por ejemplo Terminal) puede tener una especial, que a veces incluye una sola linea.';
COMMENT ON COLUMN listas_precios_mayoristas.incluye_familiar IS
  'Si en esta lista se pueden cotizar sabores de la linea familiar.';
COMMENT ON COLUMN listas_precios_mayoristas.incluye_artesanal IS
  'Si en esta lista se pueden cotizar sabores de la linea artesanal.';
COMMENT ON COLUMN listas_precios_mayoristas.es_general IS
  'La lista de los clientes sin lista propia. Hay una sola y tiene las dos lineas.';

INSERT INTO listas_precios_mayoristas (nombre, incluye_familiar, incluye_artesanal, es_general) VALUES
  ('Lista general', true, true,  true),
  ('Lista Terminal', true, false, false);

-- ------------------------------------------------------- precios de cada sabor

CREATE TABLE precios_lista_mayorista (
  id_precio_lista      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_lista_precios     INTEGER       NOT NULL REFERENCES listas_precios_mayoristas (id_lista_precios) ON DELETE RESTRICT,
  id_sabor             INTEGER       NOT NULL REFERENCES sabores (id_sabor) ON DELETE RESTRICT,
  precio               NUMERIC(12,2) NOT NULL,
  fecha_vigencia_desde DATE          NOT NULL DEFAULT current_date,
  fecha_vigencia_hasta DATE,
  id_usuario           INTEGER       REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT precios_lista_mayorista_precio_check CHECK (precio >= 0),
  CONSTRAINT precios_lista_mayorista_vigencia_check
    CHECK (fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= fecha_vigencia_desde)
);

-- Un solo precio vigente por sabor en cada lista. Los cerrados quedan fuera
-- del indice, asi el historial puede tener todos los que haga falta.
CREATE UNIQUE INDEX precios_lista_mayorista_vigente_idx
  ON precios_lista_mayorista (id_lista_precios, id_sabor) WHERE fecha_vigencia_hasta IS NULL;
CREATE INDEX precios_lista_mayorista_id_sabor_idx ON precios_lista_mayorista (id_sabor);
CREATE INDEX precios_lista_mayorista_id_usuario_idx ON precios_lista_mayorista (id_usuario);

CREATE TRIGGER trg_precios_lista_mayorista_set_updated_at
  BEFORE UPDATE ON precios_lista_mayorista
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE precios_lista_mayorista IS
  'Precio de un tacho de cada sabor en cada lista mayorista, sin el envase. Historico: el vigente es el que no tiene fecha_vigencia_hasta. Un sabor sin fila vigente no tiene precio en esa lista.';
COMMENT ON COLUMN precios_lista_mayorista.id_usuario IS
  'Quien cargo el precio. Nulo: vino de la carga inicial del Excel, no de alguien desde el sistema.';

-- Un sabor solo tiene precio en una lista que incluye su linea: un artesanal
-- no puede quedar con precio en la de Terminal.
CREATE FUNCTION validar_linea_en_lista_mayorista() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_linea  VARCHAR(20);
  v_lista  listas_precios_mayoristas%ROWTYPE;
BEGIN
  SELECT linea INTO v_linea FROM sabores WHERE id_sabor = NEW.id_sabor;
  SELECT * INTO v_lista FROM listas_precios_mayoristas WHERE id_lista_precios = NEW.id_lista_precios;
  IF (v_linea = 'FAMILIAR' AND NOT v_lista.incluye_familiar)
     OR (v_linea = 'ARTESANAL' AND NOT v_lista.incluye_artesanal) THEN
    RAISE EXCEPTION 'La % no incluye la linea %: no se le puede poner precio a ese sabor', v_lista.nombre, lower(v_linea);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_precios_lista_mayorista_validar_linea
  BEFORE INSERT OR UPDATE OF id_lista_precios, id_sabor ON precios_lista_mayorista
  FOR EACH ROW EXECUTE FUNCTION validar_linea_en_lista_mayorista();

-- Y al reves: a una lista no se le saca una linea mientras tenga precios
-- vigentes de esa linea.
CREATE FUNCTION validar_lineas_de_lista_mayorista() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM precios_lista_mayorista p JOIN sabores s ON s.id_sabor = p.id_sabor
     WHERE p.id_lista_precios = NEW.id_lista_precios AND p.fecha_vigencia_hasta IS NULL
       AND ((s.linea = 'FAMILIAR' AND NOT NEW.incluye_familiar)
         OR (s.linea = 'ARTESANAL' AND NOT NEW.incluye_artesanal))
  ) THEN
    RAISE EXCEPTION 'La % tiene precios vigentes de la linea que se le quiere sacar: primero hay que cerrarlos', NEW.nombre;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_listas_precios_mayoristas_validar_lineas
  BEFORE UPDATE OF incluye_familiar, incluye_artesanal ON listas_precios_mayoristas
  FOR EACH ROW EXECUTE FUNCTION validar_lineas_de_lista_mayorista();

-- ------------------------------------------------------------- precio del envase

CREATE TABLE precios_envase_mayorista (
  id_precio_envase     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  precio               NUMERIC(12,2) NOT NULL,
  fecha_vigencia_desde DATE          NOT NULL DEFAULT current_date,
  fecha_vigencia_hasta DATE,
  id_usuario           INTEGER       REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT precios_envase_mayorista_precio_check CHECK (precio >= 0),
  CONSTRAINT precios_envase_mayorista_vigencia_check
    CHECK (fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= fecha_vigencia_desde)
);

-- Un solo precio vigente: el indice es sobre una constante, asi solo puede
-- haber una fila sin fecha_vigencia_hasta.
CREATE UNIQUE INDEX precios_envase_mayorista_vigente_idx
  ON precios_envase_mayorista ((true)) WHERE fecha_vigencia_hasta IS NULL;
CREATE INDEX precios_envase_mayorista_id_usuario_idx ON precios_envase_mayorista (id_usuario);

CREATE TRIGGER trg_precios_envase_mayorista_set_updated_at
  BEFORE UPDATE ON precios_envase_mayorista
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE precios_envase_mayorista IS
  'Precio del envase que un mayorista compra (se lo queda). El prestado no se cobra. Es el mismo para todas las listas. Historico: el vigente es el que no tiene fecha_vigencia_hasta.';
COMMENT ON COLUMN precios_envase_mayorista.id_usuario IS
  'Quien cargo el precio. Nulo: vino de la carga inicial, no de alguien desde el sistema.';

-- ------------------------------------------------------ la lista de cada cliente

ALTER TABLE clientes
  ADD COLUMN id_lista_precios INTEGER REFERENCES listas_precios_mayoristas (id_lista_precios) ON DELETE RESTRICT,
  ADD CONSTRAINT clientes_lista_precios_solo_mayorista_check
    CHECK (id_lista_precios IS NULL OR tipo_cliente = 'MAYORISTA');

CREATE INDEX clientes_id_lista_precios_idx ON clientes (id_lista_precios);

COMMENT ON COLUMN clientes.id_lista_precios IS
  'Lista de precios especial del cliente fijo. Nulo: cotiza con la Lista general.';

-- Down Migration

DROP INDEX clientes_id_lista_precios_idx;
ALTER TABLE clientes
  DROP CONSTRAINT clientes_lista_precios_solo_mayorista_check,
  DROP COLUMN id_lista_precios;

DROP TABLE precios_envase_mayorista;

DROP TRIGGER trg_listas_precios_mayoristas_validar_lineas ON listas_precios_mayoristas;
DROP FUNCTION validar_lineas_de_lista_mayorista();
DROP TABLE precios_lista_mayorista;
DROP FUNCTION validar_linea_en_lista_mayorista();
DROP TABLE listas_precios_mayoristas;
