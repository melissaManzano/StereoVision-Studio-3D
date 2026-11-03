/**
 * Emparejado automático de archivos de una carpeta por nombre:
 *  1. Sufijos explícitos: foto_L / foto_R, foto-left / foto-right, foto_izq / foto_der, fotoL / fotoR.
 *  2. Archivos que ya contienen el par: .mpo, o nombres con "sbs", "lado", "3d".
 *  3. Numeración consecutiva de cámara (IMG_0101, IMG_0102): se emparejan de dos en dos
 *     dentro de cada prefijo, en orden.
 * Lo que no encaja se informa como "sin pareja".
 *
 * @param {string[]} names
 * @returns {{ pairs: Array<{name: string, left?: number, right?: number, single?: number}>, unpaired: number[] }}
 */
const SIDE = /^(.*?)[\s._-]*(l|left|izq|izquierda|r|right|der|derecha)$/i;
const SINGLE = /(\.mpo$)|(^|[\s._-])(sbs|lado|3d|stereo|estereo)([\s._-]|$)/i;
const NUMBERED = /^(.*?)(\d+)$/;

const stem = (n) => n.replace(/\.[^.]+$/, '');
const isLeft = (s) => /^(l|left|izq|izquierda)$/i.test(s);

export function pairFiles(names) {
  const pairs = [];
  const used = new Set();

  names.forEach((n, i) => {
    if (SINGLE.test(n)) {
      pairs.push({ name: stem(n), single: i });
      used.add(i);
    }
  });

  const bySide = new Map();
  names.forEach((n, i) => {
    if (used.has(i)) return;
    const m = stem(n).match(SIDE);
    if (!m || !m[1]) return;
    const key = m[1].toLowerCase();
    const entry = bySide.get(key) ?? {};
    entry[isLeft(m[2]) ? 'left' : 'right'] = i;
    entry.name = m[1];
    bySide.set(key, entry);
  });
  for (const entry of bySide.values()) {
    if (entry.left !== undefined && entry.right !== undefined) {
      pairs.push({ name: entry.name, left: entry.left, right: entry.right });
      used.add(entry.left);
      used.add(entry.right);
    }
  }

  const groups = new Map();
  names.forEach((n, i) => {
    if (used.has(i)) return;
    const m = stem(n).match(NUMBERED);
    if (!m) return;
    const key = m[1].toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ i, num: Number(m[2]) });
  });
  for (const list of groups.values()) {
    list.sort((a, b) => a.num - b.num);
    for (let k = 0; k + 1 < list.length; k += 2) {
      if (list[k + 1].num !== list[k].num + 1) { k -= 1; continue; } // salto en la numeración
      pairs.push({ name: `${stem(names[list[k].i])}+${list[k + 1].num}`, left: list[k].i, right: list[k + 1].i });
      used.add(list[k].i);
      used.add(list[k + 1].i);
    }
  }

  const unpaired = names.map((_, i) => i).filter((i) => !used.has(i));
  pairs.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  return { pairs, unpaired };
}
