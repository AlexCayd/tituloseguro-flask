/* Título Seguro · glosario.
 *
 *   <button type="button" class="termino" data-termino="huella">hash</button>
 *     → abre un popover con definición llana + analogía cotidiana (+ detalle técnico opcional).
 *   [data-accion="glosario"]  → abre el cajón con todos los términos y buscador.
 *   TS.glosario.terminos      → objeto { clave: {titulo, def, analogia, tecnico?} }. El tramo B puede
 *                               añadir claves:  Object.assign(TS.glosario.terminos, {...})
 *   TS.glosario.abrir(clave?) · TS.glosario.mostrar(boton) · TS.glosario.cerrar()
 */
(() => {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const d = document;

  const terminos = {
    huella: {
      titulo: 'Huella (hash)',
      def: 'Un código de 64 caracteres que se calcula a partir de un contenido. El mismo contenido siempre da la misma huella; si cambias una sola letra, sale una huella completamente distinta.',
      analogia: 'Como la huella digital de una persona: la identifica sin ser la persona, y no puedes reconstruir a nadie a partir de su huella.',
      tecnico: 'SHA-256. La huella de un bloque se calcula con todos sus campos, ordenados como JSON, menos la propia huella.',
    },
    nonce: {
      titulo: 'Número de intento (nonce)',
      def: 'Un número que el minero va cambiando hasta que la huella del bloque sale con los ceros pedidos. Por sí solo no significa nada: es el boleto que resultó premiado.',
      analogia: 'Como probar combinaciones en el candado de una maleta: 0001, 0002, 0003… hasta que abre.',
      tecnico: 'Cada minero prueba su propia serie: el minero i usa i, i+4, i+8… Así ninguno repite ni se salta un número.',
    },
    firma: {
      titulo: 'Firma digital',
      def: 'Un código que la universidad produce con su llave privada a partir de la credencial. Demuestra quién la emitió y que nadie la cambió después.',
      analogia: 'Como un sello de lacre con el escudo de la universidad: solo ella tiene el sello, pero cualquiera reconoce el escudo.',
      tecnico: 'Ed25519: 64 bytes (128 caracteres hexadecimales) sobre la transacción en JSON ordenado.',
    },
    'llave-privada': {
      titulo: 'Llave privada',
      def: 'El secreto con el que una universidad firma. Solo ella la tiene: si alguien más la consiguiera, podría firmar en su nombre.',
      analogia: 'Es el sello de metal que la notaría guarda en su caja fuerte.',
      tecnico: 'En Título Seguro se guarda cifrada en el servidor y nunca viaja al navegador.',
    },
    'llave-publica': {
      titulo: 'Llave pública',
      def: 'La parte que todos pueden ver. Sirve para comprobar que una firma es auténtica, pero no para fabricar firmas nuevas.',
      analogia: 'Es la imagen del escudo publicada en el diario oficial: con ella reconoces un sello verdadero, pero no puedes fabricar el sello.',
      tecnico: '32 bytes (64 caracteres hex). Va en el campo «remitente» de cada transacción.',
    },
    sello: {
      titulo: 'Sello de lacre',
      def: 'El dibujo de cera que ves en cada folio. Se genera con los bytes de la firma digital: firmas distintas dan sellos distintos, y si algo no cuadra, el sello aparece agrietado.',
      analogia: 'Como el sello de cera de una carta antigua: si alguien la abre, el sello se rompe y se nota.',
      tecnico: 'Es solo una forma de ver la firma. La comprobación real la hace el algoritmo Ed25519.',
    },
    bloque: {
      titulo: 'Bloque (folio)',
      def: 'Una hoja del libro de registro. Guarda una credencial o una revocación, quién la selló, el número de intento ganador, la huella del bloque anterior y su propia huella.',
      analogia: 'Una hoja numerada de un libro notarial que ya no se puede arrancar ni reescribir.',
      tecnico: 'Campos: numero, timestamp, transaccion, firma, hash_anterior, nonce, minero, recompensa, dificultad y hash.',
    },
    cadena: {
      titulo: 'Cadena de bloques',
      def: 'Todos los bloques en orden, cada uno unido al anterior por su huella. Para cambiar uno tendrías que rehacer también todos los que siguen.',
      analogia: 'Un expediente cosido con un cordón que pasa por todas las hojas: si sacas o cambias una, el cordón ya no cierra.',
    },
    'huella-anterior': {
      titulo: 'Huella anterior',
      def: 'La huella del bloque previo, copiada dentro del bloque nuevo. Es lo que une las hojas: si el bloque previo cambia, su huella cambia y deja de coincidir con esta copia.',
      analogia: 'Como anotar en cada página el número de serie de la página anterior.',
    },
    genesis: {
      titulo: 'Bloque génesis',
      def: 'El bloque 0, la primera hoja del libro. No lo minó nadie y no tiene bloque anterior: por eso su «huella anterior» son 64 ceros.',
      analogia: 'La primera página del libro, con el acta de apertura.',
    },
    minero: {
      titulo: 'Minero (escribano)',
      def: 'Un participante que hace el trabajo de buscar el número ganador. Aquí hay cuatro: Derek, Carlos, Alicia y Bruno. El primero que lo encuentra archiva el bloque y cobra la recompensa.',
      analogia: 'Escribanos que compiten por pasar en limpio el siguiente documento: el primero que termina lo firma y cobra.',
      tecnico: 'Cada minero es un hilo de ejecución del servidor.',
    },
    dificultad: {
      titulo: 'Dificultad',
      def: 'Cuántos ceros debe tener la huella al inicio. Cada cero extra hace el trabajo 16 veces más difícil: con 5 ceros hace falta, en promedio, 1 intento de cada 1,048,576.',
      analogia: 'Como pedir que un dado caiga en 1 varias veces seguidas: cada vez que pides una más, es mucho menos probable.',
      tecnico: 'Ceros hexadecimales iniciales. Probabilidad por intento: 1 / 16^N.',
    },
    recompensa: {
      titulo: 'Recompensa (TS)',
      def: 'Lo que cobra el minero que gana: 50 TS por bloque. Su nombre queda escrito dentro del bloque, así que nadie puede quedarse con su premio copiando el bloque.',
      analogia: 'El pago al escribano por pasar en limpio el documento, anotado en el mismo documento.',
      tecnico: 'Los saldos no se guardan aparte: se calculan sumando las recompensas que hay en la cadena.',
    },
    pow: {
      titulo: 'Prueba de trabajo',
      def: 'La regla que obliga a hacer muchísimos intentos antes de agregar un bloque. Encontrar la solución cuesta mucho, pero comprobarla es instantáneo: por eso falsificar la cadena saldría carísimo.',
      analogia: 'Como un sudoku: resolverlo toma tiempo, pero revisar que está bien resuelto toma segundos.',
      tecnico: 'En inglés, Proof of Work (PoW).',
    },
    folio: {
      titulo: 'Folio',
      def: 'El código único de cada credencial, por ejemplo TS-UAN-13FEF4FB1630: «TS» de Título Seguro, las 3 letras de la universidad y 12 caracteres al azar. Con él cualquiera puede verificarla.',
      analogia: 'Como el número de serie de un billete.',
    },
    'id-alumno': {
      titulo: 'ID de alumno (seudónimo)',
      def: 'En lugar de tu nombre o tu matrícula, la cadena guarda un código calculado a partir de tu matrícula con una clave secreta del servidor. Siempre sale igual para ti, pero nadie puede volver de ese código a tu matrícula.',
      analogia: 'Como el número de un casillero: identifica tu casillero sin decir de quién es.',
      tecnico: 'HMAC-SHA-256 de la matrícula normalizada. Tu nombre nunca se escribe en la cadena.',
    },
    'huella-documento': {
      titulo: 'Huella del documento',
      def: 'La huella calculada con los datos de la credencial (alumno, programa, tipo, universidad y fecha). Impide que el mismo documento se registre dos veces.',
      analogia: 'La huella digital del propio título, distinta de la huella del bloque que lo guarda.',
    },
    revocacion: {
      titulo: 'Revocación',
      def: 'Si una universidad anula un título, no lo borra: agrega un bloque nuevo, firmado por ella misma, que dice «este folio queda revocado». El registro original sigue ahí y la historia completa queda a la vista.',
      analogia: 'Como una nota al margen en el libro notarial: no se tacha la hoja, se agrega una anotación firmada.',
    },
    'red-permisionada': {
      titulo: 'Red permisionada',
      def: 'Una red donde solo instituciones autorizadas pueden firmar credenciales. Cualquiera puede consultar y verificar, pero no cualquiera puede emitir.',
      analogia: 'Como un colegio de notarios: solo los notarios dan fe, pero cualquiera puede leer un acta.',
    },
    inmutabilidad: {
      titulo: 'Inmutabilidad',
      def: 'Lo registrado ya no se puede cambiar sin que se note. No es que sea imposible tocar los datos: es que cualquier cambio rompe huellas, sellos y enlaces, y eso salta a la vista.',
      analogia: 'Como escribir con tinta en un libro cosido y foliado: puedes intentar raspar, pero queda la marca.',
    },
    hilo: {
      titulo: 'Hilo (de ejecución)',
      def: 'Una tarea que la computadora ejecuta al mismo tiempo que otras. Cada uno de los cuatro mineros es un hilo: trabajan en paralelo dentro del mismo servidor.',
      analogia: 'Cuatro personas trabajando a la vez en la misma oficina, cada una en su escritorio.',
    },
    cola: {
      titulo: 'Cola de pendientes',
      def: 'Las credenciales firmadas que esperan turno para entrar a la cadena. Se minan en orden de llegada, una por carrera.',
      analogia: 'La fila de documentos sobre el escritorio del notario.',
    },
    obsoleta: {
      titulo: 'Solución obsoleta',
      def: 'Cuando un minero encuentra un número válido, pero otro ya ganó esa carrera. Su hallazgo ya no sirve: el bloque ya está en la cadena.',
      analogia: 'Como llegar con el boleto premiado cuando el sorteo ya se cobró.',
    },
    velocidad: {
      titulo: 'Velocidad (intentos por segundo)',
      def: 'Cuántas huellas calcula un minero cada segundo. Más velocidad no garantiza ganar: solo permite lanzar el dado más veces.',
      analogia: 'Lanzar dados más rápido que los demás: ayuda, pero la suerte sigue mandando.',
      tecnico: 'En inglés, hashrate.',
    },
  };

  const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* ------------------------------------------------------------------ popover de un término */
  let pop = null;
  let origen = null;
  const soportaPopover = typeof HTMLElement !== 'undefined' && Object.prototype.hasOwnProperty.call(HTMLElement.prototype, 'popover');

  function crearPop() {
    if (pop) return pop;
    pop = TS.el('div', { id: 'ts-termino', class: 'termino-pop', role: 'dialog', 'aria-labelledby': 'ts-termino-titulo', tabindex: '-1' },
      TS.el('button', { type: 'button', class: 'termino-pop__cerrar', 'aria-label': 'Cerrar definición', 'data-cerrar': '' }, TS.icono('cerrar')),
      TS.el('p', { class: 'termino-pop__ceja' }, 'Glosario'),
      TS.el('h2', { class: 'termino-pop__titulo', id: 'ts-termino-titulo' }),
      TS.el('p', { class: 'termino-pop__def' }),
      TS.el('p', { class: 'termino-pop__analogia' }, TS.el('strong', null, 'Es como…'), TS.el('span')),
      TS.el('details', null, TS.el('summary', null, 'Más técnico'), TS.el('p')),
      TS.el('div', { class: 'termino-pop__pie' },
        TS.el('button', { type: 'button', class: 'boton boton--fantasma boton--chico', 'data-todo': '' }, 'Ver todo el glosario')));
    if (soportaPopover) pop.setAttribute('popover', 'auto');
    else pop.hidden = true;
    d.body.append(pop);
    pop.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-cerrar]')) cerrar(true);
      else if (ev.target.closest('[data-todo]')) {
        const clave = pop.dataset.clave;
        cerrar(false);
        abrir(clave);
      }
    });
    pop.addEventListener('toggle', (ev) => {
      if (ev.newState === 'closed') alCerrar();
    });
    if (!soportaPopover) {
      d.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !pop.hidden) cerrar(true); });
      d.addEventListener('pointerdown', (ev) => {
        if (!pop.hidden && !pop.contains(ev.target) && !ev.target.closest('.termino')) cerrar(false);
      });
    }
    window.addEventListener('resize', () => abierto() && posicionar());
    window.addEventListener('scroll', () => abierto() && posicionar(), { passive: true, capture: true });
    return pop;
  }
  const abierto = () => pop && (soportaPopover ? pop.matches(':popover-open') : !pop.hidden);

  function rellenar(cont, t, clave) {
    TS.$('.termino-pop__titulo', cont).textContent = t.titulo;
    TS.$('.termino-pop__def', cont).textContent = t.def;
    const an = TS.$('.termino-pop__analogia', cont);
    an.hidden = !t.analogia;
    TS.$('.termino-pop__analogia span', cont).textContent = t.analogia || '';
    const det = TS.$('details', cont);
    det.hidden = !t.tecnico;
    det.open = false;
    TS.$('details p', cont).textContent = t.tecnico || '';
    cont.dataset.clave = clave;
  }

  function posicionar() {
    if (!origen || !pop) return;
    const r = origen.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const m = 12;
    let x = Math.min(Math.max(m, r.left), window.innerWidth - w - m);
    let y = r.bottom + 8;
    if (y + h > window.innerHeight - m && r.top - h - 8 > m) y = r.top - h - 8;
    y = Math.max(m, Math.min(y, window.innerHeight - h - m));
    pop.style.left = `${Math.round(x)}px`;
    pop.style.top = `${Math.round(y)}px`;
  }

  let cerradoEn = 0;
  function mostrar(boton) {
    const clave = boton.dataset.termino;
    const t = terminos[clave];
    if (!t) return;
    crearPop();
    if (abierto() && origen === boton) { cerrar(true); return; }
    // el cierre automático del popover ocurre en pointerdown: si este mismo botón lo acaba de
    // cerrar, el clic no debe reabrirlo (así el término funciona como interruptor)
    if (origen === boton && performance.now() - cerradoEn < 350) return;
    if (abierto()) cerrar(false);
    origen = boton;
    rellenar(pop, t, clave);
    boton.setAttribute('aria-expanded', 'true');
    boton.setAttribute('aria-controls', 'ts-termino');
    if (soportaPopover) {
      try { pop.showPopover({ source: boton }); } catch { pop.showPopover(); }
    } else pop.hidden = false;
    posicionar();
    pop.focus({ preventScroll: true });
  }
  function alCerrar() {
    cerradoEn = performance.now();
    if (origen) origen.setAttribute('aria-expanded', 'false');
  }
  function cerrar(devolverFoco) {
    if (!pop || !abierto()) return;
    const o = origen;
    if (soportaPopover) pop.hidePopover();
    else { pop.hidden = true; alCerrar(); }
    if (devolverFoco && o) o.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ cajón con todo el glosario */
  function cajon() { return d.getElementById('ts-glosario'); }
  function construirLista() {
    const c = cajon();
    if (!c) return null;
    const lista = TS.$('[data-glosario-lista]', c);
    if (lista && !lista.dataset.listo) {
      const claves = Object.keys(terminos).sort((a, b) => terminos[a].titulo.localeCompare(terminos[b].titulo, 'es'));
      lista.replaceChildren(...claves.map((k) => {
        const t = terminos[k];
        return TS.el('div', { class: 'glosario__entrada', id: `glosario-${k}`, 'data-clave': k, 'data-busqueda': normal(`${t.titulo} ${t.def} ${t.analogia || ''} ${k}`) },
          TS.el('dt', null, t.titulo),
          TS.el('dd', null, t.def,
            t.analogia ? TS.el('p', { class: 'termino-pop__analogia' }, TS.el('strong', null, 'Es como…'), t.analogia) : null,
            t.tecnico ? TS.el('p', { class: 'nota', style: { 'margin-block-start': '0.5rem' } }, TS.el('strong', null, 'Más técnico: '), t.tecnico) : null));
      }));
      lista.dataset.listo = '1';
      const buscar = TS.$('[data-glosario-buscar]', c);
      const cuenta = TS.$('[data-glosario-cuenta]', c);
      const vacio = TS.$('[data-glosario-vacio]', c);
      const filtrar = () => {
        const q = normal(buscar.value).trim();
        let n = 0;
        TS.$$('.glosario__entrada', lista).forEach((e) => {
          const ver = !q || e.dataset.busqueda.includes(q);
          e.hidden = !ver;
          if (ver) n++;
        });
        if (cuenta) cuenta.textContent = `${n} ${n === 1 ? 'término' : 'términos'}`;
        if (vacio) vacio.hidden = n > 0;
      };
      if (buscar) buscar.addEventListener('input', filtrar);
      filtrar();
    }
    return c;
  }
  function abrir(clave) {
    const c = construirLista();
    if (!c || typeof c.showModal !== 'function') return;
    if (!c.open) c.showModal();
    TS.$$('.glosario__entrada[data-resaltado]', c).forEach((e) => e.removeAttribute('data-resaltado'));
    if (clave) {
      const buscar = TS.$('[data-glosario-buscar]', c);
      if (buscar && buscar.value) { buscar.value = ''; buscar.dispatchEvent(new Event('input')); }
      const e = d.getElementById(`glosario-${clave}`);
      if (e) {
        e.setAttribute('data-resaltado', '');
        e.scrollIntoView({ block: 'start', behavior: TS.reducido() ? 'auto' : 'smooth' });
      }
    }
  }

  /* ------------------------------------------------------------------ eventos */
  d.addEventListener('click', (ev) => {
    const t = ev.target.closest('.termino[data-termino]');
    if (t) { ev.preventDefault(); mostrar(t); return; }
    const a = ev.target.closest('[data-accion="glosario"]');
    if (a) {
      ev.preventDefault();
      const menu = d.getElementById('menu-principal');
      try { if (menu && menu.matches(':popover-open')) menu.hidePopover(); } catch { /* sin popover */ }
      abrir(a.dataset.termino || null);
      return;
    }
    const c = ev.target.closest('[data-accion="cerrar-glosario"]');
    if (c) { const dlg = cajon(); if (dlg) dlg.close(); return; }
    const dlg = cajon();
    if (dlg && ev.target === dlg) dlg.close(); // clic en el fondo
  });

  TS.glosario = { terminos, mostrar, cerrar, abrir };
})();
