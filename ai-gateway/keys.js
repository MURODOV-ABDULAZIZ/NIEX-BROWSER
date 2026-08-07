// ============================================================
// AI GATEWAY — KEY LOADER
// D:\ai apis.txt faylidan barcha kalitlarni o'qiydi va provayderlar bo'yicha ajratadi.
//
// XAVFSIZLIK: Kalitlar FAQAT main process'da (backend) o'qiladi.
//   Hech qachon renderer/browser'ga uzatilmaydi.
//
// Format tolerant: fayl formati o'zgarsa ham prefiks bo'yicha aniqlaydi:
//   Gemini      → "AQ." yoki "AIza" bilan boshlanadi
//   OpenRouter  → "sk-or-" bilan boshlanadi
//   Groq        → "gsk_" bilan boshlanadi
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

// Kalit fayl manzillari (birinchi topilgani ishlatiladi)
const KEY_FILE_CANDIDATES = [
  'D:\\ai apis.txt',
  path.join(__dirname, '..', 'ai apis.txt'),
  path.join(__dirname, 'keys.txt'),
];

function classify(line) {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith('AQ.') || t.startsWith('AIza')) return 'gemini';
  if (t.startsWith('sk-or-')) return 'openrouter';
  if (t.startsWith('gsk_')) return 'groq';
  return null;
}

/**
 * Barcha kalitlarni yuklaydi.
 * @returns {{ gemini: string[], openrouter: string[], groq: string[], file: string|null }}
 */
function loadKeys() {
  const out = { gemini: [], openrouter: [], groq: [], file: null };

  let raw = '';
  for (const p of KEY_FILE_CANDIDATES) {
    try {
      if (fs.existsSync(p)) {
        raw = fs.readFileSync(p, 'utf8');
        out.file = p;
        break;
      }
    } catch { /* keyingisini sinash */ }
  }

  if (!raw) return out;

  for (const line of raw.split(/\r?\n/)) {
    const kind = classify(line);
    if (kind) {
      const key = line.trim();
      if (!out[kind].includes(key)) out[kind].push(key);
    }
  }

  return out;
}

module.exports = { loadKeys };
