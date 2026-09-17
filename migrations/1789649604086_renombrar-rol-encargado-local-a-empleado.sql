-- Up Migration

-- encargado_local nombraba un puesto de trabajo y no un nivel de acceso, y la
-- tabla daba por sentado que los vendedores compartian esa cuenta. En Kokino
-- cada vendedor tiene la suya: es lo que permite saber quien abrio la caja,
-- quien hizo cada venta y a quien atribuir un faltante en el arqueo.
UPDATE roles
   SET nombre_rol  = 'empleado',
       descripcion = 'Personal de la sucursal. Opera unicamente sobre los datos de la sucursal a la que pertenece: vende, cobra, abre y cierra su caja y carga stock. Cada persona tiene su propia cuenta.'
 WHERE nombre_rol = 'encargado_local';

UPDATE roles
   SET descripcion = 'Dueños del negocio. Consultan las dos sucursales de forma consolidada, configuran el sistema y cargan las ventas mayoristas.'
 WHERE nombre_rol = 'administrador';

COMMENT ON TABLE roles IS
  'Niveles de acceso al sistema, no puestos de trabajo. Son dos: administrador y empleado. Cada persona que use el sistema tiene su propia cuenta en usuarios; las cuentas nunca se comparten, porque si se compartieran no se podría saber quién hizo cada operación.';

-- Down Migration

UPDATE roles
   SET nombre_rol  = 'encargado_local',
       descripcion = 'Responsable de una sucursal: atiende ventas, carga stock y, en la sucursal con fábrica, carga las producciones diarias.'
 WHERE nombre_rol = 'empleado';

UPDATE roles
   SET descripcion = 'Dueños del negocio. Acceso a todas las sucursales y a la fábrica.'
 WHERE nombre_rol = 'administrador';

COMMENT ON TABLE roles IS
  'Roles de acceso al sistema. Hoy son solo 2: administrador y encargado_local (vendedores y personal de producción no tienen usuario propio).';
