'use strict';

// Validacion y formato del CUIT, compartida por proveedores y clientes.
//
// Vive aparte porque las dos pantallas necesitan exactamente lo mismo y
// tenerlo dos veces garantiza que algun dia una de las dos se corrija y la
// otra no.

// El CUIT trae digito verificador, asi que se puede saber si esta bien escrito
// sin preguntarle a nadie. Vale la pena validarlo al cargarlo y no cuando se
// factura: AFIP rechaza un CUIT invalido, y para entonces el error estaria a
// meses de distancia de la tecla que lo escribio mal.
function cuitValido(digitos) {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, peso, i) => acc + peso * Number(digitos[i]), 0);
  const resto = suma % 11;
  const verificador = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return verificador === Number(digitos[10]);
}

// Como empieza un CUIT segun AFIP: 20, 23, 24 y 27 son personas; 30, 33 y 34,
// empresas y sociedades. Los proveedores y mayoristas suelen ser empresas,
// asi que no alcanza con aceptar los de personas.
const PREFIJOS = ['20', '23', '24', '27', '30', '33', '34'];

// Devuelve { cuit } con el numero normalizado con guiones, o { error } con un
// mensaje que se le puede mostrar a la persona tal cual. El vacio es valido:
// el CUIT no es obligatorio.
//
// Se guarda siempre con guiones para que la columna no termine con la mitad de
// los CUIT escritos de una forma y la mitad de otra.
function normalizarCuit(entrada) {
  const texto = (entrada || '').trim();
  if (texto === '') return { cuit: null };
  // Guiones y espacios se aceptan porque son la forma de escribirlo; una
  // letra no, y se avisa en vez de borrarla sin decir nada.
  if (/[^\d\s-]/.test(texto)) return { error: 'El CUIT solo puede tener números: los guiones los pone el sistema.' };
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length !== 11) return { error: 'El CUIT tiene que tener 11 números (tiene ' + digitos.length + ').' };
  if (!PREFIJOS.includes(digitos.slice(0, 2))) {
    return { error: 'Un CUIT empieza con ' + PREFIJOS.join(', ').replace(/, (\d+)$/, ' o $1') + ': revisá los dos primeros números.' };
  }
  if (!cuitValido(digitos)) return { error: 'Ese CUIT no existe: el último número (el dígito verificador) no cierra. Revisá que esté bien copiado.' };
  return { cuit: digitos.slice(0, 2) + '-' + digitos.slice(2, 10) + '-' + digitos.slice(10) };
}

module.exports = { normalizarCuit, PREFIJOS };
