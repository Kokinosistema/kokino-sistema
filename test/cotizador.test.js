'use strict';

// Reglas del cotizador mayorista (src/cotizador.js). Son las pruebas del
// Sistema Rody pasadas a Kokino, con los mismos precios reales del Excel
// "Precios 22/04/26 Terminal": si dan lo mismo que alla, el calculo se
// traslado bien. No usan la base.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularCotizacion, textoWhatsApp, pesos } = require('../src/cotizador');
const dinero = require('../src/dinero');

const listaTerminal = {
  nombre: 'Lista Terminal',
  incluyeFamiliar: true,
  incluyeArtesanal: false,
  precios: { chocolate: 58000, 'dulce-de-leche': 58000, 'frutilla-crema': 52000, menta: 60000 },
};

// En la base, el Chocolate familiar y el artesanal son sabores distintos.
const listaGeneral = {
  nombre: 'Lista general',
  incluyeFamiliar: true,
  incluyeArtesanal: true,
  precios: {
    chocolate: 40000, 'chocolate-artesanal': 48000,
    'dulce-de-leche': 40000, 'dulce-de-leche-artesanal': 48000,
    'frutilla-crema': 35000, 'frutilla-crema-artesanal': 42000,
  },
};

const PRECIO_ENVASE = 5000;

const chocolate = (tachos) => ({ idSabor: 'chocolate', sabor: 'Chocolate', linea: 'FAMILIAR', tachos });
const chocolateArtesanal = (tachos) => ({ idSabor: 'chocolate-artesanal', sabor: 'Chocolate', linea: 'ARTESANAL', tachos });
const dulceDeLeche = (tachos) => ({ idSabor: 'dulce-de-leche', sabor: 'Dulce de Leche', linea: 'FAMILIAR', tachos });
const frutillaCrema = (tachos) => ({ idSabor: 'frutilla-crema', sabor: 'Frutilla a la crema', linea: 'FAMILIAR', tachos });
const menta = (tachos) => ({ idSabor: 'menta', sabor: 'Menta', linea: 'FAMILIAR', tachos });

describe('Calcular la cotización', () => {
  test('Terminal con tres sabores y dos envases comprados cobra $352.000', () => {
    const c = calcularCotizacion({
      lista: listaTerminal, precioEnvase: PRECIO_ENVASE,
      renglones: [chocolate(3), dulceDeLeche(2), frutillaCrema(1)],
      compraEnvases: true, envasesComprados: 2,
    });
    assert.equal(c.total, 352000);
    assert.equal(c.tachos, 6);
    assert.equal(c.envasesComprados, 2);
    assert.equal(c.envasesPrestados, 4);
    assert.equal(c.totalEnvases, 10000);
    assert.equal(c.esParcial, false);
  });

  test('Lista general con un renglón artesanal y dos envases comprados cobra $293.000', () => {
    const c = calcularCotizacion({
      lista: listaGeneral, precioEnvase: PRECIO_ENVASE,
      renglones: [chocolate(3), dulceDeLeche(2), frutillaCrema(1), chocolateArtesanal(1)],
      compraEnvases: true, envasesComprados: 2,
    });
    assert.equal(c.total, 293000);
    assert.equal(c.tachos, 7);
    assert.equal(c.envasesPrestados, 5);
  });

  test('cada renglón trae su precio unitario y su subtotal', () => {
    const c = calcularCotizacion({
      lista: listaGeneral, precioEnvase: PRECIO_ENVASE,
      renglones: [chocolateArtesanal(3)],
      compraEnvases: false, envasesComprados: 0,
    });
    assert.deepEqual(c.renglones, [
      { idSabor: 'chocolate-artesanal', sabor: 'Chocolate', linea: 'ARTESANAL', tachos: 3, estado: 'ok', precioUnitario: 48000, subtotal: 144000 },
    ]);
  });

  test('en Terminal un renglón artesanal queda no disponible y fuera del total', () => {
    const c = calcularCotizacion({
      lista: listaTerminal, precioEnvase: PRECIO_ENVASE,
      renglones: [chocolate(1), chocolateArtesanal(2)],
      compraEnvases: false, envasesComprados: 0,
    });
    assert.equal(c.renglones[1].estado, 'no-disponible');
    assert.equal(c.renglones[1].subtotal, null);
    assert.equal(c.total, 58000);
    assert.equal(c.esParcial, true);
  });

  test('en la Lista general Menta queda sin precio y fuera del total', () => {
    const c = calcularCotizacion({
      lista: listaGeneral, precioEnvase: PRECIO_ENVASE,
      renglones: [chocolate(1), menta(2)],
      compraEnvases: false, envasesComprados: 0,
    });
    assert.equal(c.renglones[1].estado, 'sin-precio');
    assert.equal(c.renglones[1].subtotal, null);
    assert.equal(c.total, 40000);
    assert.equal(c.esParcial, true);
  });

  test('los envases comprados nunca superan los tachos', () => {
    const c = calcularCotizacion({
      lista: listaTerminal, precioEnvase: PRECIO_ENVASE,
      renglones: [chocolate(2)],
      compraEnvases: true, envasesComprados: 5,
    });
    assert.equal(c.envasesComprados, 2);
    assert.equal(c.envasesPrestados, 0);
    assert.equal(c.totalEnvases, 10000);
  });

  test('si no compra envases, todos quedan prestados y no se cobra ninguno', () => {
    const c = calcularCotizacion({
      lista: listaTerminal, precioEnvase: PRECIO_ENVASE,
      renglones: [chocolate(3)],
      compraEnvases: false, envasesComprados: 3,
    });
    assert.equal(c.envasesComprados, 0);
    assert.equal(c.envasesPrestados, 3);
    assert.equal(c.totalEnvases, 0);
    assert.equal(c.total, 174000);
  });

  test('si todavía no respondió si compra envases, no se cobra ninguno', () => {
    const c = calcularCotizacion({
      lista: listaTerminal, precioEnvase: PRECIO_ENVASE,
      renglones: [chocolate(1)],
      compraEnvases: null, envasesComprados: 1,
    });
    assert.equal(c.envasesComprados, 0);
    assert.equal(c.total, 58000);
  });

  test('una cotización vacía da todo en cero', () => {
    const c = calcularCotizacion({
      lista: listaGeneral, precioEnvase: PRECIO_ENVASE,
      renglones: [],
      compraEnvases: true, envasesComprados: 2,
    });
    assert.deepEqual(
      [c.tachos, c.envasesComprados, c.envasesPrestados, c.total, c.esParcial],
      [0, 0, 0, 0, false]
    );
  });

  // Agregada en Kokino: la base devuelve los NUMERIC como texto ("58000.00").
  test('los precios pueden venir como texto, como los devuelve la base', () => {
    const c = calcularCotizacion({
      lista: { ...listaTerminal, precios: { chocolate: '58000.00' } }, precioEnvase: '5000.00',
      renglones: [chocolate(3)],
      compraEnvases: true, envasesComprados: 1,
    });
    assert.equal(c.total, 179000);
  });
});

// Agregado en Kokino (2026-10-22): el dueno puede corregir el precio de un
// renglon para esa venta, pero no inventarle precio a un sabor sin lista.
describe('Precio corregido para una venta', () => {
  test('el precio puesto reemplaza al de la lista', () => {
    const c = calcularCotizacion({
      lista: listaTerminal, precioEnvase: PRECIO_ENVASE,
      renglones: [{ ...chocolate(2), precio: 50000 }, dulceDeLeche(1)],
      compraEnvases: false, envasesComprados: 0,
    });
    assert.equal(c.renglones[0].precioUnitario, 50000);
    assert.equal(c.total, 158000);
  });

  test('un sabor sin precio en la lista sigue sin precio aunque se le ponga uno', () => {
    const c = calcularCotizacion({
      lista: listaGeneral, precioEnvase: PRECIO_ENVASE,
      renglones: [{ ...menta(1), precio: 30000 }],
      compraEnvases: false, envasesComprados: 0,
    });
    assert.equal(c.renglones[0].estado, 'sin-precio');
    assert.equal(c.total, 0);
  });
});

describe('Texto para WhatsApp', () => {
  test('tiene la heladería y el total en negrita, el cliente, la fecha, los renglones y los envases a devolver', () => {
    const c = calcularCotizacion({
      lista: listaTerminal, precioEnvase: PRECIO_ENVASE,
      renglones: [chocolate(3), dulceDeLeche(2), frutillaCrema(1)],
      compraEnvases: true, envasesComprados: 2,
    });
    const texto = textoWhatsApp(c, { heladeria: 'Heladería Kokino', cliente: 'Terminal', fecha: new Date(2026, 3, 5) });
    assert.equal(texto, [
      '*Heladería Kokino*',
      'Cotización para: Terminal',
      'Fecha: 05/04/2026',
      '',
      '3 × Chocolate (Familiar): $174.000',
      '2 × Dulce de Leche (Familiar): $116.000',
      '1 × Frutilla a la crema (Familiar): $52.000',
      '2 × Envase: $10.000',
      '',
      '*Total: $352.000*',
      '',
      'Envases prestados a devolver: 4',
    ].join('\n'));
  });

  test('marca los renglones sin precio o no disponibles y omite envases cuando no hay', () => {
    const c = calcularCotizacion({
      lista: listaGeneral, precioEnvase: PRECIO_ENVASE,
      renglones: [menta(1)],
      compraEnvases: true, envasesComprados: 1,
    });
    const texto = textoWhatsApp(c, { heladeria: 'Heladería Kokino', cliente: 'Los Álamos', fecha: new Date(2026, 9, 21) });
    assert.equal(texto, [
      '*Heladería Kokino*',
      'Cotización para: Los Álamos',
      'Fecha: 21/10/2026',
      '',
      '1 × Menta (Familiar): precio a confirmar',
      '1 × Envase: $5.000',
      '',
      '*Total: $5.000*',
    ].join('\n'));
  });
});

// El formato de plata esta repetido en src/cotizador.js porque el de
// src/dinero.js no llega al navegador: los dos tienen que dar lo mismo.
test('el formato de plata del cotizador es el mismo que el del resto del sistema', () => {
  for (const monto of [0, 5000, 41000, 352000, 1234567.89, '58000.00', 0.5, -2500]) {
    assert.equal(pesos(monto), dinero.pesos(monto), String(monto));
  }
});
