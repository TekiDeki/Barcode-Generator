/* Barcode Generator - TekiDeki
 * SPDX-License-Identifier: Apache-2.0
 *
 * The encoders. Every function here turns a typed value into one string of
 * modules: 1 is a bar, 0 is a space. Nothing draws, nothing touches the page,
 * so the whole file can be tested in Node without a browser.
 *
 * Six symbologies, chosen because they cover what people actually print:
 * EAN-13 and UPC-A for retail units, EAN-8 for small packages, ITF-14 for
 * cartons, Code 128 for shipping and assets, Code 39 for labels that must stay
 * readable when a printer smears them.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Barcode = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- tables */

  // EAN and UPC: seven modules per digit, three alphabets.
  var L = ['0001101', '0011001', '0010011', '0111101', '0100011',
           '0110001', '0101111', '0111011', '0110111', '0001011'];
  var R = L.map(function (s) {
    return s.replace(/0/g, 'x').replace(/1/g, '0').replace(/x/g, '1');
  });
  var G = R.map(function (s) { return s.split('').reverse().join(''); });

  // Which half of an EAN-13 uses the G alphabet, by the leading digit.
  var PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
                'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

  // Code 128: element widths, bars and spaces alternating, starting with a bar.
  // Values 0 to 102 are the data symbols, 103 to 105 the three start codes,
  // 106 is the stop pattern and is two modules longer than the rest.
  var C128 = ['212222', '222122', '222221', '121223', '121322', '131222',
    '122213', '122312', '132212', '221213', '221312', '231212', '112232',
    '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221',
    '312212', '322112', '322211', '212123', '212321', '232121', '111323',
    '131123', '131321', '112313', '132113', '132311', '211313', '231113',
    '231311', '112133', '112331', '132131', '113123', '113321', '133121',
    '313121', '211331', '231131', '213113', '213311', '213131', '311123',
    '311321', '331121', '312113', '312311', '332111', '314111', '221411',
    '431111', '111224', '111422', '121124', '121421', '141122', '141221',
    '112214', '112412', '122114', '122411', '142112', '142211', '241211',
    '221114', '413111', '241112', '134111', '111242', '121142', '121241',
    '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311',
    '411113', '411311', '113141', '114131', '311141', '411131', '211412',
    '211214', '211232', '2331112'];

  var START_A = 103, START_B = 104, START_C = 105, STOP = 106;

  // Code 39: nine elements per character, three of them wide.
  var C39 = {
    '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
    '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
    '8': '100100100', '9': '001100100', 'A': '100001001', 'B': '001001001',
    'C': '101001000', 'D': '000011001', 'E': '100011000', 'F': '001011000',
    'G': '000001101', 'H': '100001100', 'I': '001001100', 'J': '000011100',
    'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011',
    'O': '100010010', 'P': '001010010', 'Q': '000000111', 'R': '100000110',
    'S': '001000110', 'T': '000010110', 'U': '110000001', 'V': '011000001',
    'W': '111000000', 'X': '010010001', 'Y': '110010000', 'Z': '011010000',
    '-': '010000101', '.': '110000100', ' ': '011000100', '$': '010101000',
    '/': '010100010', '+': '010001010', '%': '000101010', '*': '010010100'
  };

  // Interleaved 2 of 5: five elements per digit, two of them wide.
  var ITF = ['00110', '10001', '01001', '11000', '00101',
             '10100', '01100', '00011', '10010', '01010'];

  /* ------------------------------------------------------------- helpers */

  function modules(widths, wide) {
    // Turn a list of 0/1 flags into modules, alternating bar and space.
    var out = '';
    for (var i = 0; i < widths.length; i++) {
      out += (i % 2 === 0 ? '1' : '0').repeat(widths[i] ? wide : 1);
    }
    return out;
  }

  function widths(str) {
    // Turn a width pattern such as "212222" into modules, bar first.
    var out = '', bar = '1';
    for (var i = 0; i < str.length; i++) {
      out += bar.repeat(+str.charAt(i));
      bar = bar === '1' ? '0' : '1';
    }
    return out;
  }

  function digitsOnly(raw) {
    return String(raw == null ? '' : raw).replace(/[\s-]/g, '');
  }

  function checkDigit(body) {
    // Modulo 10, weights 3 and 1 from the right. Same rule for EAN, UPC, GTIN.
    var sum = 0, weight = 3;
    for (var i = body.length - 1; i >= 0; i--) {
      sum += (+body.charAt(i)) * weight;
      weight = weight === 3 ? 1 : 3;
    }
    return (10 - (sum % 10)) % 10;
  }

  /* ---------------------------------------------------------- symbologies */

  function ean13(raw) {
    var v = digitsOnly(raw);
    if (!/^\d{12,13}$/.test(v)) {
      return { ok: false, error: 'wrongLength', want: 13 };
    }
    var body = v.slice(0, 12);
    var check = checkDigit(body);
    var notes = [];
    if (v.length === 13 && +v.charAt(12) !== check) {
      notes.push({ kind: 'checkFixed', from: v.charAt(12), to: String(check) });
      v = body + check;
    } else if (v.length === 12) {
      v = body + check;
    }
    var parity = PARITY[+v.charAt(0)];
    var bits = '101';
    for (var i = 0; i < 6; i++) {
      var d = +v.charAt(i + 1);
      bits += parity.charAt(i) === 'L' ? L[d] : G[d];
    }
    bits += '01010';
    for (var j = 0; j < 6; j++) bits += R[+v.charAt(j + 7)];
    bits += '101';
    return { ok: true, bits: bits, text: v, value: v, notes: notes };
  }

  function ean8(raw) {
    var v = digitsOnly(raw);
    if (!/^\d{7,8}$/.test(v)) return { ok: false, error: 'wrongLength', want: 8 };
    var body = v.slice(0, 7);
    var check = checkDigit(body);
    var notes = [];
    if (v.length === 8 && +v.charAt(7) !== check) {
      notes.push({ kind: 'checkFixed', from: v.charAt(7), to: String(check) });
      v = body + check;
    } else if (v.length === 7) {
      v = body + check;
    }
    var bits = '101';
    for (var i = 0; i < 4; i++) bits += L[+v.charAt(i)];
    bits += '01010';
    for (var j = 0; j < 4; j++) bits += R[+v.charAt(j + 4)];
    bits += '101';
    return { ok: true, bits: bits, text: v, value: v, notes: notes };
  }

  function upca(raw) {
    var v = digitsOnly(raw);
    if (!/^\d{11,12}$/.test(v)) return { ok: false, error: 'wrongLength', want: 12 };
    var body = v.slice(0, 11);
    var check = checkDigit(body);
    var notes = [];
    if (v.length === 12 && +v.charAt(11) !== check) {
      notes.push({ kind: 'checkFixed', from: v.charAt(11), to: String(check) });
      v = body + check;
    } else if (v.length === 11) {
      v = body + check;
    }
    var bits = '101';
    for (var i = 0; i < 6; i++) bits += L[+v.charAt(i)];
    bits += '01010';
    for (var j = 0; j < 6; j++) bits += R[+v.charAt(j + 6)];
    bits += '101';
    return { ok: true, bits: bits, text: v, value: v, notes: notes };
  }

  function code128(raw) {
    var v = String(raw == null ? '' : raw);
    if (!v.length) return { ok: false, error: 'empty' };
    if (v.length > 48) return { ok: false, error: 'tooLong', max: 48 };

    var values = [], start, i;
    var numeric = /^\d+$/.test(v) && v.length % 2 === 0 && v.length >= 2;

    if (numeric) {
      start = START_C;
      for (i = 0; i < v.length; i += 2) values.push(+v.substr(i, 2));
    } else {
      start = START_B;
      for (i = 0; i < v.length; i++) {
        var code = v.charCodeAt(i);
        if (code < 32 || code > 126) return { ok: false, error: 'badChar', at: v.charAt(i) };
        values.push(code - 32);
      }
    }

    var sum = start;
    for (i = 0; i < values.length; i++) sum += values[i] * (i + 1);
    var check = sum % 103;

    var bits = widths(C128[start]);
    for (i = 0; i < values.length; i++) bits += widths(C128[values[i]]);
    bits += widths(C128[check]);
    bits += widths(C128[STOP]);

    return { ok: true, bits: bits, text: v, value: v, notes: [], checksum: check };
  }

  function code39(raw) {
    var v = String(raw == null ? '' : raw).toUpperCase();
    if (!v.length) return { ok: false, error: 'empty' };
    if (v.length > 40) return { ok: false, error: 'tooLong', max: 40 };
    for (var i = 0; i < v.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(C39, v.charAt(i)) || v.charAt(i) === '*') {
        return { ok: false, error: 'badChar', at: v.charAt(i) };
      }
    }
    var notes = [];
    if (String(raw) !== v) notes.push({ kind: 'upperCased' });

    var bits = '';
    var chars = '*' + v + '*';
    for (var j = 0; j < chars.length; j++) {
      bits += modules(C39[chars.charAt(j)].split('').map(Number), 3) + '0';
    }
    return { ok: true, bits: bits.slice(0, -1), text: v, value: v, notes: notes };
  }

  function itf14(raw) {
    var v = digitsOnly(raw);
    if (!/^\d{13,14}$/.test(v)) return { ok: false, error: 'wrongLength', want: 14 };
    var body = v.slice(0, 13);
    var check = checkDigit(body);
    var notes = [];
    if (v.length === 14 && +v.charAt(13) !== check) {
      notes.push({ kind: 'checkFixed', from: v.charAt(13), to: String(check) });
      v = body + check;
    } else if (v.length === 13) {
      v = body + check;
    }
    var bits = '1010';
    for (var i = 0; i < v.length; i += 2) {
      var a = ITF[+v.charAt(i)], b = ITF[+v.charAt(i + 1)];
      for (var k = 0; k < 5; k++) {
        bits += (a.charAt(k) === '1' ? '111' : '1');
        bits += (b.charAt(k) === '1' ? '000' : '0');
      }
    }
    bits += '11101';
    return { ok: true, bits: bits, text: v, value: v, notes: notes };
  }

  var TYPES = {
    ean13: { encode: ean13, name: 'EAN-13', digits: 13, quiet: 11, sample: '4006381333931' },
    ean8: { encode: ean8, name: 'EAN-8', digits: 8, quiet: 10, sample: '96385074' },
    upca: { encode: upca, name: 'UPC-A', digits: 12, quiet: 9, sample: '012345678905' },
    code128: { encode: code128, name: 'Code 128', quiet: 10, sample: 'SHIP-2026-0042' },
    code39: { encode: code39, name: 'Code 39', quiet: 10, sample: 'ASSET 0042' },
    itf14: { encode: itf14, name: 'ITF-14', digits: 14, quiet: 10, sample: '15400141234562' }
  };

  function encode(type, raw) {
    var spec = TYPES[type];
    if (!spec) return { ok: false, error: 'unknownType' };
    var result = spec.encode(raw);
    if (result.ok) {
      result.type = type;
      result.name = spec.name;
      result.quiet = spec.quiet;
      result.digits = spec.digits || null;
    }
    return result;
  }

  return {
    TYPES: TYPES,
    list: Object.keys(TYPES),
    encode: encode,
    checkDigit: checkDigit,
    digitsOnly: digitsOnly
  };
}));
