/**
 * PlanB Wizzard Transliteration Module
 * Converts Latin DICOM patient names to Russian Cyrillic and formats in UPPERCASE (CAPS).
 */

(function (window) {
  // Multi-character sequence mappings (order matters — longer patterns first)
  const MULTI_CHAR_MAP = [
    { en: 'SHCH', ru: 'Щ' },
    { en: 'Shch', ru: 'Щ' },
    { en: 'shch', ru: 'Щ' },

    { en: 'YO', ru: 'Ё' },
    { en: 'Yo', ru: 'Ё' },
    { en: 'yo', ru: 'Ё' },

    { en: 'ZH', ru: 'Ж' },
    { en: 'Zh', ru: 'Ж' },
    { en: 'zh', ru: 'Ж' },

    { en: 'KH', ru: 'Х' },
    { en: 'Kh', ru: 'Х' },
    { en: 'kh', ru: 'Х' },

    { en: 'TS', ru: 'Ц' },
    { en: 'Ts', ru: 'Ц' },
    { en: 'ts', ru: 'Ц' },

    { en: 'CH', ru: 'Ч' },
    { en: 'Ch', ru: 'Ч' },
    { en: 'ch', ru: 'Ч' },

    { en: 'SH', ru: 'Ш' },
    { en: 'Sh', ru: 'Ш' },
    { en: 'sh', ru: 'Ш' },

    { en: 'YU', ru: 'Ю' },
    { en: 'Yu', ru: 'Ю' },
    { en: 'yu', ru: 'Ю' },

    { en: 'YA', ru: 'Я' },
    { en: 'Ya', ru: 'Я' },
    { en: 'ya', ru: 'Я' },

    { en: 'IA', ru: 'ИЯ' },
    { en: 'Ia', ru: 'ИЯ' },
    { en: 'ia', ru: 'ИЯ' },

    { en: 'IY', ru: 'ИЙ' },
    { en: 'Iy', ru: 'ИЙ' },
    { en: 'iy', ru: 'ИЙ' },

    { en: 'EY', ru: 'ЕЙ' },
    { en: 'Ey', ru: 'ЕЙ' },
    { en: 'ey', ru: 'ЕЙ' },

    { en: 'EE', ru: 'И' },
    { en: 'Ee', ru: 'И' },
    { en: 'ee', ru: 'И' }
  ];

  // Single character mappings
  const SINGLE_CHAR_MAP = {
    A: 'А', a: 'А',
    B: 'Б', b: 'Б',
    V: 'В', v: 'В',
    G: 'Г', g: 'Г',
    D: 'Д', d: 'Д',
    E: 'Е', e: 'Е',
    Z: 'З', z: 'З',
    I: 'И', i: 'И',
    J: 'Й', j: 'Й',
    K: 'К', k: 'К',
    L: 'Л', l: 'Л',
    M: 'М', m: 'М',
    N: 'Н', n: 'Н',
    O: 'О', o: 'О',
    P: 'П', p: 'П',
    R: 'Р', r: 'Р',
    S: 'С', s: 'С',
    T: 'Т', t: 'Т',
    U: 'У', u: 'У',
    F: 'Ф', f: 'Ф',
    H: 'Х', h: 'Х',
    C: 'К', c: 'К',
    Y: 'Ы', y: 'Ы',
    X: 'КС', x: 'КС',
    W: 'В', w: 'В',
    Q: 'К', q: 'К'
  };

  /**
   * Transliterates input string from Latin to Cyrillic (Russian) and converts to UPPERCASE.
   * If input is already Cyrillic, simply converts it to UPPERCASE.
   * @param {string} input - Original DICOM name string
   * @returns {string} Transliterated text in UPPERCASE
   */
  function transliterateToRussianUpper(input) {
    if (!input || typeof input !== 'string') return '';
    let result = input.trim();
    if (!result) return '';

    // Check if string contains any Latin characters (A-Z, a-z)
    const hasLatin = /[a-zA-Z]/.test(result);

    if (hasLatin) {
      // 1. Replace multi-character combinations
      for (const pair of MULTI_CHAR_MAP) {
        const regex = new RegExp(pair.en, 'g');
        result = result.replace(regex, pair.ru);
      }

      // 2. Replace single characters
      let temp = '';
      for (let i = 0; i < result.length; i++) {
        const char = result[i];
        temp += SINGLE_CHAR_MAP[char] !== undefined ? SINGLE_CHAR_MAP[char] : char;
      }
      result = temp;
    }

    // 3. Return final result in UPPERCASE
    return result.toUpperCase();
  }

  // Export to global scope
  window.transliterateToRussianUpper = transliterateToRussianUpper;
})(typeof window !== 'undefined' ? window : this);
