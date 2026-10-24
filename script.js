/**
 * ============================================================================
 * AVR ATmega328P Web Simulator Core & Studio UI
 * Тема 5: Внешние прерывания (INT0, INT1, PCINT0..PCINT2)
 * ВЕРСИЯ: рабочая (исправлены C→ASM транслятор, парсер ISR, while-цикл)
 * ============================================================================
 */

import React, { useState, useEffect, useRef, useCallback } from 'https://esm.sh/react@18.2.0';
import { createRoot } from 'https://esm.sh/react-dom@18.2.0/client';
import * as LucideIcons from 'https://esm.sh/lucide-react@0.294.0';

const {
  Play, Pause, SkipForward, RotateCcw, Download,
  Settings2, Activity: ActivityIcon, Maximize2, X, Terminal,
  Lightbulb, LayoutGrid, Trash2, Plus, Wrench, ZoomIn, ZoomOut
} = LucideIcons;

/* ============================================================================
 * БЛОК 1: Карта регистров ATmega328P (RAM / IO Space)
 * ============================================================================ */
const REG = {
  PINB: 0x23, DDRB: 0x24, PORTB: 0x25,
  PINC: 0x26, DDRC: 0x27, PORTC: 0x28,
  PIND: 0x29, DDRD: 0x2A, PORTD: 0x2B,
  EIFR: 0x3C, EIMSK: 0x3D, EICRA: 0x69,
  PCIFR: 0x3B, PCICR: 0x68,
  PCMSK0: 0x6B, PCMSK1: 0x6C, PCMSK2: 0x6D,
  MCUCR: 0x55,
  SPL: 0x5D, SPH: 0x5E, SREG: 0x5F,
  UCSR0A: 0xC0, UCSR0B: 0xC1, UCSR0C: 0xC2,
  UBRR0L: 0xC4, UBRR0H: 0xC5, UDR0: 0xC6
};

/* ============================================================================
 * БЛОК 2: Векторы прерываний
 * ============================================================================ */
const VECTORS = {
  RESET: 0x0000,
  INT0: 0x0002, INT1: 0x0004,
  PCINT0: 0x0006, PCINT1: 0x0008, PCINT2: 0x000A,
  TIMER2_COMPA: 0x000E, TIMER2_COMPB: 0x0010, TIMER2_OVF: 0x0012,
  TIMER1_COMPA: 0x0016, TIMER1_OVF: 0x001A,
  TIMER0_COMPA: 0x001C, TIMER0_OVF: 0x0020,
  USART_RX: 0x0024, USART_UDRE: 0x0026, USART_TX: 0x0028
};

const INITIAL_BUTTONS = [
  { id: 'K1', port: 'D', pin: 2, pressed: false },
  { id: 'K2', port: 'D', pin: 3, pressed: false },
  { id: 'K3', port: 'D', pin: 4, pressed: false },
  { id: 'K4', port: 'B', pin: 0, pressed: false },
  { id: 'K5', port: 'B', pin: 1, pressed: false },
  { id: 'K6', port: 'B', pin: 2, pressed: false },
  { id: 'K7', port: 'B', pin: 3, pressed: false },
  { id: 'K8', port: 'B', pin: 4, pressed: false }
];

const ALL_PINS = [
  'PB5','PB0','PB1','PB2','PB3','PB4','PB6','PB7',
  'PD0','PD1','PD2','PD3','PD4','PD5','PD6','PD7',
  'PC0','PC1','PC2','PC3','PC4','PC5','PC6'
];

const PIN_NAMES = {
  PB5: 'PB5 (D13 / LED L / SCK)',
  PB0: 'PB0 (D8 / K4 / PCINT0)',
  PB1: 'PB1 (D9 / K5 / PCINT1)',
  PB2: 'PB2 (D10 / K6 / PCINT2)',
  PB3: 'PB3 (D11 / K7 / PCINT3)',
  PB4: 'PB4 (D12 / K8 / PCINT4)',
  PB6: 'PB6 (XTAL1)', PB7: 'PB7 (XTAL2)',
  PD0: 'PD0 (D0 / RX / LED 0 / PCINT16)',
  PD1: 'PD1 (D1 / TX / LED 1 / PCINT17)',
  PD2: 'PD2 (D2 / K1 / INT0 / PCINT18)',
  PD3: 'PD3 (D3 / K2 / INT1 / PCINT19)',
  PD4: 'PD4 (D4 / K3 / PCINT20)',
  PD5: 'PD5 (D5 / LED 5 / PCINT21)',
  PD6: 'PD6 (D6 / LED 6 / PCINT22)',
  PD7: 'PD7 (D7 / LED 7 / PCINT23)',
  PC0: 'PC0 (A0 / PCINT8)', PC1: 'PC1 (A1 / PCINT9)',
  PC2: 'PC2 (A2 / PCINT10)', PC3: 'PC3 (A3 / PCINT11)',
  PC4: 'PC4 (A4 / SDA / PCINT12)', PC5: 'PC5 (A5 / SCL / PCINT13)',
  PC6: 'PC6 (RESET)'
};

/* ============================================================================
 * БЛОК 3: Примеры программ
 * ============================================================================ */
const EXAMPLES = {
  ex1_asm: {
    id: 'ex1_asm',
    name: '📌 Пример 1 (ASM): INT1 по низкому уровню',
    lang: 'asm',
    hint: 'Прерывание INT1 (K2 / PD3) по <b>низкому уровню</b>. Пока кнопка НЕ нажата (PD3=1), основная программа крутит PORTC++. При нажатии (PD3=0) срабатывает ISR и сбрасывает PORTC=0. Отпустите кнопку, чтобы увидеть рост счётчика.',
    code: `; Пример 1: Внешнее прерывание INT1 по низкому уровню
.include "m328pdef.inc"
.org 0x0000
    jmp Reset
.org 0x0004
    jmp Int_1

Reset:
    ldi r16, High(RAMEND)
    out sph, r16
    ldi r16, Low(RAMEND)
    out spl, r16

    ldi r16, 0x00
    sts EICRA, r16

    ldi r16, 0x02
    out EIMSK, r16

    cbi DDRD, 3
    sbi PORTD, 3

    ldi r16, 0xFF
    out DDRC, r16

    sei

main:
    inc r17
    out PORTC, r17
    jmp main

Int_1:
    ldi r17, 0x00
    out PORTC, r17
    reti`
  },

  zadanie1_c: {
    id: 'zadanie1_c',
    name: '⚡ Задание 1 (Си): Переключение LED (PD0/PD1) по INT0',
    lang: 'c',
    hint: 'Нажатие K1 (PD2 / INT0) по <b>фронту</b> переключает два светодиода. Кнопка нажата → PD2=0. Фронт = отпускание кнопки (0→1). Нажмите и отпустите K1.',
    code: `// Задание 1: INT0 по фронту, переключение PD0/PD1
#include <avr/io.h>
#include <avr/interrupt.h>

ISR(INT0_vect)
{
    PORTD ^= 0x03;
}

int main(void)
{
    DDRD |= 0x03;
    DDRD &= ~0x04;
    PORTD |= 0x04;
    PORTD |= 0x01;
    PORTD &= ~0x02;
    EICRA |= 0x03;
    EIMSK |= 0x01;
    sei();
    while (1)
    {
    }
}`
  },

  zadanie2_asm: {
    id: 'zadanie2_asm',
    name: '⚡ Задание 2 (ASM): Приоритеты INT0 и INT1',
    lang: 'asm',
    hint: 'INT0 имеет более высокий приоритет, чем INT1. K1 (PD2) переключает PD0, K2 (PD3) — PD1. Триггер — отпускание кнопки (фронт 0→1).',
    code: `; Задание 2: INT0 и INT1 по фронту
.include "m328pdef.inc"
.org 0x0000
    jmp Reset
.org 0x0002
    jmp Isr_Int0
.org 0x0004
    jmp Isr_Int1

Reset:
    ldi r16, High(RAMEND)
    out sph, r16
    ldi r16, Low(RAMEND)
    out spl, r16

    sbi DDRD, 0
    sbi DDRD, 1
    cbi DDRD, 2
    sbi PORTD, 2
    cbi DDRD, 3
    sbi PORTD, 3

    ldi r16, 0x0F
    sts EICRA, r16
    ldi r16, 0x03
    out EIMSK, r16
    sei

main:
    rjmp main

Isr_Int0:
    in r16, PORTD
    ldi r17, 0x01
    eor r16, r17
    out PORTD, r16
    reti

Isr_Int1:
    in r16, PORTD
    ldi r17, 0x02
    eor r16, r17
    out PORTD, r16
    reti`
  },

  ex2_pcint_c: {
    id: 'ex2_pcint_c',
    name: '📌 Пример 2 (Си): PCINT0 и PCINT2, счётчик на PORTC',
    lang: 'c',
    hint: 'Нажатие K4..K8 (PB0..PB4) даёт +1 к счётчику на PORTC. Нажатие K1/K3 (PD2/PD4) даёт +10. PCINT срабатывает и по нажатию, и по отпусканию — итого +2 за клик.',
    code: `// Пример 2: PCINT0 и PCINT2, счётчик на PORTC
#include <avr/io.h>
#include <avr/interrupt.h>

volatile char count;

ISR(PCINT0_vect)
{
    count++;
}

ISR(PCINT2_vect)
{
    count += 10;
}

int main(void)
{
    DDRC = 0xFF;
    PCICR |= 0x05;
    PCMSK0 = 0x1F;
    PCMSK2 = 0x1C;
    sei();
    while (1)
    {
        PORTC = count;
    }
}`
  },

  zadanie3_c: {
    id: 'zadanie3_c',
    name: '⚡ Задание 3 (Си): LED L (PB5) переключается по PCINT2',
    lang: 'c',
    hint: 'Нажатие K1 (PD2 / PCINT18) переключает светодиод L (PB5). PCINT срабатывает и по нажатию, и по отпусканию.',
    code: `// Задание 3: переключение LED L по PCINT2 (PD2)
#include <avr/io.h>
#include <avr/interrupt.h>

ISR(PCINT2_vect)
{
    PORTB ^= 0x20;
}

int main(void)
{
    DDRB |= 0x20;
    DDRD &= ~0x04;
    PORTD |= 0x04;
    PCICR |= 0x04;
    PCMSK2 |= 0x04;
    sei();
    while (1)
    {
    }
}`
  },

  zadanie3_c_adv: {
    id: 'zadanie3_c_adv',
    name: '⚡ Задание 3+ (Си): старший бит count на LED L',
    lang: 'c',
    hint: 'Счётчик count инкрементируется в основном цикле. По PCINT2 (PD2) старший бит count (бит 7) выводится на PB5. При быстром счётчике мигание будет заметно при нажатии K1.',
    code: `// Задание 3+: старший бит count на PB5 по PCINT2
#include <avr/io.h>
#include <avr/interrupt.h>

volatile char count;

ISR(PCINT2_vect)
{
    if (count & 0x80)
        PORTB |= 0x20;
    else
        PORTB &= ~0x20;
}

int main(void)
{
    DDRB |= 0x20;
    DDRD &= ~0x04;
    PORTD |= 0x04;
    PCICR |= 0x04;
    PCMSK2 |= 0x04;
    sei();
    while (1)
    {
        count++;
    }
}`
  }
};

/* ============================================================================
 * БЛОК 4: Утилиты
 * ============================================================================ */

function parseReg(s) {
  if (!s) return 0;
  s = s.trim().toLowerCase();
  const alias = { xl: 26, xh: 27, yl: 28, yh: 29, zl: 30, zh: 31 };
  if (alias[s] !== undefined) return alias[s];
  const num = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return Math.min(31, Math.max(0, isNaN(num) ? 0 : num));
}

function parseVal(s, labels = {}) {
  if (!s) return 0;
  s = s.trim();
  const lower = s.toLowerCase();
  if (labels[lower] !== undefined) return labels[lower];

  if (lower === 'ramend') return 2303;
  if (lower.includes('low(ramend)')) return 0xFF;
  if (lower.includes('high(ramend)')) return 0x08;

  const upper = s.toUpperCase();
  if (REG[upper] !== undefined) {
    return REG[upper] >= 0x20 && REG[upper] <= 0x5F ? REG[upper] - 0x20 : REG[upper];
  }

  const bits = {
    ISC00: 0, ISC01: 1, ISC10: 2, ISC11: 3,
    INT0: 0, INT1: 1,
    PCIE0: 0, PCIE1: 1, PCIE2: 2,
    PCINT0: 0, PCINT1: 1, PCINT2: 2, PCINT3: 3, PCINT4: 4, PCINT5: 5,
    PCINT16: 0, PCINT17: 1, PCINT18: 2, PCINT19: 3, PCINT20: 4,
    DDD0: 0, DDD1: 1, DDD2: 2, DDD3: 3, DDD4: 4, DDD5: 5,
    DDB0: 0, DDB1: 1, DDB2: 2, DDB3: 3, DDB4: 4, DDB5: 5,
    PORTD0: 0, PORTD1: 1, PORTD2: 2, PORTD3: 3, PORTD4: 4,
    PORTB0: 0, PORTB1: 1, PORTB2: 2, PORTB5: 5
  };
  if (bits[upper] !== undefined) return bits[upper];

  if (s.startsWith('$')) return parseInt(s.substring(1), 16) || 0;
  if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s.substring(2), 16) || 0;
  if (s.startsWith('0b') || s.startsWith('0B')) return parseInt(s.substring(2), 2) || 0;
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

function ioToMemAddr(ioAddr) {
  if (typeof ioAddr === 'string') {
    const up = ioAddr.trim().toUpperCase();
    if (REG[up] !== undefined) return REG[up];
    const val = parseVal(ioAddr);
    return val < 0x40 ? val + 0x20 : val;
  }
  return ioAddr < 0x40 ? ioAddr + 0x20 : ioAddr;
}

function memRead(cpu, addr) {
  if (addr < 32) return cpu.r[addr];
  if (addr < cpu.ram.length) return cpu.ram[addr];
  return 0;
}

function memWrite(cpu, addr, val) {
  val &= 0xFF;
  if (addr >= 0 && addr < cpu.ram.length) {
    cpu.ram[addr] = val;
    if (addr < 32) cpu.r[addr] = val;
    if (addr === REG.SPL) cpu.sp = (cpu.sp & 0xFF00) | val;
    else if (addr === REG.SPH) cpu.sp = (cpu.sp & 0x00FF) | (val << 8);
    else if (addr === REG.UDR0) cpu.uartLog += String.fromCharCode(val);
  }
}

function getWordPointer(cpu, regLetter) {
  const l = regLetter.toLowerCase();
  if (l.includes('x')) return (cpu.r[27] << 8) | cpu.r[26];
  if (l.includes('y')) return (cpu.r[29] << 8) | cpu.r[28];
  if (l.includes('z')) return (cpu.r[31] << 8) | cpu.r[30];
  return 0;
}

function setWordPointer(cpu, regLetter, val) {
  const l = regLetter.toLowerCase();
  val &= 0xFFFF;
  if (l.includes('x')) { cpu.r[26] = val & 0xFF; cpu.r[27] = (val >> 8) & 0xFF; }
  else if (l.includes('y')) { cpu.r[28] = val & 0xFF; cpu.r[29] = (val >> 8) & 0xFF; }
  else if (l.includes('z')) { cpu.r[30] = val & 0xFF; cpu.r[31] = (val >> 8) & 0xFF; }
}

function updateFlagsAdd(sreg, a, b, r) {
  sreg.H = ((a & 0x0F) + (b & 0x0F) > 0x0F) ? 1 : 0;
  sreg.C = (r > 0xFF) ? 1 : 0;
  sreg.Z = (r & 0xFF) === 0 ? 1 : 0;
  sreg.N = (r & 0x80) ? 1 : 0;
  sreg.V = (!((a ^ b) & 0x80) && ((a ^ r) & 0x80)) ? 1 : 0;
  sreg.S = sreg.N ^ sreg.V;
}

function updateFlagsSub(sreg, a, b, r) {
  b &= 0xFF;
  sreg.H = ((a & 0x0F) - (b & 0x0F) < 0) ? 1 : 0;
  sreg.C = (a < b) ? 1 : 0;
  sreg.Z = (r & 0xFF) === 0 ? 1 : 0;
  sreg.N = (r & 0x80) ? 1 : 0;
  sreg.V = (((a ^ b) & 0x80) && ((a ^ r) & 0x80)) ? 1 : 0;
  sreg.S = sreg.N ^ sreg.V;
}

function updateFlagsLogic(sreg, r) {
  sreg.Z = (r & 0xFF) === 0 ? 1 : 0;
  sreg.N = (r & 0x80) ? 1 : 0;
  sreg.V = 0;
  sreg.S = sreg.N;
}

/* ============================================================================
 * БЛОК 5: C→ASM транслятор (ПЕРЕПИСАН)
 * ============================================================================ */

function parseCExpression(expr, defines = {}) {
  if (!expr) return 0;
  let s = expr.trim();
  for (const [k, v] of Object.entries(defines)) {
    s = s.replace(new RegExp(`\\b${k}\\b`, 'g'), v);
  }
  s = s.replace(/\bDDD([0-7])\b/g, '$1')
       .replace(/\bDDB([0-7])\b/g, '$1')
       .replace(/\bDDC([0-7])\b/g, '$1')
       .replace(/\bPORTD([0-7])\b/g, '$1')
       .replace(/\bPORTB([0-7])\b/g, '$1')
       .replace(/\bPORTC([0-7])\b/g, '$1')
       .replace(/\bPIND([0-7])\b/g, '$1')
       .replace(/\bPINB([0-7])\b/g, '$1')
       .replace(/\bPINC([0-7])\b/g, '$1')
       .replace(/\bISC([0-1][0-1])\b/g, (m, p) => p === '00' ? '0' : p === '01' ? '1' : p === '10' ? '2' : '3')
       .replace(/\bINT([0-1])\b/g, '$1')
       .replace(/\bPCIE([0-2])\b/g, '$1')
       .replace(/\bPCINT([0-9]+)\b/g, (m, p) => (parseInt(p, 10) % 8).toString())
       .replace(/UL|U|L/gi, '');

  if (/^[0-9xXa-fA-F<>&|^~()+ \t-]+$/.test(s)) {
    try {
      return Function(`'use strict'; return (${s});`)();
    } catch {
      return 0;
    }
  }
  return 0;
}

function compileCToAsm(code) {
  const lines = code.split('\n');
  const defines = {};
  const varRegs = {};
  let nextVar = 18;
  const getVarReg = name => {
    if (!varRegs[name]) varRegs[name] = `r${nextVar++}`;
    return varRegs[name];
  };

  // --- Разбор структуры ---
  const isrBlocks = {};
  const mainLines = [];
  let currentIsr = null;
  let isrBraceDepth = 0;
  let inMain = false;
  let mainBraceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const cIdx = raw.indexOf('//');
    const line = (cIdx !== -1 ? raw.substring(0, cIdx) : raw).trim();
    if (!line) continue;

    const defM = line.match(/^#define\s+([a-zA-Z0-9_]+)\s+(.+)$/);
    if (defM) { defines[defM[1]] = defM[2].replace(/UL|U|L/gi, '').trim(); continue; }
    if (line.startsWith('#')) continue;

    const isrM = line.match(/^ISR\s*\(\s*([a-zA-Z0-9_]+)\s*\)/);
    if (isrM) {
      currentIsr = isrM[1];
      isrBlocks[currentIsr] = [];
      isrBraceDepth = 0;
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      isrBraceDepth += opens - closes;
      continue;
    }

    if (currentIsr) {
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      isrBraceDepth += opens - closes;
      if (isrBraceDepth <= 0 && closes > 0) {
        currentIsr = null;
        isrBraceDepth = 0;
      } else {
        isrBlocks[currentIsr].push({ line, lineNum: i + 1 });
      }
      continue;
    }

    if (line.includes('int main')) { inMain = true; continue; }
    if (line === '}' && inMain && mainBraceDepth === 0) { inMain = false; continue; }

    if (inMain) {
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      mainBraceDepth += opens - closes;
      if (line !== '{' && line !== '}') {
        mainLines.push({ line, lineNum: i + 1 });
      }
      continue;
    }
  }

  // --- Векторная таблица ---
  const asm = [];
  asm.push({ asm: '.include "m328pdef.inc"', lineNum: 1 });
  asm.push({ asm: '.org 0x0000', lineNum: 1 });
  asm.push({ asm: 'jmp __main_entry', lineNum: 1 });

  const vecMap = {
    INT0_vect:   { org: '0x0002', label: '__isr_int0' },
    INT1_vect:   { org: '0x0004', label: '__isr_int1' },
    PCINT0_vect: { org: '0x0006', label: '__isr_pcint0' },
    PCINT1_vect: { org: '0x0008', label: '__isr_pcint1' },
    PCINT2_vect: { org: '0x000A', label: '__isr_pcint2' }
  };
  for (const [vec, info] of Object.entries(vecMap)) {
    if (isrBlocks[vec]) {
      asm.push({ asm: `.org ${info.org}`, lineNum: 1 });
      asm.push({ asm: `jmp ${info.label}`, lineNum: 1 });
    }
  }

  asm.push({ asm: '__main_entry:', lineNum: 1 });
  asm.push({ asm: 'ldi r16, High(RAMEND)', lineNum: 1 });
  asm.push({ asm: 'out sph, r16', lineNum: 1 });
  asm.push({ asm: 'ldi r16, Low(RAMEND)', lineNum: 1 });
  asm.push({ asm: 'out spl, r16', lineNum: 1 });

  // --- Транслятор одной строки ---
  let ifCounter = 0;
  const emit = (inst, lineNum) => asm.push({ asm: inst, lineNum });

  function translateCLine(item, context = {}) {
    const l = item.line;
    const f = item.lineNum;

    if (l === 'sei();') { emit('sei', f); return; }
    if (l === 'cli();') { emit('cli', f); return; }

    // --- Регистровые операции: REG = / |= / &= / ^= ---
    const regOpM = l.match(/^([A-Z][A-Z0-9_]*)\s*(\|=|&=|\^=|=)\s*([^;]+);/);
    if (regOpM) {
      const rName = regOpM[1];
      const op = regOpM[2];
      const rawExpr = regOpM[3];
      const isExt = ['EICRA', 'PCICR', 'PCMSK0', 'PCMSK1', 'PCMSK2'].includes(rName);

      if (op === '=') {
        const val = parseCExpression(rawExpr, defines) & 0xFF;
        emit(`ldi r16, ${val}`, f);
        emit(isExt ? `sts ${rName}, r16` : `out ${rName}, r16`, f);
      } else if (op === '|=') {
        const val = parseCExpression(rawExpr, defines) & 0xFF;
        emit(isExt ? `lds r16, ${rName}` : `in r16, ${rName}`, f);
        emit(`ori r16, ${val}`, f);
        emit(isExt ? `sts ${rName}, r16` : `out ${rName}, r16`, f);
      } else if (op === '&=') {
        const val = parseCExpression(rawExpr.replace(/~/g, ''), defines) & 0xFF;
        const mask = (~val) & 0xFF;
        emit(isExt ? `lds r16, ${rName}` : `in r16, ${rName}`, f);
        emit(`andi r16, ${mask}`, f);
        emit(isExt ? `sts ${rName}, r16` : `out ${rName}, r16`, f);
      } else if (op === '^=') {
        const val = parseCExpression(rawExpr, defines) & 0xFF;
        emit(isExt ? `lds r16, ${rName}` : `in r16, ${rName}`, f);
        emit(`ldi r17, ${val}`, f);
        emit(`eor r16, r17`, f);
        emit(isExt ? `sts ${rName}, r16` : `out ${rName}, r16`, f);
      }
      return;
    }

    // --- Переменные ---
    // var++;
    const incM = l.match(/^([a-zA-Z_]\w*)\s*\+\+;/);
    if (incM) { emit(`inc ${getVarReg(incM[1])}`, f); return; }
    // var--;
    const decM = l.match(/^([a-zA-Z_]\w*)\s*--;/);
    if (decM) { emit(`dec ${getVarReg(decM[1])}`, f); return; }
    // var = N;
    const assignM = l.match(/^([a-zA-Z_]\w*)\s*=\s*(0x[0-9A-Fa-f]+|\d+);/);
    if (assignM) {
      emit(`ldi ${getVarReg(assignM[1])}, ${parseCExpression(assignM[2], defines) & 0xFF}`, f);
      return;
    }
    // var += N;
    const plusEqM = l.match(/^([a-zA-Z_]\w*)\s*\+=\s*(0x[0-9A-Fa-f]+|\d+);/);
    if (plusEqM) {
      emit(`ldi r16, ${parseCExpression(plusEqM[2], defines) & 0xFF}`, f);
      emit(`add ${getVarReg(plusEqM[1])}, r16`, f);
      return;
    }
    // var -= N;
    const minusEqM = l.match(/^([a-zA-Z_]\w*)\s*-=\s*(0x[0-9A-Fa-f]+|\d+);/);
    if (minusEqM) {
      emit(`ldi r16, ${parseCExpression(minusEqM[2], defines) & 0xFF}`, f);
      emit(`sub ${getVarReg(minusEqM[1])}, r16`, f);
      return;
    }
    // var = !var;
    const notM = l.match(/^([a-zA-Z_]\w*)\s*=\s*!\s*([a-zA-Z_]\w*);/);
    if (notM) {
      emit(`ldi r16, 1`, f);
      emit(`eor ${getVarReg(notM[1])}, r16`, f);
      return;
    }
    // PORTx = var;
    const portFromVarM = l.match(/^([A-Z][A-Z0-9_]*)\s*=\s*([a-zA-Z_]\w*);/);
    if (portFromVarM && /^[a-zA-Z_]\w*$/.test(portFromVarM[2])) {
      const isExt = ['EICRA', 'PCICR', 'PCMSK0', 'PCMSK1', 'PCMSK2'].includes(portFromVarM[1]);
      emit(isExt ? `sts ${portFromVarM[1]}, ${getVarReg(portFromVarM[2])}`
                 : `out ${portFromVarM[1]}, ${getVarReg(portFromVarM[2])}`, f);
      return;
    }

    // --- if / else ---
    if (l === '}') {
      // Закрытие if-блока
      if (context.closeIf) {
        emit(`${context.closeIf.falseLabel}:`, f);
        if (context.closeIf.hasElse) {
          // false-метка уже стоит перед else
        }
      }
      return;
    }

    if (l === 'else' || l === 'else {') {
      if (context.closeIf) {
        emit(`rjmp ${context.closeIf.endLabel}`, f);
        emit(`${context.closeIf.falseLabel}:`, f);
        context.closeIf.hasElse = true;
      }
      return;
    }

    const ifM = l.match(/^if\s*\((.+)\)\s*\{?$/);
    if (ifM) {
      const cond = ifM[1].trim();
      const id = ifCounter++;
      const falseLbl = `__if_false_${id}`;
      const endLbl   = `__if_end_${id}`;

      const eqM = cond.match(/^\(?\s*([a-zA-Z0-9_]+)\s*&\s*(0x[0-9A-Fa-f]+|\d+)\s*\)?\s*==\s*(0x[0-9A-Fa-f]+|\d+)$/);
      if (eqM) {
        const varName = eqM[1];
        const mask = parseCExpression(eqM[2], defines) & 0xFF;
        const target = parseCExpression(eqM[3], defines) & 0xFF;
        emit(`mov r16, ${getVarReg(varName)}`, f);
        emit(`andi r16, ${mask}`, f);
        emit(`ldi r17, ${target}`, f);
        emit(`cp r16, r17`, f);
        emit(`brne ${falseLbl}`, f);
        context.closeIf = { falseLabel: falseLbl, endLabel: endLbl, hasElse: false };
        return;
      }

      const andM = cond.match(/^\(?\s*([a-zA-Z0-9_]+)\s*&\s*(0x[0-9A-Fa-f]+|\d+)\s*\)?$/);
      if (andM) {
        const varName = andM[1];
        const mask = parseCExpression(andM[2], defines) & 0xFF;
        emit(`mov r16, ${getVarReg(varName)}`, f);
        emit(`andi r16, ${mask}`, f);
        emit(`breq ${falseLbl}`, f);
        context.closeIf = { falseLabel: falseLbl, endLabel: endLbl, hasElse: false };
        return;
      }

      const varOnly = cond.match(/^\(?\s*([a-zA-Z_]\w*)\s*\)?$/);
      if (varOnly) {
        emit(`mov r16, ${getVarReg(varOnly[1])}`, f);
        emit(`cpi r16, 0`, f);
        emit(`breq ${falseLbl}`, f);
        context.closeIf = { falseLabel: falseLbl, endLabel: endLbl, hasElse: false };
        return;
      }

      // fallback: никогда не выполняем
      emit(`rjmp ${falseLbl}`, f);
      context.closeIf = { falseLabel: falseLbl, endLabel: endLbl, hasElse: false };
      return;
    }

    if (l === 'while (1)' || l === 'while(1)' || l === 'while (1) {') {
      return;
    }
  }

  // --- Тело main (с меткой цикла) ---
  asm.push({ asm: '__main_loop:', lineNum: 1 });
  const mainContext = {};
  for (const m of mainLines) {
    translateCLine(m, mainContext);
  }
  asm.push({ asm: 'rjmp __main_loop', lineNum: 1 });

  // --- Обработчики ISR ---
  const isrLabelMap = {
    INT0_vect: '__isr_int0', INT1_vect: '__isr_int1',
    PCINT0_vect: '__isr_pcint0', PCINT1_vect: '__isr_pcint1', PCINT2_vect: '__isr_pcint2'
  };
  for (const [vec, block] of Object.entries(isrBlocks)) {
    const lbl = isrLabelMap[vec];
    if (!lbl) continue;
    asm.push({ asm: `${lbl}:`, lineNum: block[0]?.lineNum || 1 });
    const isrContext = {};
    for (const b of block) {
      translateCLine(b, isrContext);
    }
    asm.push({ asm: 'reti', lineNum: block[block.length - 1]?.lineNum || 1 });
  }

  // --- Сохранение карты переменных для UI ---
  if (Object.keys(varRegs).length > 0) {
    const mapStr = Object.entries(varRegs).map(([n, r]) => `${n}=${r}`).join(', ');
    asm.push({ asm: `; vars: ${mapStr}`, lineNum: 1 });
  }

  return asm;
}

// Парсер ASM
function assembleAVR(sourceCode, lang) {
  const instructions = [];
  const labels = {};
  let error = null;

  if (!sourceCode) return { program: [], labels: {}, error: null, errorLine: null };

  let rawList = [];
  if (lang === 'c') {
    try {
      rawList = compileCToAsm(sourceCode);
    } catch (e) {
      return { program: [], labels: {}, error: `C→ASM: ${e.message}`, errorLine: null };
    }
  } else {
    const lines = sourceCode.replace(/\r/g, '').split('\n');
    lines.forEach((l, idx) => {
      rawList.push({ asm: l, lineNum: idx + 1 });
    });
  }

  let currentPC = 0;
  const processed = [];

  for (let i = 0; i < rawList.length; i++) {
    let t = rawList[i].asm;
    const c1 = t.indexOf(';');
    const c2 = t.indexOf('//');
    let cut = -1;
    if (c1 !== -1 && c2 !== -1) cut = Math.min(c1, c2);
    else if (c1 !== -1) cut = c1;
    else if (c2 !== -1) cut = c2;
    if (cut !== -1) t = t.substring(0, cut);
    t = t.trim();
    if (!t) continue;

    const orgM = t.match(/^\.org\s+([0-9xXa-fA-F$]+)/i);
    if (orgM) {
      let targetAddr = parseVal(orgM[1]);
      while (currentPC < targetAddr) {
        processed.push({ op: 'nop', args: [], lineNum: rawList[i].lineNum, raw: 'nop' });
        currentPC++;
      }
      currentPC = targetAddr;
      continue;
    }

    if (t.startsWith('.')) continue;

    while (t.includes(':')) {
      const parts = t.split(':');
      const lbl = parts[0].trim().toLowerCase();
      labels[lbl] = currentPC;
      t = parts.slice(1).join(':').trim();
    }
    if (!t) continue;

    const parts = t.split(/\s+/);
    const op = parts[0].toLowerCase();
    const argsStr = t.substring(parts[0].length).trim();
    const args = argsStr ? argsStr.split(',').map(s => s.trim()) : [];

    processed.push({ op, args, lineNum: rawList[i].lineNum, raw: t });
    currentPC++;
  }

  return { program: processed, labels, error };
}

/* ============================================================================
 * БЛОК 6: Ядро CPU
 * ============================================================================ */

function createCPU() {
  const ram = new Uint8Array(2304);
  return {
    r: new Uint8Array(32),
    prevR: new Uint8Array(32),
    ram,
    pc: 0,
    sp: 2303,
    sreg: { C: 0, Z: 0, N: 0, V: 0, S: 0, H: 0, T: 0, I: 0 },
    cycles: 0,
    running: false,
    speed: 40,
    program: [],
    labels: {},
    breakpoints: new Set(),
    uartLog: '',
    error: null,
    errorLine: null,
    selectedPort: 'D',
    memView: 'ram',
    memFormat: 'hex',
    prevPinB: 0xFF,
    prevPinD: 0xFF,
    prevPinC: 0xFF
  };
}

function syncPinsAndIO(cpu, vButtons, circuitParts) {
  let inB = 0xFF;
  let inD = 0xFF;
  let inC = 0xFF;

  vButtons.forEach(btn => {
    if (btn.pressed) {
      if (btn.port === 'B') inB &= ~(1 << btn.pin);
      if (btn.port === 'D') inD &= ~(1 << btn.pin);
      if (btn.port === 'C') inC &= ~(1 << btn.pin);
    }
  });

  circuitParts.forEach(p => {
    if (p.type === 'button' && p.pressed) {
      const info = parsePinName(p.pin);
      if (info.port === 'B') inB &= ~(1 << info.bit);
      if (info.port === 'D') inD &= ~(1 << info.bit);
      if (info.port === 'C') inC &= ~(1 << info.bit);
    }
  });

  const ddrB = memRead(cpu, REG.DDRB);
  const portB = memRead(cpu, REG.PORTB);
  const ddrD = memRead(cpu, REG.DDRD);
  const portD = memRead(cpu, REG.PORTD);
  const ddrC = memRead(cpu, REG.DDRC);
  const portC = memRead(cpu, REG.PORTC);

  inB = (inB & ~ddrB) | (portB & ddrB);
  inD = (inD & ~ddrD) | (portD & ddrD);
  inC = (inC & ~ddrC) | (portC & ddrC);

  memWrite(cpu, REG.PINB, inB);
  memWrite(cpu, REG.PIND, inD);
  memWrite(cpu, REG.PINC, inC);

  memWrite(cpu, REG.SPL, cpu.sp & 0xFF);
  memWrite(cpu, REG.SPH, (cpu.sp >> 8) & 0xFF);

  let sregVal = 0;
  ['C', 'Z', 'N', 'V', 'S', 'H', 'T', 'I'].forEach((f, i) => {
    if (cpu.sreg[f]) sregVal |= (1 << i);
  });
  cpu.ram[REG.SREG] = sregVal;

  for (let i = 0; i < 32; i++) cpu.ram[i] = cpu.r[i];
}

function checkInterrupts(cpu) {
  if (cpu.sreg.I !== 1) return;

  const pinB = memRead(cpu, REG.PINB);
  const pinD = memRead(cpu, REG.PIND);
  const pinC = memRead(cpu, REG.PINC);

  const prevB = cpu.prevPinB;
  const prevD = cpu.prevPinD;
  const prevC = cpu.prevPinC;

  const eicra = memRead(cpu, REG.EICRA);
  const eimsk = memRead(cpu, REG.EIMSK);
  let eifr = memRead(cpu, REG.EIFR);

  // INT0
  if (eimsk & 1) {
    const isc0 = eicra & 0x03;
    const currBit = (pinD >> 2) & 1;
    const prevBit = (prevD >> 2) & 1;
    let trigger = false;
    if (isc0 === 0 && currBit === 0) trigger = true;
    else if (isc0 === 1 && currBit !== prevBit) trigger = true;
    else if (isc0 === 2 && prevBit === 1 && currBit === 0) trigger = true;
    else if (isc0 === 3 && prevBit === 0 && currBit === 1) trigger = true;
    if (trigger) eifr |= (1 << 0);
  }

  // INT1
  if (eimsk & 2) {
    const isc1 = (eicra >> 2) & 0x03;
    const currBit = (pinD >> 3) & 1;
    const prevBit = (prevD >> 3) & 1;
    let trigger = false;
    if (isc1 === 0 && currBit === 0) trigger = true;
    else if (isc1 === 1 && currBit !== prevBit) trigger = true;
    else if (isc1 === 2 && prevBit === 1 && currBit === 0) trigger = true;
    else if (isc1 === 3 && prevBit === 0 && currBit === 1) trigger = true;
    if (trigger) eifr |= (1 << 1);
  }

  // PCINT
  const pcicr = memRead(cpu, REG.PCICR);
  let pcifr = memRead(cpu, REG.PCIFR);
  const pcmsk0 = memRead(cpu, REG.PCMSK0);
  const pcmsk1 = memRead(cpu, REG.PCMSK1);
  const pcmsk2 = memRead(cpu, REG.PCMSK2);

  if ((pcicr & 1) && ((pinB ^ prevB) & pcmsk0)) pcifr |= (1 << 0);
  if ((pcicr & 2) && ((pinC ^ prevC) & pcmsk1)) pcifr |= (1 << 1);
  if ((pcicr & 4) && ((pinD ^ prevD) & pcmsk2)) pcifr |= (1 << 2);

  memWrite(cpu, REG.EIFR, eifr);
  memWrite(cpu, REG.PCIFR, pcifr);

  let targetVector = null;
  if (eifr & 1) { targetVector = VECTORS.INT0; eifr &= ~1; }
  else if (eifr & 2) { targetVector = VECTORS.INT1; eifr &= ~2; }
  else if (pcifr & 1) { targetVector = VECTORS.PCINT0; pcifr &= ~1; }
  else if (pcifr & 2) { targetVector = VECTORS.PCINT1; pcifr &= ~2; }
  else if (pcifr & 4) { targetVector = VECTORS.PCINT2; pcifr &= ~4; }

  if (targetVector !== null && targetVector < cpu.program.length) {
    const returnPC = cpu.pc;
    memWrite(cpu, cpu.sp, returnPC & 0xFF);
    cpu.sp = (cpu.sp - 1) & 0xFFFF;
    memWrite(cpu, cpu.sp, (returnPC >> 8) & 0xFF);
    cpu.sp = (cpu.sp - 1) & 0xFFFF;

    cpu.sreg.I = 0;
    cpu.pc = targetVector;

    memWrite(cpu, REG.EIFR, eifr);
    memWrite(cpu, REG.PCIFR, pcifr);
  }

  cpu.prevPinB = pinB;
  cpu.prevPinD = pinD;
  cpu.prevPinC = pinC;
}

function cpuStep(cpu) {
  if (cpu.error || cpu.program.length === 0 || cpu.pc >= cpu.program.length) {
    cpu.running = false;
    return { hitBreakpoint: false };
  }

  checkInterrupts(cpu);

  if (cpu.pc >= cpu.program.length) {
    cpu.running = false;
    return { hitBreakpoint: false };
  }

  cpu.prevR.set(cpu.r);
  const inst = cpu.program[cpu.pc];
  const op = inst.op;
  const args = inst.args;
  let nextPC = cpu.pc + 1;

  if (op === 'break') {
    cpu.running = false;
    return { hitBreakpoint: true };
  }

  switch (op) {
    case 'nop': break;
    case 'ldi': cpu.r[parseReg(args[0])] = parseVal(args[1], cpu.labels) & 0xFF; break;
    case 'mov': cpu.r[parseReg(args[0])] = cpu.r[parseReg(args[1])]; break;
    case 'in': {
      const ioAddr = parseVal(args[1], cpu.labels);
      cpu.r[parseReg(args[0])] = memRead(cpu, ioToMemAddr(ioAddr));
      break;
    }
    case 'out': {
      const ioAddr = parseVal(args[0], cpu.labels);
      memWrite(cpu, ioToMemAddr(ioAddr), cpu.r[parseReg(args[1])]);
      break;
    }
    case 'lds': cpu.r[parseReg(args[0])] = memRead(cpu, parseVal(args[1], cpu.labels)); break;
    case 'sts': memWrite(cpu, parseVal(args[0], cpu.labels), cpu.r[parseReg(args[1])]); break;
    case 'ld': {
      let ptr = getWordPointer(cpu, args[1]);
      if (args[1].includes('-')) { ptr--; setWordPointer(cpu, args[1], ptr); }
      cpu.r[parseReg(args[0])] = memRead(cpu, ptr);
      if (args[1].includes('+')) setWordPointer(cpu, args[1], ptr + 1);
      break;
    }
    case 'st': {
      let ptr = getWordPointer(cpu, args[0]);
      if (args[0].includes('-')) { ptr--; setWordPointer(cpu, args[0], ptr); }
      memWrite(cpu, ptr, cpu.r[parseReg(args[1])]);
      if (args[0].includes('+')) setWordPointer(cpu, args[0], ptr + 1);
      break;
    }
    case 'add': {
      const rd = parseReg(args[0]), rr = parseReg(args[1]);
      const res = cpu.r[rd] + cpu.r[rr];
      updateFlagsAdd(cpu.sreg, cpu.r[rd], cpu.r[rr], res);
      cpu.r[rd] = res & 0xFF;
      break;
    }
    case 'adc': {
      const rd = parseReg(args[0]), rr = parseReg(args[1]);
      const res = cpu.r[rd] + cpu.r[rr] + cpu.sreg.C;
      updateFlagsAdd(cpu.sreg, cpu.r[rd], cpu.r[rr], res);
      cpu.r[rd] = res & 0xFF;
      break;
    }
    case 'sub': {
      const rd = parseReg(args[0]), rr = parseReg(args[1]);
      const res = cpu.r[rd] - cpu.r[rr];
      updateFlagsSub(cpu.sreg, cpu.r[rd], cpu.r[rr], res);
      cpu.r[rd] = res & 0xFF;
      break;
    }
    case 'subi': {
      const rd = parseReg(args[0]);
      const k = parseVal(args[1], cpu.labels) & 0xFF;
      const res = cpu.r[rd] - k;
      updateFlagsSub(cpu.sreg, cpu.r[rd], k, res);
      cpu.r[rd] = res & 0xFF;
      break;
    }
    case 'inc': {
      const rd = parseReg(args[0]);
      const res = (cpu.r[rd] + 1) & 0xFF;
      cpu.sreg.Z = res === 0 ? 1 : 0;
      cpu.sreg.N = (res & 0x80) ? 1 : 0;
      cpu.sreg.V = cpu.r[rd] === 0x7F ? 1 : 0;
      cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
      cpu.r[rd] = res;
      break;
    }
    case 'dec': {
      const rd = parseReg(args[0]);
      const res = (cpu.r[rd] - 1) & 0xFF;
      cpu.sreg.Z = res === 0 ? 1 : 0;
      cpu.sreg.N = (res & 0x80) ? 1 : 0;
      cpu.sreg.V = cpu.r[rd] === 0x80 ? 1 : 0;
      cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
      cpu.r[rd] = res;
      break;
    }
    case 'and': {
      const rd = parseReg(args[0]);
      cpu.r[rd] &= cpu.r[parseReg(args[1])];
      updateFlagsLogic(cpu.sreg, cpu.r[rd]);
      break;
    }
    case 'andi': {
      const rd = parseReg(args[0]);
      cpu.r[rd] &= (parseVal(args[1], cpu.labels) & 0xFF);
      updateFlagsLogic(cpu.sreg, cpu.r[rd]);
      break;
    }
    case 'or': {
      const rd = parseReg(args[0]);
      cpu.r[rd] |= cpu.r[parseReg(args[1])];
      updateFlagsLogic(cpu.sreg, cpu.r[rd]);
      break;
    }
    case 'ori': {
      const rd = parseReg(args[0]);
      cpu.r[rd] |= (parseVal(args[1], cpu.labels) & 0xFF);
      updateFlagsLogic(cpu.sreg, cpu.r[rd]);
      break;
    }
    case 'eor': {
      const rd = parseReg(args[0]);
      cpu.r[rd] ^= cpu.r[parseReg(args[1])];
      updateFlagsLogic(cpu.sreg, cpu.r[rd]);
      break;
    }
    case 'clr': { const rd = parseReg(args[0]); cpu.r[rd] = 0; updateFlagsLogic(cpu.sreg, 0); break; }
    case 'ser': cpu.r[parseReg(args[0])] = 0xFF; break;
    case 'sbi': {
      const memAddr = ioToMemAddr(parseVal(args[0], cpu.labels));
      const bit = parseVal(args[1], cpu.labels) & 7;
      memWrite(cpu, memAddr, memRead(cpu, memAddr) | (1 << bit));
      break;
    }
    case 'cbi': {
      const memAddr = ioToMemAddr(parseVal(args[0], cpu.labels));
      const bit = parseVal(args[1], cpu.labels) & 7;
      memWrite(cpu, memAddr, memRead(cpu, memAddr) & ~(1 << bit));
      break;
    }
    case 'cpi': {
      const rd = parseReg(args[0]);
      const k = parseVal(args[1], cpu.labels) & 0xFF;
      updateFlagsSub(cpu.sreg, cpu.r[rd], k, cpu.r[rd] - k);
      break;
    }
    case 'cp': {
      const rd = parseReg(args[0]), rr = parseReg(args[1]);
      updateFlagsSub(cpu.sreg, cpu.r[rd], cpu.r[rr], cpu.r[rd] - cpu.r[rr]);
      break;
    }
    case 'jmp':
    case 'rjmp': {
      const target = cpu.labels[args[0]?.toLowerCase()];
      if (target !== undefined) nextPC = target;
      break;
    }
    case 'call':
    case 'rcall': {
      const target = cpu.labels[args[0]?.toLowerCase()];
      if (target !== undefined) {
        memWrite(cpu, cpu.sp, nextPC & 0xFF);
        cpu.sp = (cpu.sp - 1) & 0xFFFF;
        memWrite(cpu, cpu.sp, (nextPC >> 8) & 0xFF);
        cpu.sp = (cpu.sp - 1) & 0xFFFF;
        nextPC = target;
      }
      break;
    }
    case 'ret': {
      cpu.sp = (cpu.sp + 1) & 0xFFFF;
      const hi = memRead(cpu, cpu.sp);
      cpu.sp = (cpu.sp + 1) & 0xFFFF;
      const lo = memRead(cpu, cpu.sp);
      nextPC = (hi << 8) | lo;
      break;
    }
    case 'reti': {
      cpu.sp = (cpu.sp + 1) & 0xFFFF;
      const hi = memRead(cpu, cpu.sp);
      cpu.sp = (cpu.sp + 1) & 0xFFFF;
      const lo = memRead(cpu, cpu.sp);
      nextPC = (hi << 8) | lo;
      cpu.sreg.I = 1;
      break;
    }
    case 'breq': if (cpu.sreg.Z === 1) nextPC = cpu.labels[args[0]?.toLowerCase()] ?? nextPC; break;
    case 'brne': if (cpu.sreg.Z === 0) nextPC = cpu.labels[args[0]?.toLowerCase()] ?? nextPC; break;
    case 'brcs':
    case 'brlo': if (cpu.sreg.C === 1) nextPC = cpu.labels[args[0]?.toLowerCase()] ?? nextPC; break;
    case 'brcc':
    case 'brsh': if (cpu.sreg.C === 0) nextPC = cpu.labels[args[0]?.toLowerCase()] ?? nextPC; break;
    case 'sei': cpu.sreg.I = 1; break;
    case 'cli': cpu.sreg.I = 0; break;
    case 'sec': cpu.sreg.C = 1; break;
    case 'clc': cpu.sreg.C = 0; break;
    case 'sez': cpu.sreg.Z = 1; break;
    case 'clz': cpu.sreg.Z = 0; break;
    case 'push': memWrite(cpu, cpu.sp, cpu.r[parseReg(args[0])]); cpu.sp = (cpu.sp - 1) & 0xFFFF; break;
    case 'pop': cpu.sp = (cpu.sp + 1) & 0xFFFF; cpu.r[parseReg(args[0])] = memRead(cpu, cpu.sp); break;
  }

  cpu.pc = nextPC;
  cpu.cycles++;

  let hitBp = false;
  if (cpu.running && cpu.pc < cpu.program.length && cpu.breakpoints.has(cpu.program[cpu.pc].lineNum)) {
    cpu.running = false;
    hitBp = true;
  }
  return { hitBreakpoint: hitBp };
}

function parsePinName(pinStr) {
  if (!pinStr) return { port: 'B', bit: 5 };
  const s = pinStr.trim().toUpperCase();
  if (s.startsWith('PB')) return { port: 'B', bit: Math.min(7, Math.max(0, parseInt(s.substring(2), 10) || 0)) };
  if (s.startsWith('PD')) return { port: 'D', bit: Math.min(7, Math.max(0, parseInt(s.substring(2), 10) || 0)) };
  if (s.startsWith('PC')) return { port: 'C', bit: Math.min(6, Math.max(0, parseInt(s.substring(2), 10) || 0)) };
  return { port: 'B', bit: 5 };
}

/* ============================================================================
 * БЛОК 7: HEX-экспорт (заглушка, честно предупреждает)
 * ============================================================================ */

function makeHexRecord(address, recordType, dataBytes) {
  const len = dataBytes.length;
  let sum = len + ((address >> 8) & 0xFF) + (address & 0xFF) + recordType;
  for (const b of dataBytes) sum += b;
  const checksum = ((~sum + 1) & 0xFF).toString(16).padStart(2, '0').toUpperCase();
  return `:${len.toString(16).padStart(2, '0').toUpperCase()}${address.toString(16).padStart(4, '0').toUpperCase()}${recordType.toString(16).padStart(2, '0').toUpperCase()}${dataBytes.map(b => (b & 0xFF).toString(16).padStart(2, '0').toUpperCase()).join('')}${checksum}`;
}

function exportIntelHex(program) {
  const lines = [];
  lines.push(':020000040000FA'); // extended linear address 0
  for (let i = 0; i < program.length; i += 8) {
    const chunk = [];
    for (let j = 0; j < 8; j++) chunk.push(0x00); // заглушка
    lines.push(makeHexRecord(i * 2, 0, chunk));
  }
  lines.push(':00000001FF');
  const header = '; NOTE: This HEX is a placeholder (opcodes not generated).\r\n';
  return header + lines.join('\r\n') + '\r\n';
}

function downloadFile(content, fileName = 'firmware.hex') {
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/* ============================================================================
 * БЛОК 8: UI-компоненты
 * ============================================================================ */

function Toolbar({
  examples, currentExampleId, onSelectExample,
  running, onToggleRun, onStep, onReset,
  speed, onChangeSpeed, activeWindows, onSetPreset, onExportHex
}) {
  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <div className="logo flex items-center gap-1.5 font-extrabold text-white text-base tracking-tight whitespace-nowrap">
          <span className="text-amber-400 text-lg">⚡</span>
          <span>AVR <span className="text-emerald-400">Interrupt Studio</span></span>
        </div>
        <div className="select-wrapper">
          <select
            value={currentExampleId}
            onChange={e => onSelectExample(e.target.value)}
            className="bg-[#1d222e] text-slate-100 border border-[#2b3346] px-2.5 py-1.5 rounded-md text-xs sm:text-sm font-medium outline-none cursor-pointer focus:border-blue-500 max-w-[280px] sm:max-w-[360px]"
          >
            {Object.values(examples).map(ex => (
              <option key={ex.id} value={ex.id}>{ex.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="toolbar-center flex items-center gap-1.5 sm:gap-2">
        <button type="button" onClick={onStep} className="btn btn-step" title="F11">
          <SkipForward size={14} className="text-blue-400" />
          <span className="hidden sm:inline">Шаг (F11)</span>
        </button>
        <button type="button" onClick={onToggleRun} className={`btn btn-run ${running ? 'running' : ''}`}>
          {running ? (
            <><Pause size={14} className="text-red-400" /><span>Пауза</span></>
          ) : (
            <><Play size={14} className="text-emerald-400 fill-emerald-400" /><span>Пуск</span></>
          )}
        </button>
        <button type="button" onClick={onReset} className="btn btn-reset">
          <RotateCcw size={14} />
          <span className="hidden sm:inline">Сброс</span>
        </button>
        <div className="speed-box flex items-center gap-1.5 text-xs text-slate-400 bg-[#121620] px-2 py-1 rounded border border-[#2b3346]">
          <input type="range" min="1" max="100" value={speed}
            onChange={e => onChangeSpeed(parseInt(e.target.value, 10))}
            className="w-12 sm:w-16 accent-emerald-400 cursor-pointer" />
          <span className="font-mono text-[11px] min-w-[50px] text-slate-300">{speed} оп/с</span>
        </div>
        <button type="button" onClick={onExportHex}
          className="btn px-2.5 py-1.5 bg-[#142036] hover:bg-[#1a2b4b] text-blue-300 border border-blue-500/40 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm">
          <Download size={13} className="text-blue-400" />
          <span className="hidden sm:inline">Экспорт HEX</span>
        </button>
      </div>

      <div className="toolbar-right flex items-center gap-2">
        <div className="hidden xl:flex items-center gap-1 bg-[#10141d] p-1 rounded-lg border border-[#262e40]">
          <span className="text-[11px] font-semibold text-slate-400 px-1.5 flex items-center gap-1">
            <LayoutGrid size={12} className="text-blue-400" />Окон:
          </span>
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} type="button" onClick={() => onSetPreset(n)}
              className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${activeWindows.length === n ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-[#1a2130]'}`}>
              {n}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

function HintBanner({ hint }) {
  if (!hint) return null;
  return (
    <div className="hint-banner flex items-center gap-2 px-4 py-1.5 text-xs text-slate-300 border-b border-blue-900/40 bg-blue-950/20">
      <span className="text-base select-none">💡</span>
      <div className="hint-text flex-1" dangerouslySetInnerHTML={{ __html: hint }} />
    </div>
  );
}

function EditorPanel({
  code, onChangeCode, lang, onChangeLang, currentLine,
  breakpoints, onToggleBreakpoint, statusText, isError, cycles,
  onClear, onMaximize
}) {
  const lineCount = code.split('\n').length;
  return (
    <section className="slide-panel flex flex-col h-full bg-[#151922] border border-[#2b3346] rounded-xl overflow-hidden min-w-0">
      <div className="slide-header bg-[#181d28] border-b border-[#2b3346] px-3 py-2 flex items-center justify-between gap-1.5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold text-white flex items-center gap-1">
            <span>📝</span><span>Редактор кода</span>
          </h2>
          <div className="flex bg-[#0c0f16] p-0.5 rounded border border-[#2b3346]">
            <button type="button" onClick={() => onChangeLang('asm')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${lang === 'asm' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>ASM</button>
            <button type="button" onClick={() => onChangeLang('c')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${lang === 'c' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Си</button>
          </div>
          <button type="button" onClick={onClear} className="text-slate-400 hover:text-rose-400 p-1">
            <Trash2 size={12} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`font-mono text-[11px] ${isError ? 'text-red-400 font-bold' : 'text-slate-300'}`}>
            {statusText} | Такты: {cycles}
          </span>
          <button type="button" onClick={onMaximize} className="p-1 rounded text-slate-400 hover:text-white">
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <div className="editor-wrapper flex-1 flex h-full relative overflow-hidden bg-[#080a0f]">
        <div className="line-gutter w-12 h-full bg-[#06070a] border-r border-[#1a1e28] select-none font-mono text-[13px] py-2 overflow-hidden">
          {Array.from({ length: lineCount }).map((_, idx) => {
            const num = idx + 1;
            const isCurr = num === currentLine;
            const isBp = breakpoints.has(num);
            return (
              <div key={num} onClick={() => onToggleBreakpoint(num)}
                className={`gutter-row flex items-center justify-between px-1 h-[22px] cursor-pointer hover:bg-white/5 ${isCurr ? 'bg-amber-400/20 text-amber-300 font-bold' : ''}`}>
                <span className={`w-2 h-2 rounded-full ${isBp ? 'bg-rose-500 shadow-[0_0_8px_#f43f5e]' : 'bg-transparent'}`} />
                <span className={`text-[10px] ${isCurr ? 'text-amber-400' : 'opacity-0'}`}>▶</span>
                <span className={`text-[11px] ${isCurr ? 'text-amber-300' : 'text-slate-600'}`}>{num}</span>
              </div>
            );
          })}
        </div>
        <div className="editor-container flex-1 h-full relative overflow-hidden">
          <textarea value={code} onChange={e => onChangeCode(e.target.value)} spellCheck="false"
            className="w-full h-full p-2.5 m-0 bg-transparent text-slate-200 caret-sky-400 resize-none font-mono text-[13px] leading-[22px] whitespace-pre outline-none border-none overflow-auto"
            placeholder="Код программы..." />
        </div>
      </div>
    </section>
  );
}

function BoardPanel({ cpu, vButtons, onToggleVButton, onSelectPort, onClearUart, onMaximize }) {
  const isLedL = !!(memRead(cpu, REG.PORTB) & 0x20);
  let portVal = 0;
  if (cpu.selectedPort === 'D') portVal = memRead(cpu, REG.PORTD);
  else if (cpu.selectedPort === 'B') portVal = memRead(cpu, REG.PORTB);
  else if (cpu.selectedPort === 'C') portVal = memRead(cpu, REG.PORTC);

  const eicra = memRead(cpu, REG.EICRA);
  const eimsk = memRead(cpu, REG.EIMSK);

  return (
    <section className="slide-panel flex flex-col h-full bg-[#151922] border border-[#2b3346] rounded-xl overflow-hidden min-w-0">
      <div className="slide-header bg-[#181d28] border-b border-[#2b3346] px-3 py-2 flex items-center justify-between">
        <h2 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
          <Lightbulb size={15} className="text-amber-400" />
          <span>Плата ввода-вывода</span>
        </h2>
        <button type="button" onClick={onMaximize} className="p-1 rounded text-slate-400 hover:text-white">
          <Maximize2 size={13} />
        </button>
      </div>

      <div className="board-scroll-area flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        <div className="board-card bg-[#1d222e] border border-[#2b3346] rounded-lg p-2.5 text-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold text-slate-200">Система прерываний:</span>
            <span className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${cpu.sreg.I ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/50' : 'bg-rose-950 text-rose-400'}`}>
              {cpu.sreg.I ? 'SEI' : 'CLI'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono mt-1 text-slate-300">
            <div className="bg-[#121620] p-1.5 rounded border border-[#262f40]">
              <b>INT0 (PD2):</b> {eimsk & 1 ? 'ВКЛ' : 'ВЫКЛ'} | ISC: {eicra & 3}
            </div>
            <div className="bg-[#121620] p-1.5 rounded border border-[#262f40]">
              <b>INT1 (PD3):</b> {eimsk & 2 ? 'ВКЛ' : 'ВЫКЛ'} | ISC: {(eicra >> 2) & 3}
            </div>
          </div>
        </div>

        <div className="board-card bg-[#1d222e] border border-[#2b3346] rounded-lg p-3">
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-xs font-bold text-white">Кнопки K1..K8</h3>
            <span className="text-[10px] text-slate-400">Нажатие = 0V</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {vButtons.map(btn => {
              const isInt = btn.id === 'K1' ? ' [INT0]' : btn.id === 'K2' ? ' [INT1]' : '';
              return (
                <button key={btn.id} type="button" onClick={() => onToggleVButton(btn.id)}
                  className={`py-2 px-1 rounded-lg border text-xs font-bold transition-all flex flex-col items-center justify-center gap-0.5 ${btn.pressed ? 'bg-amber-400 text-black border-white shadow-[0_0_14px_rgba(251,191,36,0.6)] font-extrabold' : 'bg-[#141822] text-slate-200 border-[#334155] hover:border-slate-400'}`}>
                  <span>{btn.id}{isInt}</span>
                  <span className={`text-[10px] font-normal ${btn.pressed ? 'text-amber-950 font-semibold' : 'text-slate-400'}`}>
                    {btn.port}{btn.pin} ({btn.pressed ? '0' : '1'})
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="board-card bg-[#1d222e] border border-[#2b3346] rounded-lg p-3 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-white">Светодиод [L]</h3>
            <p className="text-[11px] text-slate-400">PB5</p>
          </div>
          <div className="flex items-center gap-2 bg-[#121620] px-3 py-1.5 rounded-lg border border-[#2b3346]">
            <div className={`w-6 h-6 rounded-full border-2 transition-all duration-75 ${isLedL ? 'bg-yellow-400 border-white shadow-[0_0_16px_#facc15]' : 'bg-[#252b3b] border-[#3b455d]'}`} />
            <span className={`text-xs font-mono font-bold ${isLedL ? 'text-yellow-400' : 'text-slate-400'}`}>
              {isLedL ? 'HIGH' : 'LOW'}
            </span>
          </div>
        </div>

        <div className="board-card bg-[#1d222e] border border-[#2b3346] rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-white">Порт {cpu.selectedPort}</h3>
            <div className="flex items-center gap-1 bg-[#141822] p-0.5 rounded border border-[#2b3346]">
              {['D', 'B', 'C'].map(p => (
                <button key={p} type="button" onClick={() => onSelectPort(p)}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${cpu.selectedPort === p ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-8 gap-1.5 text-center bg-[#121620] p-2.5 rounded-lg border border-[#262f40]">
            {[7, 6, 5, 4, 3, 2, 1, 0].map(bit => {
              const on = !!(portVal & (1 << bit));
              return (
                <div key={bit} className="flex flex-col items-center gap-1">
                  <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 transition-all duration-75 ${on ? 'bg-emerald-400 border-white shadow-[0_0_14px_#34d399]' : 'bg-[#252b3b] border-[#3b455d]'}`} />
                  <span className="text-[10px] font-mono text-slate-400">{cpu.selectedPort}{bit}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="board-card bg-[#1d222e] border border-[#2b3346] rounded-lg p-3 flex flex-col gap-1.5 flex-1 min-h-[100px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-white">
              <Terminal size={14} className="text-emerald-400" />
              <span>UART</span>
            </div>
            <button type="button" onClick={onClearUart} className="text-[11px] text-blue-400">Очистить</button>
          </div>
          <pre className="flex-1 bg-[#080a0f] border border-[#1a1e28] rounded p-2 text-emerald-400 font-mono text-xs overflow-y-auto whitespace-pre-wrap min-h-[60px]">
            {cpu.uartLog || 'Данные UART...'}
          </pre>
        </div>
      </div>
    </section>
  );
}

function CircuitPanel({ cpu, components, onAddComponent, onRemoveComponent, onChangePin, onToggleComponentButton, onClearCircuit, onMaximize }) {
  return (
    <section className="slide-panel flex flex-col h-full bg-[#151922] border border-[#2b3346] rounded-xl overflow-hidden min-w-0">
      <div className="slide-header bg-[#181d28] border-b border-[#2b3346] px-3 py-2 flex items-center justify-between">
        <h2 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
          <Wrench size={15} className="text-blue-400" />
          <span>Цепи ({components.length})</span>
        </h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClearCircuit} className="text-slate-400 hover:text-rose-400 text-xs flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#2b3346]">
            <Trash2 size={12} /><span>Очистить</span>
          </button>
          <button type="button" onClick={onMaximize} className="p-1 rounded text-slate-400 hover:text-white">
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <div className="board-scroll-area flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        <div className="board-card bg-[#1d222e] border border-[#2b3346] rounded-lg p-3">
          <h3 className="text-xs font-bold text-white mb-2 flex items-center gap-1">
            <Plus size={13} className="text-emerald-400" />Добавить
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 text-xs">
            <button type="button" onClick={() => onAddComponent('led', 'red')} className="bg-[#141822] border border-rose-500/40 text-rose-300 py-1.5 px-2 rounded font-semibold">LED Красный</button>
            <button type="button" onClick={() => onAddComponent('led', 'green')} className="bg-[#141822] border border-emerald-500/40 text-emerald-300 py-1.5 px-2 rounded font-semibold">LED Зелёный</button>
            <button type="button" onClick={() => onAddComponent('led', 'yellow')} className="bg-[#141822] border border-amber-500/40 text-amber-300 py-1.5 px-2 rounded font-semibold">LED Жёлтый</button>
            <button type="button" onClick={() => onAddComponent('led', 'blue')} className="bg-[#141822] border border-blue-500/40 text-blue-300 py-1.5 px-2 rounded font-semibold">LED Синий</button>
            <button type="button" onClick={() => onAddComponent('button')} className="bg-[#141822] border border-slate-600 text-slate-200 py-1.5 px-2 rounded font-semibold">Кнопка</button>
          </div>
        </div>

        <div className="board-card bg-[#1d222e] border border-[#2b3346] rounded-lg p-3 flex-1 flex flex-col">
          <h3 className="text-xs font-bold text-white mb-2">Элементы:</h3>
          <div className="circuit-bench flex-1 flex flex-col gap-2 min-h-[140px] overflow-y-auto">
            {components.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 border border-dashed border-[#2b3346] rounded-lg text-slate-500 text-xs">
                Добавьте элементы
              </div>
            ) : (
              components.map(comp => {
                const info = parsePinName(comp.pin);
                let pVal = 0;
                if (info.port === 'D') pVal = memRead(cpu, REG.PORTD);
                else if (info.port === 'B') pVal = memRead(cpu, REG.PORTB);
                else if (info.port === 'C') pVal = memRead(cpu, REG.PORTC);
                const isHigh = !!(pVal & (1 << info.bit));

                return (
                  <div key={comp.id} className="circuit-item-card bg-[#141822] border border-[#262e3e] rounded-lg p-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      {comp.type === 'led' && (
                        <div className={`w-6 h-6 rounded-full border-2 ${isHigh ? 'bg-amber-400 border-white shadow-[0_0_14px_#fbbf24]' : 'bg-[#252b3b] border-[#3b455d]'}`} />
                      )}
                      {comp.type === 'button' && (
                        <button type="button" onClick={() => onToggleComponentButton(comp.id)}
                          className={`px-2.5 py-1 rounded text-xs font-bold border ${comp.pressed ? 'bg-amber-400 text-black border-white' : 'bg-[#1e293b] text-white border-slate-600'}`}>
                          {comp.pressed ? '🔴' : '⚪'}
                        </button>
                      )}
                      <div>
                        <div className="text-xs font-bold text-slate-200">{comp.type === 'led' ? `LED (${comp.color})` : 'Кнопка'}</div>
                        <div className="text-[10px] text-slate-500">{comp.pin}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select value={comp.pin} onChange={e => onChangePin(comp.id, e.target.value)}
                        className="bg-[#0c0f16] text-sky-400 border border-[#2b3346] px-2 py-1 rounded text-xs font-mono">
                        {ALL_PINS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <button type="button" onClick={() => onRemoveComponent(comp.id)} className="text-slate-500 hover:text-rose-400 p-1">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function CpuPanel({ cpu, onMaximize }) {
  return (
    <section className="slide-panel flex flex-col h-full bg-[#151922] border border-[#2b3346] rounded-xl overflow-hidden min-w-0">
      <div className="slide-header bg-[#181d28] border-b border-[#2b3346] px-3 py-2 flex items-center justify-between">
        <h2 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
          <Settings2 size={15} className="text-emerald-400" />
          <span>Регистры и память</span>
        </h2>
        <button type="button" onClick={onMaximize} className="p-1 rounded text-slate-400 hover:text-white">
          <Maximize2 size={13} />
        </button>
      </div>

      <div className="cpu-scroll-area flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
        <div className="cpu-subcard bg-[#1d222e] border border-[#2b3346] rounded-lg p-2.5">
          <div className="text-xs font-bold text-white mb-1.5">SREG [I T H S V N Z C]</div>
          <div className="grid grid-cols-8 gap-1">
            {['I', 'T', 'H', 'S', 'V', 'N', 'Z', 'C'].map(flag => {
              const val = cpu.sreg[flag];
              return (
                <div key={flag} className={`py-1 px-0.5 rounded text-center border font-mono ${val ? 'bg-emerald-950/60 border-emerald-500 text-emerald-400' : 'bg-[#141822] border-[#2b3346] text-slate-500'}`}>
                  <span className="block text-[10px] text-slate-400">{flag}</span>
                  <b className="text-xs">{val}</b>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between bg-[#141822] border border-[#2b3346] rounded-lg px-2.5 py-1.5 text-xs font-mono">
          <div><span className="text-slate-400">PC: </span><b className="text-amber-400">{cpu.pc.toString(16).padStart(4, '0').toUpperCase()}</b></div>
          <div><span className="text-slate-400">SP: </span><b className="text-sky-400">{cpu.sp.toString(16).padStart(4, '0').toUpperCase()}</b></div>
        </div>

        <div className="cpu-subcard bg-[#1d222e] border border-[#2b3346] rounded-lg p-2.5">
          <div className="text-xs font-bold text-white mb-1.5">R0..R31</div>
          <div className="grid grid-cols-4 gap-1 max-h-[180px] overflow-y-auto pr-1">
            {Array.from({ length: 32 }).map((_, idx) => {
              const val = cpu.r[idx];
              const changed = cpu.r[idx] !== cpu.prevR[idx];
              return (
                <div key={idx} className={`p-1 rounded border text-[11px] font-mono ${changed ? 'bg-amber-950/40 border-amber-500/70 text-amber-300' : 'bg-[#141822] border-[#262f40] text-slate-300'}`}>
                  <span className="text-[10px] text-slate-500 block">R{idx}</span>
                  <b className="font-bold text-white">0x{val.toString(16).padStart(2, '0').toUpperCase()}</b>
                </div>
              );
            })}
          </div>
        </div>

        <div className="cpu-subcard bg-[#1d222e] border border-[#2b3346] rounded-lg p-2.5 flex-1 flex flex-col min-h-[140px]">
          <pre className="flex-1 bg-[#080a0f] border border-[#1a1e28] rounded p-2 text-sky-400 font-mono text-xs overflow-y-auto whitespace-pre leading-relaxed min-h-[90px]">
{(() => {
  let res = '';
  for (let a = 0x0100; a <= 0x0178; a += 8) {
    const bytes = [];
    for (let i = 0; i < 8; i++) {
      const v = memRead(cpu, a + i);
      bytes.push(v.toString(16).padStart(2, '0').toUpperCase());
    }
    res += `0x${a.toString(16).toUpperCase()}:  ${bytes.join('  ')}\n`;
  }
  return res;
})()}
          </pre>
        </div>
      </div>
    </section>
  );
}

function OscilloscopePanel({ cpu, onMaximize }) {
  const canvasRef = useRef(null);
  const [scale, setScale] = useState(2);
  const historyRef = useRef([]);

  useEffect(() => {
    const pinD2 = (memRead(cpu, REG.PIND) >> 2) & 1;
    const pinD3 = (memRead(cpu, REG.PIND) >> 3) & 1;
    const pinD0 = memRead(cpu, REG.PORTD) & 1;
    const pinB5 = (memRead(cpu, REG.PORTB) >> 5) & 1;
    historyRef.current.push({ cycle: cpu.cycles, ch1: pinD2, ch2: pinD3, ch3: pinD0, ch4: pinB5 });
    if (historyRef.current.length > 500) historyRef.current.shift();
  }, [cpu.cycles]);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    const w = cvs.width, h = cvs.height;

    ctx.fillStyle = '#080a0f';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#151d2c';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    const channels = [
      { name: 'CH1: PD2 (INT0)', key: 'ch1', color: '#00e676', yBase: 50 },
      { name: 'CH2: PD3 (INT1)', key: 'ch2', color: '#38bdf8', yBase: 110 },
      { name: 'CH3: PD0 (LED)',  key: 'ch3', color: '#facc15', yBase: 170 },
      { name: 'CH4: PB5 (LED L)', key: 'ch4', color: '#f43f5e', yBase: 230 }
    ];

    channels.forEach(ch => {
      ctx.fillStyle = ch.color;
      ctx.font = 'bold 11px monospace';
      ctx.fillText(ch.name, 10, ch.yBase - 22);

      const data = historyRef.current;
      if (data.length < 2) return;

      ctx.strokeStyle = ch.color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      const step = 4 * scale;
      const startX = w - (data.length - 1) * step;

      data.forEach((pt, i) => {
        const x = Math.max(100, startX + i * step);
        const y = pt[ch.key] ? (ch.yBase - 18) : ch.yBase;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }, [cpu.cycles, scale]);

  return (
    <section className="slide-panel flex flex-col h-full bg-[#151922] border border-[#2b3346] rounded-xl overflow-hidden min-w-0">
      <div className="slide-header bg-[#181d28] border-b border-[#2b3346] px-3 py-2 flex items-center justify-between">
        <h2 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
          <ActivityIcon size={15} className="text-emerald-400" />
          <span>Логический анализатор</span>
        </h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setScale(s => Math.max(1, s - 1))} className="p-1 text-slate-400 hover:text-white"><ZoomOut size={12} /></button>
          <span className="font-mono text-[10px] text-slate-300">{scale}x</span>
          <button type="button" onClick={() => setScale(s => Math.min(5, s + 1))} className="p-1 text-slate-400 hover:text-white"><ZoomIn size={12} /></button>
          <button type="button" onClick={onMaximize} className="p-1 rounded text-slate-400 hover:text-white ml-2"><Maximize2 size={13} /></button>
        </div>
      </div>
      <div className="flex-1 p-2 bg-[#080a0f] relative overflow-hidden">
        <canvas ref={canvasRef} width={800} height={280} className="w-full h-full block rounded border border-[#1e2638]" />
      </div>
    </section>
  );
}

/* ============================================================================
 * БЛОК 9: Главный компонент
 * ============================================================================ */

function App() {
  const [currentExampleId, setCurrentExampleId] = useState('zadanie1_c');
  const [code, setCode] = useState(EXAMPLES.zadanie1_c.code);
  const [lang, setLang] = useState(EXAMPLES.zadanie1_c.lang);
  const [activeWindows, setActiveWindows] = useState(['editor', 'board', 'cpu']);
  const [cpu, setCpu] = useState(() => createCPU());
  const [vButtons, setVButtons] = useState(INITIAL_BUTTONS);
  const [components, setComponents] = useState([]);

  const compIdRef = useRef(1);
  const timerRef = useRef(null);
  const cpuRef = useRef(cpu);
  cpuRef.current = cpu;
  const buttonsRef = useRef(vButtons);
  buttonsRef.current = vButtons;
  const compRef = useRef(components);
  compRef.current = components;

  const loadProgram = useCallback((srcCode, srcLang) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const newCpu = createCPU();
    newCpu.speed = cpuRef.current.speed;
    newCpu.selectedPort = cpuRef.current.selectedPort;

    const { program, labels, error } = assembleAVR(srcCode, srcLang);
    newCpu.program = program;
    newCpu.labels = labels;
    newCpu.error = error;

    const resetButtons = buttonsRef.current.map(b => ({ ...b, pressed: false }));
    setVButtons(resetButtons);
    syncPinsAndIO(newCpu, resetButtons, compRef.current);
    setCpu({ ...newCpu });
  }, []);

  useEffect(() => { loadProgram(code, lang); }, []);

  const handleSelectExample = (id) => {
    const ex = EXAMPLES[id];
    if (ex) {
      setCurrentExampleId(id);
      setCode(ex.code);
      setLang(ex.lang);
      loadProgram(ex.code, ex.lang);
    }
  };

  const handleCodeChange = (newCode) => { setCode(newCode); loadProgram(newCode, lang); };
  const handleLangChange = (newLang) => { setLang(newLang); loadProgram(code, newLang); };

  const handleStep = useCallback(() => {
    const c = cpuRef.current;
    if (c.error) return;
    cpuStep(c);
    syncPinsAndIO(c, buttonsRef.current, compRef.current);
    setCpu({ ...c });
  }, []);

  const runLoop = useCallback(() => {
    const c = cpuRef.current;
    if (!c.running) return;
    let delay = Math.max(16, Math.floor(1000 / c.speed));
    let stepsPerTick = c.speed > 50 ? Math.round(c.speed / 50) : 1;
    for (let i = 0; i < stepsPerTick; i++) {
      const { hitBreakpoint } = cpuStep(c);
      if (!c.running || c.error || hitBreakpoint) { c.running = false; break; }
    }
    syncPinsAndIO(c, buttonsRef.current, compRef.current);
    setCpu({ ...c });
    if (c.running) timerRef.current = setTimeout(runLoop, delay);
  }, []);

  const handleToggleRun = () => {
    const c = cpuRef.current;
    if (c.error) return;
    c.running = !c.running;
    setCpu({ ...c });
    if (c.running) {
      if (timerRef.current) clearTimeout(timerRef.current);
      runLoop();
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  };

  const handleReset = () => loadProgram(code, lang);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F11') { e.preventDefault(); handleStep(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleStep]);

  const handleToggleVButton = (id) => {
    const updated = buttonsRef.current.map(b => b.id === id ? { ...b, pressed: !b.pressed } : b);
    setVButtons(updated);
    const c = cpuRef.current;
    syncPinsAndIO(c, updated, compRef.current);
    setCpu({ ...c });
  };

  const currLineNum = cpu.program[cpu.pc]?.lineNum ?? null;

  return (
    <div className="app-container flex flex-col h-screen w-screen overflow-hidden bg-[#0e1117] text-slate-100 font-sans select-none">
      <Toolbar
        examples={EXAMPLES}
        currentExampleId={currentExampleId}
        onSelectExample={handleSelectExample}
        running={cpu.running}
        onToggleRun={handleToggleRun}
        onStep={handleStep}
        onReset={handleReset}
        speed={cpu.speed}
        onChangeSpeed={s => { cpuRef.current.speed = s; setCpu({ ...cpuRef.current }); }}
        activeWindows={activeWindows}
        onSetPreset={n => {
          if (n === 1) setActiveWindows(['editor']);
          else if (n === 2) setActiveWindows(['editor', 'board']);
          else if (n === 3) setActiveWindows(['editor', 'board', 'cpu']);
          else if (n === 4) setActiveWindows(['editor', 'board', 'circuit', 'cpu']);
          else if (n === 5) setActiveWindows(['editor', 'board', 'circuit', 'cpu', 'scope']);
        }}
        onExportHex={() => downloadFile(exportIntelHex(cpu.program))}
      />

      <HintBanner hint={EXAMPLES[currentExampleId]?.hint || ''} />

      <main className="slider-viewport flex-1 h-full min-h-0 overflow-hidden p-2 sm:p-2.5">
        <div className="slider-track grid h-full gap-2 sm:gap-2.5" style={{ gridTemplateColumns: `repeat(${activeWindows.length}, minmax(0, 1fr))` }}>
          {activeWindows.includes('editor') && (
            <EditorPanel
              code={code}
              onChangeCode={handleCodeChange}
              lang={lang}
              onChangeLang={handleLangChange}
              currentLine={currLineNum}
              breakpoints={cpu.breakpoints}
              onToggleBreakpoint={ln => {
                cpu.breakpoints.has(ln) ? cpu.breakpoints.delete(ln) : cpu.breakpoints.add(ln);
                setCpu({ ...cpu });
              }}
              statusText={cpu.error ? `❌ ${cpu.error}` : `PC: 0x${cpu.pc.toString(16).toUpperCase()}`}
              isError={!!cpu.error}
              cycles={cpu.cycles}
              onClear={() => { setCode(''); loadProgram('', lang); }}
              onMaximize={() => setActiveWindows(activeWindows.length === 1 ? ['editor', 'board', 'circuit', 'cpu'] : ['editor'])}
            />
          )}

          {activeWindows.includes('board') && (
            <BoardPanel
              cpu={cpu}
              vButtons={vButtons}
              onToggleVButton={handleToggleVButton}
              onSelectPort={p => { cpuRef.current.selectedPort = p; setCpu({ ...cpuRef.current }); }}
              onClearUart={() => { cpuRef.current.uartLog = ''; setCpu({ ...cpuRef.current }); }}
              onMaximize={() => setActiveWindows(activeWindows.length === 1 ? ['editor', 'board', 'circuit', 'cpu'] : ['board'])}
            />
          )}

          {activeWindows.includes('circuit') && (
            <CircuitPanel
              cpu={cpu}
              components={components}
              onAddComponent={(type, color = 'red') => {
                const newPart = { id: compIdRef.current++, type, color, pin: type === 'button' ? 'PD2' : 'PD0', pressed: false };
                const upd = [...compRef.current, newPart];
                setComponents(upd);
                syncPinsAndIO(cpuRef.current, buttonsRef.current, upd);
                setCpu({ ...cpuRef.current });
              }}
              onRemoveComponent={id => {
                const upd = compRef.current.filter(c => c.id !== id);
                setComponents(upd);
                syncPinsAndIO(cpuRef.current, buttonsRef.current, upd);
                setCpu({ ...cpuRef.current });
              }}
              onChangePin={(id, pin) => {
                const upd = compRef.current.map(c => c.id === id ? { ...c, pin } : c);
                setComponents(upd);
                syncPinsAndIO(cpuRef.current, buttonsRef.current, upd);
                setCpu({ ...cpuRef.current });
              }}
              onToggleComponentButton={id => {
                const upd = compRef.current.map(c => c.id === id && c.type === 'button' ? { ...c, pressed: !c.pressed } : c);
                setComponents(upd);
                syncPinsAndIO(cpuRef.current, buttonsRef.current, upd);
                setCpu({ ...cpuRef.current });
              }}
              onClearCircuit={() => {
                setComponents([]);
                syncPinsAndIO(cpuRef.current, buttonsRef.current, []);
                setCpu({ ...cpuRef.current });
              }}
              onMaximize={() => setActiveWindows(activeWindows.length === 1 ? ['editor', 'board', 'circuit', 'cpu'] : ['circuit'])}
            />
          )}

          {activeWindows.includes('cpu') && (
            <CpuPanel
              cpu={cpu}
              onMaximize={() => setActiveWindows(activeWindows.length === 1 ? ['editor', 'board', 'circuit', 'cpu'] : ['cpu'])}
            />
          )}

          {activeWindows.includes('scope') && (
            <OscilloscopePanel
              cpu={cpu}
              onMaximize={() => setActiveWindows(activeWindows.length === 1 ? ['editor', 'board', 'circuit', 'cpu'] : ['scope'])}
            />
          )}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
