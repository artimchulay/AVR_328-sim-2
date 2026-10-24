/**
 * ============================================================================
 * AVR ATmega328P Web Simulator Core & Studio UI
 * Тема 5: Внешние прерывания (INT0, INT1, PCINT0..PCINT2)
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

const VECTORS = {
  RESET: 0x0000,
  INT0: 0x0002, INT1: 0x0004,
  PCINT0: 0x0006, PCINT1: 0x0008, PCINT2: 0x000A
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

/* ============================================================================
 * БЛОК 2: Примеры программ
 * ============================================================================ */
const EXAMPLES = {
  zadanie1_c: {
    id: 'zadanie1_c',
    name: '⚡ Задание 1 (Си): Переключение LED (PD0/PD1) по INT0',
    lang: 'c',
    hint: 'Нажатие K1 (PD2 / INT0) по <b>фронту</b> переключает два светодиода. Нажмите и отпустите K1.',
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
  ex1_asm: {
    id: 'ex1_asm',
    name: '📌 Пример 1 (ASM): INT1 по низкому уровню',
    lang: 'asm',
    hint: 'Прерывание INT1 (K2 / PD3) по <b>низкому уровню</b>. Пока кнопка нажата (PD3=0), PORTC сбрасывается.',
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
  }
};

/* ============================================================================
 * БЛОК 3: Утилиты и Си→ASM транслятор
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
  if (s.startsWith('$')) return parseInt(s.substring(1), 16) || 0;
  if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s.substring(2), 16) || 0;
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

function parseCExpression(expr, defines = {}) {
  if (!expr) return 0;
  let s = expr.trim();
  for (const [k, v] of Object.entries(defines)) {
    s = s.replace(new RegExp(`\\b${k}\\b`, 'g'), v);
  }
  s = s.replace(/UL|U|L/gi, '');
  try {
    return Function(`'use strict'; return (${s});`)();
  } catch {
    return 0;
  }
}

function compileCToAsm(code) {
  const lines = code.split('\n');
  const defines = {};
  const isrBlocks = {};
  const mainLines = [];
  let currentIsr = null;
  let inMain = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const cIdx = raw.indexOf('//');
    const line = (cIdx !== -1 ? raw.substring(0, cIdx) : raw).trim();
    if (!line) continue;

    const defM = line.match(/^#define\s+([a-zA-Z0-9_]+)\s+(.+)$/);
    if (defM) { defines[defM[1]] = defM[2].trim(); continue; }
    if (line.startsWith('#')) continue;

    const isrM = line.match(/^ISR\s*\(\s*([a-zA-Z0-9_]+)\s*\)/);
    if (isrM) {
      currentIsr = isrM[1];
      isrBlocks[currentIsr] = [];
      continue;
    }

    if (currentIsr) {
      if (line === '}') currentIsr = null;
      else isrBlocks[currentIsr].push({ line, lineNum: i + 1 });
      continue;
    }

    if (line.includes('int main')) { inMain = true; continue; }
    if (line === '}' && inMain) { inMain = false; continue; }

    if (inMain && line !== '{' && line !== '}') {
      mainLines.push({ line, lineNum: i + 1 });
    }
  }

  const asm = [];
  asm.push({ asm: '.include "m328pdef.inc"', lineNum: 1 });
  asm.push({ asm: '.org 0x0000', lineNum: 1 });
  asm.push({ asm: 'jmp __main_entry', lineNum: 1 });

  const vecMap = {
    INT0_vect: { org: '0x0002', label: '__isr_int0' },
    INT1_vect: { org: '0x0004', label: '__isr_int1' }
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

  const emit = (inst, lineNum) => asm.push({ asm: inst, lineNum });

  function translateCLine(item) {
    const l = item.line;
    const f = item.lineNum;
    if (l === 'sei();') { emit('sei', f); return; }

    const regOpM = l.match(/^([A-Z][A-Z0-9_]*)\s*(\|=|&=|\^=|=)\s*([^;]+);/);
    if (regOpM) {
      const rName = regOpM[1];
      const op = regOpM[2];
      const rawExpr = regOpM[3];
      const isExt = ['EICRA', 'PCICR', 'PCMSK0', 'PCMSK1', 'PCMSK2'].includes(rName);
      const val = parseCExpression(rawExpr, defines) & 0xFF;

      if (op === '=') {
        emit(`ldi r16, ${val}`, f);
        emit(isExt ? `sts ${rName}, r16` : `out ${rName}, r16`, f);
      } else if (op === '|=') {
        emit(isExt ? `lds r16, ${rName}` : `in r16, ${rName}`, f);
        emit(`ori r16, ${val}`, f);
        emit(isExt ? `sts ${rName}, r16` : `out ${rName}, r16`, f);
      } else if (op === '&=') {
        const mask = (~val) & 0xFF;
        emit(isExt ? `lds r16, ${rName}` : `in r16, ${rName}`, f);
        emit(`andi r16, ${mask}`, f);
        emit(isExt ? `sts ${rName}, r16` : `out ${rName}, r16`, f);
      } else if (op === '^=') {
        emit(isExt ? `lds r16, ${rName}` : `in r16, ${rName}`, f);
        emit(`ldi r17, ${val}`, f);
        emit(`eor r16, r17`, f);
        emit(isExt ? `sts ${rName}, r16` : `out ${rName}, r16`, f);
      }
    }
  }

  asm.push({ asm: '__main_loop:', lineNum: 1 });
  mainLines.forEach(m => translateCLine(m));
  asm.push({ asm: 'rjmp __main_loop', lineNum: 1 });

  const isrLabelMap = { INT0_vect: '__isr_int0', INT1_vect: '__isr_int1' };
  for (const [vec, block] of Object.entries(isrBlocks)) {
    const lbl = isrLabelMap[vec];
    if (!lbl) continue;
    asm.push({ asm: `${lbl}:`, lineNum: block[0]?.lineNum || 1 });
    block.forEach(b => translateCLine(b));
    asm.push({ asm: 'reti', lineNum: 1 });
  }

  return asm;
}

function assembleAVR(sourceCode, lang) {
  const instructions = [];
  const labels = {};
  if (!sourceCode) return { program: [], labels: {}, error: null };

  let rawList = [];
  if (lang === 'c') {
    try {
      rawList = compileCToAsm(sourceCode);
    } catch (e) {
      return { program: [], labels: {}, error: `C→ASM: ${e.message}` };
    }
  } else {
    sourceCode.replace(/\r/g, '').split('\n').forEach((l, idx) => {
      rawList.push({ asm: l, lineNum: idx + 1 });
    });
  }

  let currentPC = 0;
  rawList.forEach(item => {
    let t = item.asm.replace(/;.*/, '').replace(/\/\/.*/, '').trim();
    if (!t) return;
    if (t.startsWith('.org')) {
      currentPC = parseVal(t.split(/\s+/)[1]);
      return;
    }
    if (t.startsWith('.')) return;
    while (t.includes(':')) {
      const parts = t.split(':');
      labels[parts[0].trim().toLowerCase()] = currentPC;
      t = parts.slice(1).join(':').trim();
    }
    if (!t) return;
    const parts = t.split(/\s+/);
    const op = parts[0].toLowerCase();
    const argsStr = t.substring(parts[0].length).trim();
    const args = argsStr ? argsStr.split(',').map(s => s.trim()) : [];
    instructions.push({ op, args, lineNum: item.lineNum, raw: t });
    currentPC++;
  });

  return { program: instructions, labels, error: null };
}

/* ============================================================================
 * БЛОК 4: Инициализация Ядра и Компоненты UI
 * ============================================================================ */
function createCPU() {
  const ram = new Uint8Array(2304);
  return {
    r: new Uint8Array(32), prevR: new Uint8Array(32), ram,
    pc: 0, sp: 2303, sreg: { C: 0, Z: 0, N: 0, V: 0, S: 0, H: 0, T: 0, I: 0 },
    cycles: 0, running: false, speed: 40, program: [], labels: {},
    breakpoints: new Set(), uartLog: '', error: null, selectedPort: 'D',
    prevPinB: 0xFF, prevPinD: 0xFF, prevPinC: 0xFF
  };
}

function syncPinsAndIO(cpu, vButtons) {
  let inB = 0xFF, inD = 0xFF;
  vButtons.forEach(btn => {
    if (btn.pressed) {
      if (btn.port === 'B') inB &= ~(1 << btn.pin);
      if (btn.port === 'D') inD &= ~(1 << btn.pin);
    }
  });
  const ddrB = memRead(cpu, REG.DDRB), portB = memRead(cpu, REG.PORTB);
  const ddrD = memRead(cpu, REG.DDRD), portD = memRead(cpu, REG.PORTD);
  memWrite(cpu, REG.PINB, (inB & ~ddrB) | (portB & ddrB));
  memWrite(cpu, REG.PIND, (inD & ~ddrD) | (portD & ddrD));
}

function cpuStep(cpu) {
  if (cpu.error || cpu.program.length === 0 || cpu.pc >= cpu.program.length) {
    cpu.running = false;
    return;
  }
  const inst = cpu.program[cpu.pc];
  let nextPC = cpu.pc + 1;

  switch (inst.op) {
    case 'ldi': cpu.r[parseReg(inst.args[0])] = parseVal(inst.args[1], cpu.labels) & 0xFF; break;
    case 'out': memWrite(cpu, ioToMemAddr(parseVal(inst.args[0], cpu.labels)), cpu.r[parseReg(inst.args[1])]); break;
    case 'in': cpu.r[parseReg(inst.args[0])] = memRead(cpu, ioToMemAddr(parseVal(inst.args[1], cpu.labels))); break;
    case 'sbi': {
      const addr = ioToMemAddr(parseVal(inst.args[0], cpu.labels));
      memWrite(cpu, addr, memRead(cpu, addr) | (1 << parseVal(inst.args[1])));
      break;
    }
    case 'cbi': {
      const addr = ioToMemAddr(parseVal(inst.args[0], cpu.labels));
      memWrite(cpu, addr, memRead(cpu, addr) & ~(1 << parseVal(inst.args[1])));
      break;
    }
    case 'rjmp': case 'jmp': nextPC = cpu.labels[inst.args[0]?.toLowerCase()] ?? nextPC; break;
    case 'sei': cpu.sreg.I = 1; break;
    case 'cli': cpu.sreg.I = 0; break;
    case 'reti': cpu.sreg.I = 1; break;
  }
  cpu.pc = nextPC;
  cpu.cycles++;
}

/* Главный компонент App */
function App() {
  const [currentExampleId, setCurrentExampleId] = useState('zadanie1_c');
  const [code, setCode] = useState(EXAMPLES.zadanie1_c.code);
  const [lang, setLang] = useState(EXAMPLES.zadanie1_c.lang);
  const [cpu, setCpu] = useState(() => createCPU());
  const [vButtons, setVButtons] = useState(INITIAL_BUTTONS);

  const cpuRef = useRef(cpu);
  cpuRef.current = cpu;
  const buttonsRef = useRef(vButtons);
  buttonsRef.current = vButtons;
  const timerRef = useRef(null);

  const loadProgram = useCallback((src, l) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const newCpu = createCPU();
    const { program, labels, error } = assembleAVR(src, l);
    newCpu.program = program;
    newCpu.labels = labels;
    newCpu.error = error;
    syncPinsAndIO(newCpu, buttonsRef.current);
    setCpu(newCpu);
  }, []);

  useEffect(() => { loadProgram(code, lang); }, []);

  const handleStep = () => {
    const c = cpuRef.current;
    if (c.error) return;
    cpuStep(c);
    syncPinsAndIO(c, buttonsRef.current);
    setCpu({ ...c });
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0e1117] text-white font-sans select-none overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2.5 bg-[#151922] border-b border-[#2b3346]">
        <div className="flex items-center gap-2">
          <span className="text-amber-400 text-lg">⚡</span>
          <h1 className="font-bold text-sm">AVR Studio (ATmega328P)</h1>
          <select 
            value={currentExampleId} 
            onChange={e => {
              const ex = EXAMPLES[e.target.value];
              setCurrentExampleId(e.target.value);
              setCode(ex.code);
              setLang(ex.lang);
              loadProgram(ex.code, ex.lang);
            }}
            className="bg-[#1d222e] border border-[#2b3346] text-xs px-2 py-1 rounded text-white ml-4 outline-none cursor-pointer"
          >
            {Object.values(EXAMPLES).map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleStep} className="btn btn-step flex items-center gap-1">
            <SkipForward size={14} /> Шаг (F11)
          </button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-2 gap-2 p-2 overflow-hidden">
        <section className="flex flex-col bg-[#151922] border border-[#2b3346] rounded-xl overflow-hidden">
          <div className="bg-[#181d28] px-3 py-2 border-b border-[#2b3346] text-xs font-bold">Редактор кода</div>
          <textarea 
            value={code} 
            onChange={e => { setCode(e.target.value); loadProgram(e.target.value, lang); }}
            className="flex-1 bg-[#080a0f] text-slate-200 p-3 font-mono text-xs border-none outline-none resize-none"
            spellCheck="false"
          />
        </section>

        <section className="flex flex-col bg-[#151922] border border-[#2b3346] rounded-xl p-4 gap-4">
          <h2 className="text-sm font-bold">Кнопки макетной платы</h2>
          <div className="grid grid-cols-4 gap-2">
            {vButtons.map(btn => (
              <button 
                key={btn.id}
                onClick={() => {
                  const updated = buttonsRef.current.map(b => b.id === btn.id ? { ...b, pressed: !b.pressed } : b);
                  setVButtons(updated);
                  syncPinsAndIO(cpuRef.current, updated);
                  setCpu({ ...cpuRef.current });
                }}
                className={`py-3 rounded border text-xs font-bold transition-all ${btn.pressed ? 'bg-amber-400 text-black border-white' : 'bg-[#141822] text-slate-300 border-slate-700'}`}
              >
                {btn.id} ({btn.port}{btn.pin})
              </button>
            ))}
          </div>
          <div className="bg-[#080a0f] p-3 rounded border border-[#2b3346] font-mono text-xs text-emerald-400 mt-auto">
            <div>Статус: {cpu.error ? `❌ ${cpu.error}` : '✅ Работает'}</div>
            <div>Счетчик тактов: {cpu.cycles}</div>
            <div>PC: 0x{cpu.pc.toString(16).toUpperCase()}</div>
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
