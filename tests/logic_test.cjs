/* Barcode Generator - logic tests.
 * The golden strings below were produced by JsBarcode 3.12.1, an independent
 * MIT implementation, and then frozen here. If our encoder drifts, this fails.
 * Run: node tests/logic_test.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const B = require(path.join(__dirname, '..', 'src', 'barcode.js'));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    console.error('FAIL: ' + name);
    console.error('  ' + error.message);
    process.exitCode = 1;
  }
}

const GOLDEN = {
  ean13: ['4006381333931', '10100011010100111010111101111010001001011001101010100001010000101000010111010010000101100110101'],
  ean8: ['96385074', '1010001011010111101111010110111010101001110111001010001001011100101'],
  upca: ['012345678905', '10100011010011001001001101111010100011011000101010101000010001001001000111010011100101001110101'],
  code128: ['SHIP-2026-0042', '110100100001101110100011000101000110001000101110111011010011011100110011100101001110110011001110010110011101001001101110010011101100100111011001100100111011001110010111010011001100011101011'],
  code39: ['ASSET 0042', '10001011101110101110101000101110101110101110001010111010111000101110101110001010101011101110001010001110101110101010001110111010101000111011101010100011101011101011100010101110100010111011101'],
  itf14: ['15400141234562', '101011100010100010111010101110001000111010001011101110100010001011101011100010001110001010111010001011100010111010111000111010100011101']
};

for (const type of Object.keys(GOLDEN)) {
  const [value, expected] = GOLDEN[type];
  test('golden ' + type, () => {
    const result = B.encode(type, value);
    assert.ok(result.ok, 'encoder refused a valid value');
    assert.strictEqual(result.bits, expected);
    assert.strictEqual(result.text, value);
  });
}

test('EAN-13 length is 95 modules', () => {
  assert.strictEqual(B.encode('ean13', '4006381333931').bits.length, 95);
});
test('EAN-8 length is 67 modules', () => {
  assert.strictEqual(B.encode('ean8', '96385074').bits.length, 67);
});
test('UPC-A length is 95 modules', () => {
  assert.strictEqual(B.encode('upca', '012345678905').bits.length, 95);
});
test('ITF-14 length is 135 modules', () => {
  assert.strictEqual(B.encode('itf14', '15400141234562').bits.length, 135);
});
test('Code 128 grows by 11 modules per symbol plus 13 for the stop', () => {
  const bits = B.encode('code128', 'ABC').bits.length;
  assert.strictEqual(bits, 11 * 5 + 13); // start, three symbols, checksum, stop
});

test('a 12 digit EAN gets the check digit 1', () => {
  const result = B.encode('ean13', '400638133393');
  assert.ok(result.ok);
  assert.strictEqual(result.text, '4006381333931');
  assert.strictEqual(result.notes.length, 0);
});
test('a 7 digit EAN-8 gets the check digit 4', () => {
  assert.strictEqual(B.encode('ean8', '9638507').text, '96385074');
});
test('an 11 digit UPC gets the check digit 5', () => {
  assert.strictEqual(B.encode('upca', '01234567890').text, '012345678905');
});
test('a 13 digit ITF-14 gets its check digit', () => {
  assert.strictEqual(B.encode('itf14', '1540014123456').text, '15400141234562');
});

test('a wrong check digit is corrected and reported', () => {
  const result = B.encode('ean13', '4006381333930');
  assert.ok(result.ok);
  assert.strictEqual(result.text, '4006381333931');
  assert.strictEqual(result.notes[0].kind, 'checkFixed');
  assert.strictEqual(result.notes[0].from, '0');
  assert.strictEqual(result.notes[0].to, '1');
});

test('check digit is the same for the whole GTIN family', () => {
  assert.strictEqual(B.checkDigit('400638133393'), 1);
  assert.strictEqual(B.checkDigit('9638507'), 4);
  assert.strictEqual(B.checkDigit('01234567890'), 5);
  assert.strictEqual(B.checkDigit('1540014123456'), 2);
});

test('spaces and dashes in a number are ignored', () => {
  assert.strictEqual(B.encode('ean13', '400 6381 333931').text, '4006381333931');
});

test('short and long inputs are refused with a reason', () => {
  assert.strictEqual(B.encode('ean13', '123').error, 'wrongLength');
  assert.strictEqual(B.encode('ean13', '12345678901234').error, 'wrongLength');
  assert.strictEqual(B.encode('itf14', '1234').error, 'wrongLength');
});

test('Code 39 refuses lower case letters by upper casing them', () => {
  const result = B.encode('code39', 'asset 42');
  assert.ok(result.ok);
  assert.strictEqual(result.text, 'ASSET 42');
  assert.strictEqual(result.notes[0].kind, 'upperCased');
});

test('Code 39 refuses characters outside its alphabet', () => {
  assert.strictEqual(B.encode('code39', 'AB#C').error, 'badChar');
  assert.strictEqual(B.encode('code39', 'A*B').error, 'badChar');
});

test('Code 128 packs numbers two at a time', () => {
  const numeric = B.encode('code128', '123456');
  const letters = B.encode('code128', 'ABCDEF');
  assert.strictEqual(numeric.bits.length, 11 * 5 + 13);  // start, three pairs, checksum
  assert.strictEqual(letters.bits.length, 11 * 8 + 13);  // start, six letters, checksum
});

test('Code 128 refuses control characters', () => {
  assert.strictEqual(B.encode('code128', 'a\nb').error, 'badChar');
});

test('an unknown type is refused', () => {
  assert.strictEqual(B.encode('ean99', '1').error, 'unknownType');
});

test('every type has a sample that encodes', () => {
  B.list.forEach((type) => {
    const spec = B.TYPES[type];
    const result = B.encode(type, spec.sample);
    assert.ok(result.ok, type + ' sample does not encode: ' + JSON.stringify(result));
  });
});

/* Locales: the three authored blocks must agree before the build runs. */
const localesPath = path.join(__dirname, '..', 'src', 'i18n', 'locales.json');
const locales = JSON.parse(fs.readFileSync(localesPath, 'utf8'));

test('three authored locales, same keys', () => {
  const keys = Object.keys(locales.en).sort();
  ['ro', 'sr-latn'].forEach((locale) => {
    assert.deepStrictEqual(Object.keys(locales[locale]).sort(), keys, locale + ' keys differ');
  });
});

test('no em dash, en dash or no-break space in any string', () => {
  Object.keys(locales).forEach((locale) => {
    Object.keys(locales[locale]).forEach((key) => {
      const value = locales[locale][key];
      assert.ok(!/[\u2013\u2014\u00a0]/.test(value), locale + '.' + key + ' has a forbidden character');
    });
  });
});

test('placeholders match across locales', () => {
  Object.keys(locales.en).forEach((key) => {
    const expected = (locales.en[key].match(/\{[a-z]+\}/gi) || []).sort();
    ['ro', 'sr-latn'].forEach((locale) => {
      const actual = (locales[locale][key].match(/\{[a-z]+\}/gi) || []).sort();
      assert.deepStrictEqual(actual, expected, key + ' in ' + locale);
    });
  });
});

test('every hint key exists in the locales', () => {
  ['hintEan13', 'hintEan8', 'hintUpca', 'hintCode128', 'hintCode39', 'hintItf14'].forEach((key) => {
    assert.ok(locales.en[key], 'missing ' + key);
  });
});

if (!process.exitCode) console.log('PASS: ' + passed + ' logic checks, six symbologies and three locales');
