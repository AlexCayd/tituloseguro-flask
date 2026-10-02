/* Título Seguro · utilidades compartidas de las páginas interiores (tramo B).
 *
 *   TS.copiar(texto)            → Promise<boolean> (portapapeles con respaldo para http sin TLS)
 *   [data-copiar="#id"]         → botón que copia el texto (o el value) del elemento indicado
 *   [data-copiar-texto="…"]     → botón que copia ese texto literal
 *   [data-compartir]            → hoja de compartir nativa (data-url, data-titulo, data-texto);
 *                                 si el navegador no la tiene, el botón se oculta
 *   [data-escribanos-vivo]      → tabla de honor de los escribanos al día con /estado
 *   Glosario: términos nuevos que usan estas páginas.
 */
(() => {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const d = document;

  /* ------------------------------------------------------------------ glosario: términos nuevos */
  if (TS.glosario && TS.glosario.terminos) {
    Object.assign(TS.glosario.terminos, {
      transaccion: {
        titulo: 'Transacción',
        def: 'El paquete que la universidad firma: quién lo manda (su llave pública), qué dice (la credencial o la revocación) y a qué hora. Es lo que viaja por la fila hasta quedar dentro de un bloque.',
        analogia: 'Como el sobre con el documento que la notaría recibe para archivar.',
        tecnico: 'Campos: proposito, remitente, contenido y hora. La firma se calcula sobre todo eso en JSON ordenado.',
      },
      remitente: {
        titulo: 'Remitente',
        def: 'La llave pública de quien firmó la transacción. Con ella cualquiera comprueba la firma, y la red sabe a qué universidad pertenece.',
        analogia: 'El membrete del sobre: dice de qué oficina viene.',
      },
      rol: {
        titulo: 'Rol (papel de la cuenta)',
        def: 'Lo que una cuenta puede hacer. Universidad: emitir y revocar. Minero: iniciar carreras. Alumno: ver y compartir sus credenciales. Administración: configurar la red. Verificar no necesita cuenta.',
        analogia: 'Como los gafetes de una oficina: cada uno abre ciertas puertas.',
      },
      reparto: {
        titulo: 'Reparto de números',
        def: 'Cómo se dividen los números de intento entre los cuatro escribanos para que nadie repita trabajo: Derek prueba 0, 4, 8…; Carlos 1, 5, 9…; Alicia 2, 6, 10…; Bruno 3, 7, 11…',
        analogia: 'Como repartir las páginas de un directorio entre cuatro personas que buscan un mismo número: cada quien revisa las suyas.',
        tecnico: 'Partición por residuo: el escribano i solo prueba nonces con nonce mod 4 = i. El servidor lo verifica al aceptar el bloque.',
      },
      copia: {
        titulo: 'Copia de la cadena',
        def: 'En el laboratorio no tocamos la cadena real: hacemos una copia en la memoria del servidor, le aplicamos la trampa y la revisamos. Al terminar, la copia se tira.',
        analogia: 'Como practicar una falsificación sobre una fotocopia: el original sigue en la caja fuerte.',
      },
      'efecto-domino': {
        titulo: 'Efecto dominó',
        def: 'Si cambias una hoja y recalculas su huella, la hoja siguiente deja de apuntarle. Para arreglarla tendrías que cambiarla también y volver a minarla… y así con todas las que siguen.',
        analogia: 'Como sacar una ficha de dominó de en medio de la fila: para disimularlo tendrías que mover todas las de atrás.',
      },
      ronda: {
        titulo: 'Ronda (del cronómetro)',
        def: 'Una carrera completa de los cuatro escribanos sobre una cadena de práctica que se tira al terminar. Se repite varias veces para sacar un promedio, porque la suerte hace que unas carreras sean cortas y otras largas.',
        analogia: 'Como cronometrar varias vueltas a la pista para saber tu tiempo típico.',
      },
      'escala-log': {
        titulo: 'Escala logarítmica',
        def: 'Una forma de dibujar números muy distintos en la misma gráfica: cada escalón vale 10 veces más que el anterior. Así 4,096 y 1,048,576 caben juntos, y un crecimiento «por 16» se ve como escalones iguales.',
        analogia: 'Como una escalera donde cada peldaño te lleva a un piso diez veces más alto.',
      },
      qr: {
        titulo: 'Código QR',
        def: 'Un cuadro de puntos que la cámara del teléfono lee como un enlace. El de cada credencial abre su página de verificación en Título Seguro.',
        analogia: 'Como una etiqueta de código de barras, pero que guarda una dirección web.',
      },
      json: {
        titulo: 'JSON',
        def: 'Un formato de texto para guardar datos con nombre y valor, como "programa": "Medicina". Así se escribe cada bloque antes de calcular su huella.',
        analogia: 'Como una ficha con renglones etiquetados.',
      },
    });
  }

  /* ------------------------------------------------------------------ copiar */
  TS.copiar = async (texto) => {
    texto = String(texto ?? '');
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(texto);
        return true;
      }
    } catch { /* cae al respaldo */ }
    const ta = TS.el('textarea', { readonly: '', 'aria-hidden': 'true', style: { position: 'fixed', top: '-200px', opacity: '0' } });
    ta.value = texto;
    d.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = d.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  };

  function acuse(boton, ok) {
    const et = boton.querySelector('[data-copiar-etiqueta]') || boton;
    if (!boton.dataset.etiquetaOriginal) boton.dataset.etiquetaOriginal = et.textContent;
    et.textContent = ok ? '¡Copiado!' : 'No se pudo copiar';
    boton.dataset.copiado = ok ? 'si' : 'no';
    TS.anunciar(ok ? 'Copiado al portapapeles.' : 'No se pudo copiar. Selecciona el texto y cópialo a mano.');
    window.clearTimeout(+boton.dataset.copiarTimer || 0);
    boton.dataset.copiarTimer = String(window.setTimeout(() => {
      et.textContent = boton.dataset.etiquetaOriginal;
      delete boton.dataset.copiado;
    }, 1800));
  }

  d.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-copiar], [data-copiar-texto]');
    if (b) {
      ev.preventDefault();
      let texto = b.dataset.copiarTexto;
      if (texto == null) {
        const obj = d.querySelector(b.dataset.copiar);
        if (!obj) return;
        texto = 'value' in obj && obj.tagName !== 'BUTTON' ? obj.value : obj.textContent;
      }
      acuse(b, await TS.copiar(texto));
      return;
    }
    const s = ev.target.closest('[data-compartir]');
    if (s && navigator.share) {
      ev.preventDefault();
      try {
        await navigator.share({ title: s.dataset.titulo || d.title, text: s.dataset.texto || '', url: s.dataset.url || window.location.href });
      } catch { /* cancelado */ }
    }
  });

  /* ------------------------------------------------------------------ escribanos vivos */
  function escribanosVivos(ol) {
    const rec = +ol.dataset.recompensa || 50;
    const filas = () => TS.$$('.escribano', ol);
    TS.estado.suscribir((e) => {
      if (!e || !Array.isArray(e.nodos)) return;
      const datos = new Map(e.nodos.map((n) => [n.nombre, Math.round((n.saldo || 0) / rec)]));
      const maxb = Math.max(0, ...datos.values());
      let cambio = false;
      for (const li of filas()) {
        const b = datos.get(li.dataset.nombre);
        if (b == null) continue;
        const el = li.querySelector('[data-e="bloques"]');
        if (el && el.textContent !== TS.fmt.miles(b)) {
          el.textContent = TS.fmt.miles(b);
          const t = li.querySelector('[data-e="bloques-texto"]');
          if (t) t.textContent = b === 1 ? 'bloque' : 'bloques';
          const s = li.querySelector('[data-e="saldo"]');
          if (s) s.textContent = TS.fmt.miles(b * rec);
          li.dataset.b = String(b);
          cambio = true;
        }
        li.style.setProperty('--b', String(maxb ? Math.round((b / maxb) * 1000) / 1000 : 0));
      }
      if (!cambio) return;
      // reordena (más bloques primero; empate, orden alfabético como en el servidor) con FLIP
      const lista = filas();
      const antes = new Map(lista.map((li) => [li, li.getBoundingClientRect().top]));
      lista.sort((a, b) => (datos.get(b.dataset.nombre) - datos.get(a.dataset.nombre)) || a.dataset.nombre.localeCompare(b.dataset.nombre, 'es'));
      lista.forEach((li, k) => {
        ol.append(li);
        const p = li.querySelector('[data-e="puesto"]');
        if (p) p.textContent = String(k + 1);
      });
      if (TS.reducido()) return;
      for (const li of lista) {
        const dy = antes.get(li) - li.getBoundingClientRect().top;
        if (dy) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.2, 0.9, 0.1, 1)' });
      }
    });
  }

  TS.listo(() => {
    if (!navigator.share) TS.$$('[data-compartir]').forEach((b) => { b.hidden = true; });
    TS.$$('[data-escribanos-vivo]').forEach(escribanosVivos);
  });
})();
