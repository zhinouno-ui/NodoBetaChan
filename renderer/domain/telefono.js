// Un solo lugar para los números de teléfono.
//
// Son TODOS argentinos, así que todos tienen que quedar como 549 + 10 dígitos (Juan, 27/9).
// Hasta ahora cada pantalla los dibujaba como venían: el mismo jugador se veía "1123456789" en
// una, "+54 11 2345-6789" en otra y "5491123456789" en la tercera — y buscarlo no cruzaba.
//
// Módulo puro: normaliza y formatea. No toca la base ni decide nada.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).telefono=factory();
})(globalThis, function(){
  'use strict';

  // Devuelve 549XXXXXXXXXX, o '' si no hay con qué. NUNCA inventa: si no llega a 10 dígitos
  // útiles, devuelve vacío en vez de un número a medias que después nadie puede cruzar.
  function normalizar(v){
    let d = String(v == null ? '' : v).replace(/\D/g, '');
    if(!d) return '';

    // 1) Sacar el código de país si vino, con o sin el 9.
    if(d.startsWith('549')) d = d.slice(3);
    else if(d.startsWith('54')) d = d.slice(2);

    // 2) Sacar el 0 de larga distancia (011…).
    d = d.replace(/^0+/, '');

    // 3) Sacar el 15 viejo, que va DESPUÉS del código de área: 11 15 2345-6789.
    //    Sólo si al sacarlo quedan los 10 dígitos que corresponden — si no, se deja como está,
    //    porque un 15 en otra posición puede ser parte del número de verdad.
    if(d.length === 12){
      for(const corte of [2, 3, 4]){          // códigos de área de 2, 3 o 4 dígitos
        if(d.slice(corte, corte + 2) === '15'){
          d = d.slice(0, corte) + d.slice(corte + 2);
          break;
        }
      }
    }

    // 4) Los últimos 10 son área + abonado. Es el mismo criterio con el que la base cruza los
    //    contactos de Whaticket (right(...,10)), así que lo de acá y lo de allá coinciden.
    if(d.length < 10) return '';
    d = d.slice(-10);
    return '549' + d;
  }

  // Para MOSTRAR. Mismo número, legible: +54 9 11 2345-6789.
  //
  // El agrupado es COSMÉTICO: con 10 dígitos pelados no se puede saber si el área es de 2 (11),
  // 3 (351) o 4 (2954) dígitos. Sólo se reconoce el 11, que es la mayoría; el resto se agrupa de
  // a 3. Si el corte cae mal, se ve un espacio corrido de lugar — los dígitos NUNCA cambian, que
  // es lo único que importa para llamar, cruzar o buscar.
  function mostrar(v){
    const n = normalizar(v);
    if(!n) return String(v == null ? '' : v).trim();   // no se pudo normalizar: se muestra lo que hay
    const resto = n.slice(3);                          // los 10 de área + abonado
    const area = resto.startsWith('11') ? resto.slice(0, 2) : resto.slice(0, 3);
    const sigue = resto.slice(area.length);
    return '+54 9 ' + area + ' ' + sigue.slice(0, sigue.length - 4) + '-' + sigue.slice(-4);
  }

  // Para comparar dos teléfonos escritos distinto. '' nunca es igual a '': sin número no hay
  // coincidencia que valga, y decir que sí juntaría jugadores que no tienen nada que ver.
  function mismo(a, b){
    const na = normalizar(a), nb = normalizar(b);
    return !!na && na === nb;
  }

  return { normalizar, mostrar, mismo };
});
