/* Barcode Generator - TekiDeki
 * SPDX-License-Identifier: Apache-2.0
 *
 * The page. It reads the typed codes, asks barcode.js for the modules, then
 * draws them as SVG. The same svg string feeds the screen preview, the file
 * download and the print sheet, so what you see is what gets printed.
 */
(function () {
  'use strict';

  var B = window.Barcode;

  /* ------------------------------------------------------------- language */

  var LOCALES = window.TD_LOCALES || { en: {} };
  var lang = 'en';

  function t(key, vars) {
    var table = LOCALES[lang] || LOCALES.en || {};
    var value = table[key] || (LOCALES.en || {})[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        value = value.replace('{' + name + '}', String(vars[name]));
      });
    }
    return value;
  }

  function applyLanguage(next, remember) {
    lang = LOCALES[next] ? next : 'en';
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });
    document.getElementById('lang').value = lang;
    if (remember) store('lang', lang);
    render();
  }

  /* ---------------------------------------------------------------- store */

  function store(key, value) {
    try { localStorage.setItem('barcode-generator.' + key, value); } catch (e) { /* private mode */ }
  }
  function load(key, fallback) {
    try {
      var value = localStorage.getItem('barcode-generator.' + key);
      return value === null ? fallback : value;
    } catch (e) { return fallback; }
  }

  /* ----------------------------------------------------------------- state */

  var state = {
    type: load('type', 'ean13'),
    codes: load('codes', '4006381333931'),
    module: parseFloat(load('module', '0.33')),
    height: parseFloat(load('height', '18')),
    textsize: parseFloat(load('textsize', '9')),
    showtext: load('showtext', '1') === '1',
    labelw: parseFloat(load('labelw', '63.5')),
    labelh: parseFloat(load('labelh', '30')),
    gap: parseFloat(load('gap', '3'))
  };
  if (!B.TYPES[state.type]) state.type = 'ean13';

  var HINTS = {
    ean13: 'hintEan13', ean8: 'hintEan8', upca: 'hintUpca',
    code128: 'hintCode128', code39: 'hintCode39', itf14: 'hintItf14'
  };

  /* ------------------------------------------------------------- drawing */

  // One svg, in millimetres, with the bars as a single path of rectangles.
  function buildSvg(result, opts) {
    var pad = (result.quiet || 10) * opts.module;
    var barsW = result.bits.length * opts.module;
    var textMm = opts.showtext ? opts.textsize * 0.3528 : 0;
    var gapMm = opts.showtext ? 1.1 : 0;
    var wmm = barsW + pad * 2;
    var hmm = opts.height + textMm + gapMm;

    var path = [];
    var run = 0;
    for (var i = 0; i <= result.bits.length; i++) {
      if (result.bits.charAt(i) === '1') {
        run++;
      } else if (run) {
        path.push('M' + fmt(pad + (i - run) * opts.module) + ' 0h' +
          fmt(run * opts.module) + 'V' + fmt(opts.height) + 'H' +
          fmt(pad + (i - run) * opts.module) + 'Z');
        run = 0;
      }
    }

    var label = opts.showtext
      ? '<text x="' + fmt(wmm / 2) + '" y="' + fmt(opts.height + gapMm + textMm * 0.78) +
        '" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="' +
        fmt(textMm) + '" fill="#000">' + escapeXml(result.text) + '</text>'
      : '';

    return {
      wmm: wmm,
      hmm: hmm,
      markup:
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + fmt(wmm) + 'mm" height="' + fmt(hmm) +
        'mm" viewBox="0 0 ' + fmt(wmm) + ' ' + fmt(hmm) + '" role="img" aria-label="' +
        escapeXml(result.name + ' ' + result.text) + '">' +
        '<rect width="' + fmt(wmm) + '" height="' + fmt(hmm) + '" fill="#fff"/>' +
        '<path fill="#000" d="' + path.join('') + '"/>' + label + '</svg>'
    };
  }

  function fmt(value) {
    return (Math.round(value * 1000) / 1000).toString();
  }

  function escapeXml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function options() {
    return {
      module: clamp(state.module, 0.15, 1.5),
      height: clamp(state.height, 4, 90),
      textsize: clamp(state.textsize, 3, 24),
      showtext: state.showtext
    };
  }

  function clamp(value, low, high) {
    if (!isFinite(value)) return low;
    return Math.min(high, Math.max(low, value));
  }

  /* -------------------------------------------------------------- parsing */

  function analyse() {
    var lines = state.codes.split('\n')
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return line.length > 0; });
    if (!lines.length) lines = [''];

    var good = [], bad = [];
    lines.forEach(function (line, index) {
      if (!line) return;
      var result = B.encode(state.type, line);
      if (result.ok) {
        result.input = line;
        good.push(result);
      } else {
        bad.push({ line: index + 1, input: line, error: result });
      }
    });
    return { good: good, bad: bad };
  }

  function describeBad(item) {
    var error = item.error || {};
    var message;
    if (error.error === 'wrongLength') message = t('errWrongLength', { want: error.want });
    else if (error.error === 'badChar') message = t('errBadChar', { char: error.at || '?' });
    else if (error.error === 'tooLong') message = t('errTooLong', { max: error.max });
    else if (error.error === 'empty') message = t('errEmpty');
    else message = t('errEmpty');
    return t('linePrefix', { n: item.line }) + ' ' + message;
  }

  /* --------------------------------------------------------------- render */

  var box = document.getElementById('svgbox');
  var caption = document.getElementById('caption');
  var statusEl = document.getElementById('status');
  var buttons = ['btn-svg', 'btn-png', 'btn-zip', 'btn-print'].map(function (id) {
    return document.getElementById(id);
  });

  var current = { good: [], bad: [] };

  function render() {
    var found = analyse();
    current = found;
    var first = found.good[0];

    document.getElementById('hint').textContent = t(HINTS[state.type] || 'hintEan13');

    if (first) {
      var drawing = buildSvg(first, options());
      box.innerHTML = drawing.markup;
      var notes = [];
      (first.notes || []).forEach(function (note) {
        if (note.kind === 'checkFixed') notes.push(t('noteCheck', { from: note.from, to: note.to }));
        if (note.kind === 'upperCased') notes.push(t('noteUpper'));
      });
      caption.textContent = first.name + ' · ' + first.text + ' · ' + drawing.wmm.toFixed(1) + ' x ' + drawing.hmm.toFixed(1) + ' mm' + (notes.length ? ' · ' + notes.join(' ') : '');
    } else {
      box.innerHTML = '';
      caption.textContent = '';
    }

    var lines = [];
    if (found.good.length === 1) lines.push(t('statusOne', { n: 1 }));
    else if (found.good.length > 1) lines.push(t('statusMany', { n: found.good.length }));
    found.bad.slice(0, 3).forEach(function (item) { lines.push(describeBad(item)); });
    statusEl.textContent = lines.join(' · ') || t('errEmpty');
    statusEl.className = 'status' + (found.bad.length ? ' bad' : '');

    var usable = found.good.length > 0;
    buttons.forEach(function (button) { button.disabled = !usable; });
    document.getElementById('btn-zip').disabled = found.good.length < 2;

    store('codes', state.codes);
    store('type', state.type);
  }

  /* -------------------------------------------------------------- exports */

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function safeName(result) {
    return String(result.text).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'barcode';
  }

  function svgFile(result) {
    var drawing = buildSvg(result, options());
    return {
      name: safeName(result) + '.svg',
      text: '<?xml version="1.0" encoding="UTF-8"?>\n' + drawing.markup
    };
  }

  function pngBlob(result, dpi, done) {
    var drawing = buildSvg(result, options());
    var scale = dpi / 25.4;
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(drawing.wmm * scale));
    canvas.height = Math.max(1, Math.round(drawing.hmm * scale));
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';

    // Draw from the module string, not from the svg, so the edges stay crisp.
    var opts = options();
    var pad = (result.quiet || 10) * opts.module;
    var px = opts.module * scale;
    var run = 0;
    for (var i = 0; i <= result.bits.length; i++) {
      if (result.bits.charAt(i) === '1') {
        run++;
      } else if (run) {
        var x = Math.round((pad + (i - run) * opts.module) * scale);
        var w = Math.max(1, Math.round(run * px));
        ctx.fillRect(x, 0, w, Math.round(opts.height * scale));
        run = 0;
      }
    }
    if (opts.showtext) {
      var size = opts.textsize * 0.3528 * scale;
      ctx.font = '600 ' + size + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(result.text, canvas.width / 2, opts.height * scale + size * 0.95);
    }
    canvas.toBlob(function (blob) { done(blob); }, 'image/png');
  }

  document.getElementById('btn-svg').addEventListener('click', function () {
    var result = current.good[0];
    if (!result) return;
    var file = svgFile(result);
    download(new Blob([file.text], { type: 'image/svg+xml' }), file.name);
  });

  document.getElementById('btn-png').addEventListener('click', function () {
    var result = current.good[0];
    if (!result) return;
    pngBlob(result, 300, function (blob) {
      if (blob) download(blob, safeName(result) + '-300dpi.png');
    });
  });

  document.getElementById('btn-zip').addEventListener('click', function () {
    if (current.good.length < 2) return;
    var files = current.good.map(svgFile);
    var blob = zip(files);
    download(blob, 'barcodes-' + current.good.length + '.zip');
  });

  /* ------------------------------------------------------------------ zip */
  // Store only, no compression: svg text is small and deflate would add code.

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  }());

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosTime(date) {
    var time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xFFFF;
    var day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;
    return { time: time, date: day };
  }

  function zip(files) {
    var encoder = new TextEncoder();
    var chunks = [], central = [], offset = 0;
    var stamp = dosTime(new Date());

    files.forEach(function (file) {
      var nameBytes = encoder.encode(file.name);
      var data = encoder.encode(file.text);
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameBytes.length);
      var view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, stamp.time, true);
      view.setUint16(12, stamp.date, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, nameBytes.length, true);
      local.set(nameBytes, 30);

      chunks.push(local, data);

      var dir = new Uint8Array(46 + nameBytes.length);
      var dview = new DataView(dir.buffer);
      dview.setUint32(0, 0x02014b50, true);
      dview.setUint16(4, 20, true);
      dview.setUint16(6, 20, true);
      dview.setUint16(8, 0, true);
      dview.setUint16(10, 0, true);
      dview.setUint16(12, stamp.time, true);
      dview.setUint16(14, stamp.date, true);
      dview.setUint32(16, crc, true);
      dview.setUint32(20, data.length, true);
      dview.setUint32(24, data.length, true);
      dview.setUint16(28, nameBytes.length, true);
      dview.setUint32(42, offset, true);
      dir.set(nameBytes, 46);
      central.push(dir);

      offset += local.length + data.length;
    });

    var centralSize = central.reduce(function (sum, part) { return sum + part.length; }, 0);
    var end = new Uint8Array(22);
    var eview = new DataView(end.buffer);
    eview.setUint32(0, 0x06054b50, true);
    eview.setUint16(8, files.length, true);
    eview.setUint16(10, files.length, true);
    eview.setUint32(12, centralSize, true);
    eview.setUint32(16, offset, true);

    return new Blob(chunks.concat(central, [end]), { type: 'application/zip' });
  }

  /* ---------------------------------------------------------------- print */

  document.getElementById('btn-print').addEventListener('click', function () {
    if (!current.good.length) return;
    var sheet = document.getElementById('sheet');
    var view = document.getElementById('sheetview');
    view.hidden = false;

    var gap = clamp(state.gap, 0, 20);
    var labelW = clamp(state.labelw, 20, 190);
    var labelH = clamp(state.labelh, 12, 120);
    var usable = 190; // A4 width minus the 10 mm margins set in the stylesheet
    var columns = Math.max(1, Math.floor((usable + gap) / (labelW + gap)));

    sheet.style.gridTemplateColumns = 'repeat(' + columns + ', ' + labelW + 'mm)';
    sheet.style.gap = gap + 'mm';

    var inner = Math.max(10, labelW - 4);
    sheet.innerHTML = current.good.map(function (result) {
      var drawing = buildSvg(result, {
        module: clamp(inner / (result.bits.length + (result.quiet || 10) * 2), 0.12, 1.2),
        height: Math.max(5, labelH - 10),
        textsize: clamp(state.textsize * 0.9, 3, 18),
        showtext: true
      });
      return '<div class="label" style="width:' + labelW + 'mm;height:' + labelH + 'mm">' +
        drawing.markup + '</div>';
    }).join('');

    // The dialog opens over the page, so the page itself is shown first: what
    // you are about to print is on screen before the printer is asked.
    view.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setTimeout(function () { window.print(); }, 120);
  });

  /* ----------------------------------------------------------------- wire */

  document.getElementById('types').addEventListener('click', function (event) {
    var chip = event.target.closest('.chip');
    if (!chip) return;
    state.type = chip.getAttribute('data-type');
    document.querySelectorAll('.chip').forEach(function (el) {
      el.classList.toggle('on', el === chip);
    });
    var sample = B.TYPES[state.type].sample;
    if (!state.codes.trim()) {
      state.codes = sample;
      document.getElementById('codes').value = sample;
    }
    render();
  });

  var codes = document.getElementById('codes');
  codes.value = state.codes;
  codes.addEventListener('input', function () {
    state.codes = codes.value;
    render();
  });

  function bindNumber(id, key, min, max) {
    var input = document.getElementById(id);
    input.value = String(state[key]);
    input.addEventListener('input', function () {
      var value = parseFloat(input.value);
      if (!isFinite(value)) return;
      state[key] = clamp(value, min, max);
      store(key, state[key]);
      render();
    });
  }
  bindNumber('module', 'module', 0.15, 1.5);
  bindNumber('height', 'height', 4, 90);
  bindNumber('textsize', 'textsize', 3, 24);
  bindNumber('labelw', 'labelw', 20, 190);
  bindNumber('labelh', 'labelh', 12, 120);
  bindNumber('gap', 'gap', 0, 20);

  var showtext = document.getElementById('showtext');
  showtext.checked = state.showtext;
  showtext.addEventListener('change', function () {
    state.showtext = showtext.checked;
    store('showtext', state.showtext ? '1' : '0');
    render();
  });

  document.getElementById('theme').addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store('theme', next);
  });

  document.getElementById('lang').addEventListener('change', function (event) {
    applyLanguage(event.target.value, true);
  });

  /* ------------------------------------------------------------------ boot */

  var start = load('lang', '');
  if (!start) {
    var guess = (navigator.language || 'en').toLowerCase();
    start = guess.indexOf('ro') === 0 ? 'ro' : (guess.indexOf('sr') === 0 ? 'sr-latn' : 'en');
  }
  applyLanguage(start, false);

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline copy is a bonus */ });
    });
  }
}());
