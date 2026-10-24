/* =========================================================
   ЯДРО ЭМУЛЯТОРА AVR ATmega328P + SALEAE LOGIC ANALYZER
   Полная версия: Прерывания INT/PCINT, Осциллограф, Стек, C/ASM
   ========================================================= */

/* ================= ГЛАВА 1: ПАМЯТЬ И СОСТОЯНИЕ ================= */

const IO = {
    PINB:   0x23, DDRB:   0x24, PORTB:  0x25,
    PINC:   0x26, DDRC:   0x27, PORTC:  0x28,
    PIND:   0x29, DDRD:   0x2A, PORTD:  0x2B,
    PCIFR:  0x3B, EIFR:   0x3C, EIMSK:  0x3D,
    SPL:    0x5D, SPH:    0x5E, SREG:   0x5F,
    PCICR:  0x68, EICRA:  0x69,
    PCMSK0: 0x6B, PCMSK1: 0x6C, PCMSK2: 0x6D,
    UCSR0A: 0xC0, UCSR0B: 0xC1, UCSR0C: 0xC2,
    UBRR0L: 0xC4, UBRR0H: 0xC5, UDR0:   0xC6
};

const IO_OFFSET = 0x20;

let currentLang = 'asm';

const cpu = {
    r: new Uint8Array(32),
    prevR: new Uint8Array(32),
    ram: new Uint8Array(0x0900), // 0x0000..0x08FF
    pc: 0,
    sp: 0x08FF,
    sreg: { C:0, Z:0, N:0, V:0, S:0, H:0, T:0, I:0 },
    cycles: 0,
    running: false,
    timer: null,
    speed: 40,
    program: [],
    labels: {},
    breakpoints: new Set(),
    uartLog: "",
    error: null,
    selectedPort: 'D',
    memView: 'ram',
    memFormat: 'hex',
    // Для отслеживания фронтов и спадов прерываний
    prevPinB: 0xFF,
    prevPinC: 0xFF,
    prevPinD: 0xFF
};

// 8 кнопок макета: K1..K3 (PD2..PD4), K4..K8 (PB0..PB4)
const vButtons = [
    { id: 'K1', port: 'D', pin: 2, pressed: false },
    { id: 'K2', port: 'D', pin: 3, pressed: false },
    { id: 'K3', port: 'D', pin: 4, pressed: false },
    { id: 'K4', port: 'B', pin: 0, pressed: false },
    { id: 'K5', port: 'B', pin: 1, pressed: false },
    { id: 'K6', port: 'B', pin: 2, pressed: false },
    { id: 'K7', port: 'B', pin: 3, pressed: false },
    { id: 'K8', port: 'B', pin: 4, pressed: false }
];

/* ================= ГЛАВА 2: УПРАВЛЕНИЕ ВКЛАДКАМИ (РАСТЯГИВАНИЕ) ================= */

const activePanels = {
    editor: true,
    board: true,
    analyzer: true,
    cpu: false
};

function togglePanel(panelName) {
    // Не даем отключить все панели сразу (минимум 1 должна оставаться)
    const activeCount = Object.values(activePanels).filter(Boolean).length;
    if (activePanels[panelName] && activeCount <= 1) return;

    activePanels[panelName] = !activePanels[panelName];

    const panelElem = document.getElementById(`panel_${panelName}`);
    const tabBtn = document.getElementById(`tabBtn_${panelName}`);

    if (panelElem && tabBtn) {
        panelElem.classList.toggle('panel-hidden', !activePanels[panelName]);
        tabBtn.classList.toggle('active', activePanels[panelName]);
    }

    if (panelName === 'analyzer' && activePanels.analyzer) {
        setTimeout(resizeAnalyzerCanvas, 50);
    }
}

/* ================= ГЛАВА 3: ЛОГИЧЕСКИЙ АНАЛИЗАТОР (ОСЦИЛЛОГРАФ) ================= */

const analyzer = {
    capturing: true,
    zoom: 1,
    maxSamples: 1200,
    samples: [] // { cycle, ch: [pd2, pd3, pd0, pd1, pb5, pb0] }
};

function toggleAnalyzerCapture() {
    analyzer.capturing = !analyzer.capturing;
    const btn = document.getElementById('btnAnalyzerCapture');
    if (btn) {
        btn.classList.toggle('active', analyzer.capturing);
        btn.textContent = analyzer.capturing ? '🔴 Запись' : '⏸ Пауза';
    }
}

function clearAnalyzer() {
    analyzer.samples = [];
    drawLogicAnalyzer();
}

function zoomAnalyzer(delta) {
    if (delta > 0 && analyzer.zoom < 8) analyzer.zoom *= 1.5;
    if (delta < 0 && analyzer.zoom > 0.4) analyzer.zoom /= 1.5;
    document.getElementById('analyzerZoomVal').textContent = analyzer.zoom.toFixed(1) + 'x';
    drawLogicAnalyzer();
}

function recordAnalyzerSample() {
    if (!analyzer.capturing) return;

    const pind = readRAM(IO.PIND);
    const pinb = readRAM(IO.PINB);
    const portd = readRAM(IO.PORTD);
    const portb = readRAM(IO.PORTB);

    // 6 каналов: PD2(INT0), PD3(INT1), PD0(RX), PD1(TX), PB5(LED L), PB0(K4)
    const s = {
        cycle: cpu.cycles,
        ch: [
            (pind & (1 << 2)) ? 1 : 0,
            (pind & (1 << 3)) ? 1 : 0,
            (portd & (1 << 0)) ? 1 : 0,
            (portd & (1 << 1)) ? 1 : 0,
            (portb & (1 << 5)) ? 1 : 0,
            (pinb & (1 << 0)) ? 1 : 0
        ]
    };

    analyzer.samples.push(s);
    if (analyzer.samples.length > analyzer.maxSamples) {
        analyzer.samples.shift();
    }
}

function resizeAnalyzerCanvas() {
    const canvas = document.getElementById('logicCanvas');
    const wrapper = document.getElementById('canvasWrapper');
    if (!canvas || !wrapper) return;
    canvas.width = Math.max(wrapper.clientWidth, 600);
    canvas.height = Math.max(wrapper.clientHeight, 240);
    drawLogicAnalyzer();
}

function drawLogicAnalyzer() {
    const canvas = document.getElementById('logicCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, w, h);

    const chColors = ['#38bdf8', '#eab308', '#22c55e', '#f97316', '#ef4444', '#a855f7'];
    const chNames  = ['PD2', 'PD3', 'PD0', 'PD1', 'PB5', 'PB0'];
    const numChannels = 6;
    const chHeight = (h - 20) / numChannels;

    // Сетка
    ctx.strokeStyle = '#151c28';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 20) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    if (analyzer.samples.length < 2) {
        ctx.fillStyle = '#475569';
        ctx.font = '12px monospace';
        ctx.fillText('Ожидание тактов процессора для вывода сигналов...', 20, 30);
        return;
    }

    const stepX = 5 * analyzer.zoom;
    const totalVisible = Math.floor((w - 70) / stepX);
    const startIdx = Math.max(0, analyzer.samples.length - totalVisible);

    for (let c = 0; c < numChannels; c++) {
        const baseY = 25 + c * chHeight;
        const highY = baseY;
        const lowY  = baseY + chHeight - 10;

        // Линия нуля канала
        ctx.strokeStyle = '#1e293b';
        ctx.beginPath(); ctx.moveTo(55, lowY); ctx.lineTo(w, lowY); ctx.stroke();

        // Метка канала
        ctx.fillStyle = chColors[c];
        ctx.font = 'bold 11px monospace';
        ctx.fillText(chNames[c], 10, lowY - 2);

        // График сигнала
        ctx.strokeStyle = chColors[c];
        ctx.lineWidth = 2;
        ctx.beginPath();

        let prevVal = analyzer.samples[startIdx].ch[c];
        let prevX = 60;
        let prevY = prevVal ? highY : lowY;
        ctx.moveTo(prevX, prevY);

        for (let i = startIdx + 1; i < analyzer.samples.length; i++) {
            const curVal = analyzer.samples[i].ch[c];
            const curX = 60 + (i - startIdx) * stepX;
            const curY = curVal ? highY : lowY;

            if (curVal !== prevVal) {
                ctx.lineTo(curX, prevY); // Горизонтально до момента скачка
                ctx.lineTo(curX, curY); // Вертикальный фронт/спад
            } else {
                ctx.lineTo(curX, curY);
            }
            prevVal = curVal;
            prevX = curX;
            prevY = curY;
        }
        ctx.stroke();
    }
}

/* ================= ГЛАВА 4: ТРАНСЛЯТОР MICRO-C ================= */

function evaluateCExpression(expr, defines) {
    if (!expr) return 0;
    expr = expr.trim();
    if (defines) {
        for (const [k, v] of Object.entries(defines)) {
            expr = expr.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
        }
    }
    expr = expr.replace(/\bDDD([0-7])\b/g, '$1')
               .replace(/\bDDB([0-7])\b/g, '$1')
               .replace(/\bDDC([0-7])\b/g, '$1')
               .replace(/\bPORTD([0-7])\b/g, '$1')
               .replace(/\bPORTB([0-7])\b/g, '$1')
               .replace(/\bPORTC([0-7])\b/g, '$1')
               .replace(/\bPIND([0-7])\b/g, '$1')
               .replace(/\bPINB([0-7])\b/g, '$1')
               .replace(/\bPINC([0-7])\b/g, '$1')
               .replace(/UL|U|L/gi, '');

    if (/^[0-9xXa-fA-F<>&|^~()+ \t-]+$/.test(expr)) {
        try {
            return Function(`'use strict'; return (${expr});`)();
        } catch (e) {}
    }
    return null;
}

function compileCToAsm(cCode) {
    const rawLines = cCode.split('\n');
    const asmList = [];
    let regCounter = 17;
    const varMap = {};
    let labelCounter = 1;
    const controlStack = [];
    const defines = {};

    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i].trim();
        const defMatch = line.match(/^#define\s+([a-zA-Z0-9_]+)\s+(.+)$/);
        if (defMatch) {
            defines[defMatch[1]] = defMatch[2].replace(/UL|U|L/gi, '').trim();
        }
    }

    function applyDefines(str) {
        for (const [k, v] of Object.entries(defines)) {
            str = str.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
        }
        return str;
    }

    asmList.push({ asm: '.include "m328pdef.inc"', lineNum: 1 });

    for (let i = 0; i < rawLines.length; i++) {
        let line = rawLines[i];
        const slashIdx = line.indexOf('//');
        if (slashIdx !== -1) line = line.substring(0, slashIdx);
        line = line.trim();
        const lineNum = i + 1;

        if (!line || line.startsWith('#') || line.startsWith('/*') || line.includes('main(')) continue;

        if (line.includes('sei()')) { asmList.push({ asm: 'sei', lineNum }); continue; }
        if (line.includes('cli()')) { asmList.push({ asm: 'cli', lineNum }); continue; }

        if (line === '}' || line.startsWith('}')) {
            if (controlStack.length > 0) {
                const top = controlStack.pop();
                if (top.type === 'if') {
                    asmList.push({ asm: `${top.lblFalse}:`, lineNum });
                    if (top.lblEnd) asmList.push({ asm: `${top.lblEnd}:`, lineNum });
                } else if (top.type === 'else') {
                    asmList.push({ asm: `${top.lblEnd}:`, lineNum });
                } else if (top.type === 'while') {
                    asmList.push({ asm: `rjmp ${top.startLbl}`, lineNum });
                }
            }
            if (line === '}') continue;
            line = line.substring(1).trim();
            if (!line) continue;
        }

        if (line.startsWith('else')) {
            if (controlStack.length > 0 && controlStack[controlStack.length - 1].type === 'if') {
                const prevIf = controlStack.pop();
                const lblEnd = `lbl_end_${labelCounter++}`;
                asmList.push({ asm: `rjmp ${lblEnd}`, lineNum });
                asmList.push({ asm: `${prevIf.lblFalse}:`, lineNum });
                controlStack.push({ type: 'else', lblEnd });
            }
            line = line.substring(4).trim();
            if (!line || line === '{') continue;
        }

        if (line === '{') continue;

        // Переменные
        const declMatch = line.match(/\b(uint8_t|int8_t|uint16_t|int16_t|uint32_t|int)\s+([a-zA-Z0-9_]+)(\s*=\s*([^;]+))?;/);
        if (declMatch) {
            const varName = declMatch[2];
            let initVal = declMatch[4] ? declMatch[4].trim() : "0";
            const reg = 'r' + (regCounter++);
            varMap[varName] = { reg };
            const constVal = evaluateCExpression(applyDefines(initVal), defines);
            if (constVal !== null) {
                asmList.push({ asm: `ldi ${reg}, ${constVal & 0xFF}`, lineNum });
            }
            continue;
        }

        // Регистры прерываний и порты (EICRA, PCICR, PCMSK, DDR, PORT)
        const portOrMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|DDRC|PORTC|PCICR|EICRA)\s*\|\=\s*([^;]+);/);
        if (portOrMatch) {
            const portName = portOrMatch[1];
            const mask = evaluateCExpression(applyDefines(portOrMatch[2]), defines) & 0xFF;
            asmList.push({ asm: `in r16, ${portName}`, lineNum });
            asmList.push({ asm: `ori r16, ${mask}`, lineNum });
            asmList.push({ asm: `out ${portName}, r16`, lineNum });
            continue;
        }

        const portAndNotMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|DDRC|PORTC)\s*&\=\s*~\s*\(?\s*([^;]+)\)?;/);
        if (portAndNotMatch) {
            const portName = portAndNotMatch[1];
            const mask = evaluateCExpression(applyDefines(portAndNotMatch[2].replace(/\)+$/, '')), defines) & 0xFF;
            const invMask = (~mask) & 0xFF;
            asmList.push({ asm: `in r16, ${portName}`, lineNum });
            asmList.push({ asm: `andi r16, ${invMask}`, lineNum });
            asmList.push({ asm: `out ${portName}, r16`, lineNum });
            continue;
        }

        const portXorMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD)\s*\^\=\s*([^;]+);/);
        if (portXorMatch) {
            const portName = portXorMatch[1];
            const mask = evaluateCExpression(applyDefines(portXorMatch[2]), defines) & 0xFF;
            asmList.push({ asm: `in r16, ${portName}`, lineNum });
            asmList.push({ asm: `ldi r17, ${mask}`, lineNum });
            asmList.push({ asm: `eor r16, r17`, lineNum });
            asmList.push({ asm: `out ${portName}, r16`, lineNum });
            continue;
        }

        const portAssignMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|DDRC|PORTC|EICRA|EIMSK|PCICR|PCMSK0|PCMSK2)\s*=\s*([^;]+);/);
        if (portAssignMatch) {
            const portName = portAssignMatch[1];
            const constVal = evaluateCExpression(applyDefines(portAssignMatch[2].trim()), defines);
            if (constVal !== null) {
                asmList.push({ asm: `ldi r16, ${constVal & 0xFF}`, lineNum });
                asmList.push({ asm: `out ${portName}, r16`, lineNum });
            }
            continue;
        }

        // Ожидание отпускания кнопки: while (!(PIND & (1 << PIND2)));
        const waitRelMatch = line.match(/while\s*\(\s*!\s*\(\s*(PINB|PIND)\s*&\s*\(\s*1\s*<<\s*([^)]+)\)\s*\)\s*\);/);
        if (waitRelMatch) {
            const pinPort = waitRelMatch[1];
            const bit = evaluateCExpression(applyDefines(waitRelMatch[2]), defines);
            const waitLbl = `wait_rel_${labelCounter++}`;
            asmList.push({ asm: `${waitLbl}:`, lineNum });
            asmList.push({ asm: `in r16, ${pinPort}`, lineNum });
            asmList.push({ asm: `sbrs r16, ${bit}`, lineNum });
            asmList.push({ asm: `rjmp ${waitLbl}`, lineNum });
            continue;
        }

        // Опрос кнопки if (!(PIND & (1 << 2)))
        let ifBtnMatch = line.match(/if\s*\(\s*!\s*\(\s*(PINB|PIND)\s*&\s*\(\s*1\s*<<\s*([^)]+)\)\s*\)\s*\)/);
        let pinPort = '', bit = 0;
        if (ifBtnMatch) {
            pinPort = ifBtnMatch[1];
            bit = evaluateCExpression(applyDefines(ifBtnMatch[2]), defines);
        } else {
            const altBtn = line.match(/if\s*\(\s*\(\s*(PINB|PIND)\s*&\s*([^)]+)\)\s*==\s*0[xX]?0*\s*\)/);
            if (altBtn) {
                pinPort = altBtn[1];
                const mask = evaluateCExpression(applyDefines(altBtn[2]), defines);
                bit = Math.log2(mask) || 0;
                ifBtnMatch = true;
            }
        }

        if (ifBtnMatch) {
            const lblFalse = `lbl_skip_${labelCounter++}`;
            asmList.push({ asm: `in r16, ${pinPort}`, lineNum });
            asmList.push({ asm: `sbrc r16, ${bit}`, lineNum });
            asmList.push({ asm: `rjmp ${lblFalse}`, lineNum });
            controlStack.push({ type: 'if', lblFalse });
            continue;
        }

        if (line.startsWith('while') && line.includes('1')) {
            const startLbl = `while_start_${labelCounter++}`;
            asmList.push({ asm: `${startLbl}:`, lineNum });
            controlStack.push({ type: 'while', startLbl });
            continue;
        }

        if (line.includes('_delay_')) {
            asmList.push({ asm: 'nop', lineNum });
            continue;
        }
    }

    while (controlStack.length > 0) {
        const top = controlStack.pop();
        if (top.type === 'while') asmList.push({ asm: `rjmp ${top.startLbl}`, lineNum: rawLines.length });
        else if (top.type === 'if') asmList.push({ asm: `${top.lblFalse}:`, lineNum: rawLines.length });
        else if (top.type === 'else') asmList.push({ asm: `${top.lblEnd}:`, lineNum: rawLines.length });
    }

    return asmList;
}

/* ================= ГЛАВА 5: ПАРСЕР АССЕМБЛЕРА И ВЕКТОРЫ ================= */

function parseProgram(text) {
    cpu.program = [];
    cpu.labels = {};
    cpu.error = null;
    if (!text) return;
    text = text.replace(/\r/g, '');

    if (currentLang === 'c') {
        const compiled = compileCToAsm(text);
        let instIndex = 0;
        for (let item of compiled) {
            let line = item.asm.trim();
            if (line.includes(':')) {
                const parts = line.split(':');
                cpu.labels[parts[0].trim().toLowerCase()] = instIndex;
                line = parts.slice(1).join(':').trim();
                if (!line) continue;
            }
            const tokens = line.split(/\s+/);
            const op = tokens[0].toLowerCase();
            const argsStr = line.substring(tokens[0].length).trim();
            const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];
            cpu.program.push({ op, args, lineNum: item.lineNum, raw: line });
            instIndex++;
        }
        return;
    }

    const lines = text.split('\n');
    let instIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const semi = line.indexOf(';');
        const slash = line.indexOf('//');
        let idx = -1;
        if (semi !== -1 && slash !== -1) idx = Math.min(semi, slash);
        else if (semi !== -1) idx = semi;
        else if (slash !== -1) idx = slash;
        if (idx !== -1) line = line.substring(0, idx);
        line = line.trim();
        if (!line) continue;

        // Поддержка директивы размещения векторов .org 0x0004
        if (line.toLowerCase().startsWith('.org')) {
            const orgVal = parseVal(line.substring(4).trim());
            // Дополняем nop до адреса orgVal
            while (instIndex < orgVal) {
                cpu.program.push({ op: 'nop', args: [], lineNum: i + 1, raw: 'nop' });
                instIndex++;
            }
            continue;
        }

        if (line.includes(':')) {
            const parts = line.split(':');
            cpu.labels[parts[0].trim().toLowerCase()] = instIndex;
            line = parts.slice(1).join(':').trim();
            if (!line) continue;
        }

        if (line.startsWith('.')) continue;

        const tokens = line.split(/\s+/);
        const op = tokens[0].toLowerCase();
        const argsStr = line.substring(tokens[0].length).trim();
        const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];

        if (op === 'ldi' && args.length >= 1) {
            const regNum = parseReg(args[0]);
            if (regNum < 16) {
                cpu.error = `Строка ${i + 1}: LDI работает только с R16..R31 (R${regNum} недопустим)`;
            }
        }

        cpu.program.push({ op, args, lineNum: i + 1, raw: line });
        instIndex++;
    }
}

function parseReg(arg) {
    if (!arg) return 0;
    arg = arg.trim().toLowerCase();
    const aliases = { 'xl': 26, 'xh': 27, 'yl': 28, 'yh': 29, 'zl': 30, 'zh': 31 };
    if (aliases[arg] !== undefined) return aliases[arg];
    const clean = arg.replace(/[^0-9]/g, '');
    return Math.min(31, Math.max(0, parseInt(clean, 10) || 0));
}

function parseVal(arg) {
    if (!arg) return 0;
    arg = arg.trim().toLowerCase();
    if (arg === 'ramend') return 0x08FF;
    if (arg.includes('low(ramend)')) return 0xFF;
    if (arg.includes('high(ramend)')) return 0x08;

    const upper = arg.toUpperCase();
    if (IO[upper] !== undefined) {
        return IO[upper] < 0x60 ? IO[upper] - IO_OFFSET : IO[upper];
    }

    if (arg.startsWith('$')) return parseInt(arg.substring(1), 16) || 0;
    if (arg.startsWith('0x')) return parseInt(arg.substring(2), 16) || 0;
    if (arg.startsWith('0b')) return parseInt(arg.substring(2), 2) || 0;
    const dec = parseInt(arg, 10);
    return isNaN(dec) ? 0 : dec;
}

function resolveIoRamAddr(token) {
    if (!token) return 0;
    const upper = token.trim().toUpperCase();
    if (IO[upper] !== undefined) return IO[upper];
    const num = parseVal(token);
    return (num >= 0 && num <= 0x3F) ? num + IO_OFFSET : num;
}

function resolveDataRamAddr(token) {
    if (!token) return 0;
    const upper = token.trim().toUpperCase();
    return IO[upper] !== undefined ? IO[upper] : parseVal(token);
}

function writeRAM(addr, val) {
    val &= 0xFF;
    if (addr >= 0 && addr < cpu.ram.length) {
        cpu.ram[addr] = val;
        if (addr >= 0 && addr < 32) cpu.r[addr] = val;
        if (addr === IO.SPL) cpu.sp = (cpu.sp & 0xFF00) | val;
        else if (addr === IO.SPH) cpu.sp = (cpu.sp & 0x00FF) | (val << 8);
        else if (addr === IO.UDR0) cpu.uartLog += String.fromCharCode(val);
    }
}

function readRAM(addr) {
    if (addr >= 0 && addr < 32) return cpu.r[addr];
    if (addr >= 0 && addr < cpu.ram.length) return cpu.ram[addr];
    return 0;
}

function pushStack(val) {
    writeRAM(cpu.sp, val & 0xFF);
    cpu.sp = (cpu.sp - 1) & 0xFFFF;
}

function popStack() {
    cpu.sp = (cpu.sp + 1) & 0xFFFF;
    return readRAM(cpu.sp);
}

function getPointerAddr(name) {
    name = name.toLowerCase();
    if (name.includes('x')) return (cpu.r[27] << 8) | cpu.r[26];
    if (name.includes('y')) return (cpu.r[29] << 8) | cpu.r[28];
    if (name.includes('z')) return (cpu.r[31] << 8) | cpu.r[30];
    return 0;
}

function setPointerAddr(name, val) {
    name = name.toLowerCase();
    val &= 0xFFFF;
    if (name.includes('x')) { cpu.r[26] = val & 0xFF; cpu.r[27] = (val >> 8) & 0xFF; }
    else if (name.includes('y')) { cpu.r[28] = val & 0xFF; cpu.r[29] = (val >> 8) & 0xFF; }
    else if (name.includes('z')) { cpu.r[30] = val & 0xFF; cpu.r[31] = (val >> 8) & 0xFF; }
}

/* ================= ГЛАВА 6: СИСТЕМА ПРЕРЫВАНИЙ AVR ================= */

function checkInterrupts() {
    const curPind = readRAM(IO.PIND);
    const curPinb = readRAM(IO.PINB);
    const eicra = readRAM(IO.EICRA);
    let eifr = readRAM(IO.EIFR);
    let pcifr = readRAM(IO.PCIFR);

    // INT0 (PD2): ISC01, ISC00
    const isc0 = eicra & 0x03;
    const pd2Now = (curPind >> 2) & 1;
    const pd2Prev = (cpu.prevPinD >> 2) & 1;

    if (isc0 === 0 && pd2Now === 0) eifr |= (1 << 0); // Низкий уровень
    else if (isc0 === 1 && pd2Now !== pd2Prev) eifr |= (1 << 0); // Любой фронт
    else if (isc0 === 2 && pd2Prev === 1 && pd2Now === 0) eifr |= (1 << 0); // Спад
    else if (isc0 === 3 && pd2Prev === 0 && pd2Now === 1) eifr |= (1 << 0); // Фронт

    // INT1 (PD3): ISC11, ISC10
    const isc1 = (eicra >> 2) & 0x03;
    const pd3Now = (curPind >> 3) & 1;
    const pd3Prev = (cpu.prevPinD >> 3) & 1;

    if (isc1 === 0 && pd3Now === 0) eifr |= (1 << 1);
    else if (isc1 === 1 && pd3Now !== pd3Prev) eifr |= (1 << 1);
    else if (isc1 === 2 && pd3Prev === 1 && pd3Now === 0) eifr |= (1 << 1);
    else if (isc1 === 3 && pd3Prev === 0 && pd3Now === 1) eifr |= (1 << 1);

    writeRAM(IO.EIFR, eifr);

    // PCINT0 (PB) и PCINT2 (PD)
    const pcmsk0 = readRAM(IO.PCMSK0);
    const pcmsk2 = readRAM(IO.PCMSK2);

    if ((curPinb ^ cpu.prevPinB) & pcmsk0) pcifr |= (1 << 0);
    if ((curPind ^ cpu.prevPinD) & pcmsk2) pcifr |= (1 << 2);

    writeRAM(IO.PCIFR, pcifr);

    // Если глобальные прерывания разрешены (бит I в SREG)
    if (cpu.sreg.I === 1) {
        const eimsk = readRAM(IO.EIMSK);
        const pcicr = readRAM(IO.PCICR);

        // Приоритет 1: INT0 (Вектор 0x0002)
        if ((eimsk & 0x01) && (eifr & 0x01)) {
            writeRAM(IO.EIFR, eifr & ~0x01);
            dispatchInterrupt(0x0002);
            return;
        }
        // Приоритет 2: INT1 (Вектор 0x0004)
        if ((eimsk & 0x02) && (eifr & 0x02)) {
            writeRAM(IO.EIFR, eifr & ~0x02);
            dispatchInterrupt(0x0004);
            return;
        }
        // Приоритет 3: PCINT0 (Вектор 0x0006)
        if ((pcicr & 0x01) && (pcifr & 0x01)) {
            writeRAM(IO.PCIFR, pcifr & ~0x01);
            dispatchInterrupt(0x0006);
            return;
        }
        // Приоритет 4: PCINT2 (Вектор 0x000A)
        if ((pcicr & 0x04) && (pcifr & 0x04)) {
            writeRAM(IO.PCIFR, pcifr & ~0x04);
            dispatchInterrupt(0x000A);
            return;
        }
    }
}

function dispatchInterrupt(vectorAddr) {
    // Сохраняем адрес возврата (PC) в стек
    pushStack(cpu.pc & 0xFF);
    pushStack((cpu.pc >> 8) & 0xFF);

    // Аппаратно сбрасываем бит I в SREG
    cpu.sreg.I = 0;

    // Переходим к вектору прерывания
    cpu.pc = Math.min(vectorAddr, cpu.program.length ? cpu.program.length - 1 : 0);
}

/* ================= ГЛАВА 7: ВЫЧИСЛИТЕЛЬНОЕ ЯДРО (АЛУ) ================= */

function setFlagsAdd(a, b, res) {
    cpu.sreg.H = (((a & 0x0F) + (b & 0x0F)) > 0x0F) ? 1 : 0;
    cpu.sreg.C = (res > 0xFF) ? 1 : 0;
    cpu.sreg.Z = ((res & 0xFF) === 0) ? 1 : 0;
    cpu.sreg.N = (res & 0x80) ? 1 : 0;
    cpu.sreg.V = (!((a ^ b) & 0x80) && ((a ^ res) & 0x80)) ? 1 : 0;
    cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
}

function setFlagsSub(a, b, res) {
    b &= 0xFF;
    cpu.sreg.H = (((a & 0x0F) - (b & 0x0F)) < 0) ? 1 : 0;
    cpu.sreg.C = (a < b) ? 1 : 0;
    cpu.sreg.Z = ((res & 0xFF) === 0) ? 1 : 0;
    cpu.sreg.N = (res & 0x80) ? 1 : 0;
    cpu.sreg.V = (((a ^ b) & 0x80) && ((a ^ res) & 0x80)) ? 1 : 0;
    cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
}

function setFlagsLogic(val) {
    cpu.sreg.Z = ((val & 0xFF) === 0) ? 1 : 0;
    cpu.sreg.N = (val & 0x80) ? 1 : 0;
    cpu.sreg.V = 0;
    cpu.sreg.S = cpu.sreg.N;
}

function cpuStep() {
    if (cpu.error) { haltExecution(); updateUI(); return; }

    if (cpu.program.length === 0) parseProgram(document.getElementById('asmCode').value);
    if (cpu.program.length === 0 || cpu.error || cpu.pc >= cpu.program.length) {
        haltExecution(); updateUI(); return;
    }

    cpu.prevR.set(cpu.r);
    const inst = cpu.program[cpu.pc];
    const op = inst.op;
    const a = inst.args;
    let nextPC = cpu.pc + 1;

    if (op === 'break') { haltExecution(); updateUI(); return; }

    switch (op) {
        case 'ldi': { cpu.r[parseReg(a[0])] = parseVal(a[1]) & 0xFF; break; }
        case 'mov': { cpu.r[parseReg(a[0])] = cpu.r[parseReg(a[1])]; break; }
        case 'in': {
            const addr = resolveIoRamAddr(a[1]);
            cpu.r[parseReg(a[0])] = readRAM(addr); break;
        }
        case 'out': {
            const addr = resolveIoRamAddr(a[0]);
            writeRAM(addr, cpu.r[parseReg(a[1])]); break;
        }
        case 'lds': {
            const addr = resolveDataRamAddr(a[1]);
            cpu.r[parseReg(a[0])] = readRAM(addr); break;
        }
        case 'sts': {
            const addr = resolveDataRamAddr(a[0]);
            writeRAM(addr, cpu.r[parseReg(a[1])]); break;
        }
        case 'ld': {
            let addr = getPointerAddr(a[1].replace('+', '').replace('-', ''));
            if (a[1].includes('-')) { addr--; setPointerAddr(a[1].replace('-', ''), addr); }
            cpu.r[parseReg(a[0])] = readRAM(addr);
            if (a[1].includes('+')) setPointerAddr(a[1].replace('+', ''), addr + 1); break;
        }
        case 'st': {
            let addr = getPointerAddr(a[0].replace('+', '').replace('-', ''));
            if (a[0].includes('-')) { addr--; setPointerAddr(a[0].replace('-', ''), addr); }
            writeRAM(addr, cpu.r[parseReg(a[1])]);
            if (a[0].includes('+')) setPointerAddr(a[0].replace('+', ''), addr + 1); break;
        }
        case 'push': { pushStack(cpu.r[parseReg(a[0])]); break; }
        case 'pop':  { cpu.r[parseReg(a[0])] = popStack(); break; }
        case 'call': {
            pushStack(nextPC & 0xFF);
            pushStack((nextPC >> 8) & 0xFF);
            if (cpu.labels[a[0].toLowerCase()] !== undefined) nextPC = cpu.labels[a[0].toLowerCase()];
            break;
        }
        case 'ret': {
            const high = popStack();
            const low = popStack();
            nextPC = (high << 8) | low;
            break;
        }
        case 'reti': {
            const high = popStack();
            const low = popStack();
            nextPC = (high << 8) | low;
            cpu.sreg.I = 1; // Автоматическое восстановление глобальных прерываний
            break;
        }
        case 'sei': { cpu.sreg.I = 1; break; }
        case 'cli': { cpu.sreg.I = 0; break; }
        case 'add': {
            const r1 = parseReg(a[0]), r2 = parseReg(a[1]);
            const res = cpu.r[r1] + cpu.r[r2];
            setFlagsAdd(cpu.r[r1], cpu.r[r2], res);
            cpu.r[r1] = res & 0xFF; break;
        }
        case 'adc': {
            const r1 = parseReg(a[0]), r2 = parseReg(a[1]);
            const res = cpu.r[r1] + cpu.r[r2] + cpu.sreg.C;
            setFlagsAdd(cpu.r[r1], cpu.r[r2], res);
            cpu.r[r1] = res & 0xFF; break;
        }
        case 'sub': {
            const r1 = parseReg(a[0]), r2 = parseReg(a[1]);
            const res = cpu.r[r1] - cpu.r[r2];
            setFlagsSub(cpu.r[r1], cpu.r[r2], res);
            cpu.r[r1] = res & 0xFF; break;
        }
        case 'subi': {
            const r1 = parseReg(a[0]);
            const k = parseVal(a[1]) & 0xFF;
            const res = cpu.r[r1] - k;
            setFlagsSub(cpu.r[r1], k, res);
            cpu.r[r1] = res & 0xFF; break;
        }
        case 'inc': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const res = (prev + 1) & 0xFF;
            cpu.r[reg] = res;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = (prev === 0x7F) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'dec': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const res = (prev - 1) & 0xFF;
            cpu.r[reg] = res;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = (prev === 0x80) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'neg': {
            const reg = parseReg(a[0]);
            const val = cpu.r[reg];
            const res = (0 - val) & 0xFF;
            cpu.sreg.H = (((0 - (val & 0x0F)) < 0) ? 1 : 0);
            cpu.sreg.C = (res !== 0) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = (val === 0x80) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
            cpu.r[reg] = res; break;
        }
        case 'and': {
            const reg = parseReg(a[0]);
            cpu.r[reg] &= cpu.r[parseReg(a[1])];
            setFlagsLogic(cpu.r[reg]); break;
        }
        case 'andi': {
            const reg = parseReg(a[0]);
            cpu.r[reg] &= (parseVal(a[1]) & 0xFF);
            setFlagsLogic(cpu.r[reg]); break;
        }
        case 'or': {
            const reg = parseReg(a[0]);
            cpu.r[reg] |= cpu.r[parseReg(a[1])];
            setFlagsLogic(cpu.r[reg]); break;
        }
        case 'ori': {
            const reg = parseReg(a[0]);
            cpu.r[reg] |= (parseVal(a[1]) & 0xFF);
            setFlagsLogic(cpu.r[reg]); break;
        }
        case 'eor': {
            const reg = parseReg(a[0]);
            cpu.r[reg] ^= cpu.r[parseReg(a[1])];
            setFlagsLogic(cpu.r[reg]); break;
        }
        case 'clr': {
            const reg = parseReg(a[0]);
            cpu.r[reg] = 0; setFlagsLogic(0); break;
        }
        case 'ser': { cpu.r[parseReg(a[0])] = 0xFF; break; }
        case 'sbi': {
            const addr = resolveIoRamAddr(a[0]);
            writeRAM(addr, readRAM(addr) | (1 << parseVal(a[1]))); break;
        }
        case 'cbi': {
            const addr = resolveIoRamAddr(a[0]);
            writeRAM(addr, readRAM(addr) & ~(1 << parseVal(a[1]))); break;
        }
        case 'cpi': {
            const k = parseVal(a[1]) & 0xFF;
            setFlagsSub(cpu.r[parseReg(a[0])], k, cpu.r[parseReg(a[0])] - k); break;
        }
        case 'cp': {
            setFlagsSub(cpu.r[parseReg(a[0])], cpu.r[parseReg(a[1])], cpu.r[parseReg(a[0])] - cpu.r[parseReg(a[1])]); break;
        }
        case 'sbrs': {
            if ((cpu.r[parseReg(a[0])] & (1 << parseVal(a[1]))) !== 0) nextPC++; break;
        }
        case 'sbrc': {
            if ((cpu.r[parseReg(a[0])] & (1 << parseVal(a[1]))) === 0) nextPC++; break;
        }
        case 'jmp':
        case 'rjmp': { if (cpu.labels[a[0].toLowerCase()] !== undefined) nextPC = cpu.labels[a[0].toLowerCase()]; break; }
        case 'breq': { if (cpu.sreg.Z === 1) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brne': { if (cpu.sreg.Z === 0) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brcs':
        case 'brlo': { if (cpu.sreg.C === 1) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brcc':
        case 'brsh': { if (cpu.sreg.C === 0) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'sec': { cpu.sreg.C = 1; break; }
        case 'clc': { cpu.sreg.C = 0; break; }
        case 'sez': { cpu.sreg.Z = 1; break; }
        case 'clz': { cpu.sreg.Z = 0; break; }
        case 'nop': { break; }
    }

    cpu.pc = nextPC;
    cpu.cycles++;

    syncHardwareState();
    checkInterrupts();
    recordAnalyzerSample();
    updateUI();

    if (cpu.running && cpu.pc < cpu.program.length) {
        if (cpu.breakpoints.has(cpu.program[cpu.pc].lineNum)) {
            haltExecution();
            updateUI();
        }
    }
}

/* ================= ГЛАВА 8: ЖЕЛЕЗО И ПЛАТА ================= */

function toggleVButton(id) {
    const btn = vButtons.find(b => b.id === id);
    if (!btn) return;
    btn.pressed = !btn.pressed;
    document.getElementById('vbtn_' + id)?.classList.toggle('latched', btn.pressed);

    syncHardwareState();
    checkInterrupts();
    recordAnalyzerSample();
    updateUI();
}

function syncHardwareState() {
    cpu.prevPinB = readRAM(IO.PINB);
    cpu.prevPinC = readRAM(IO.PINC);
    cpu.prevPinD = readRAM(IO.PIND);

    let pinb = 0xFF; let pind = 0xFF; let pinc = 0xFF;
    vButtons.forEach(btn => {
        if (btn.pressed) {
            if (btn.port === 'B') pinb &= ~(1 << btn.pin);
            if (btn.port === 'D') pind &= ~(1 << btn.pin);
            if (btn.port === 'C') pinc &= ~(1 << btn.pin);
        }
    });

    const ddrb = readRAM(IO.DDRB); const portb = readRAM(IO.PORTB);
    const ddrd = readRAM(IO.DDRD); const portd = readRAM(IO.PORTD);
    const ddrc = readRAM(IO.DDRC); const portc = readRAM(IO.PORTC);

    pinb = (pinb & ~ddrb) | (portb & ddrb);
    pind = (pind & ~ddrd) | (portd & ddrd);
    pinc = (pinc & ~ddrc) | (portc & ddrc);

    writeRAM(IO.PINB, pinb);
    writeRAM(IO.PIND, pind);
    writeRAM(IO.PINC, pinc);

    writeRAM(IO.SPL, cpu.sp & 0xFF);
    writeRAM(IO.SPH, (cpu.sp >> 8) & 0xFF);

    let sregByte = 0;
    const flags = ['C','Z','N','V','S','H','T','I'];
    flags.forEach((f, idx) => { if (cpu.sreg[f]) sregByte |= (1 << idx); });
    cpu.ram[IO.SREG] = sregByte;

    for (let i = 0; i < 32; i++) cpu.ram[i] = cpu.r[i];
}

function selectLedPort(portLetter) {
    cpu.selectedPort = portLetter;
    document.querySelectorAll('.port-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('btnPort' + portLetter)?.classList.add('active');
    document.getElementById('ledPortTitle').textContent = `Линейка светодиодов (Порт ${portLetter})`;
    renderHardware();
}

function renderHardware() {
    const isPB5On = (readRAM(IO.PORTB) & (1 << 5)) !== 0;
    const ledPB5 = document.getElementById('ledPB5');
    if (ledPB5) {
        ledPB5.className = 'led-light ' + (isPB5On ? 'active-led-yellow' : '');
    }

    let currentVal = 0;
    if (cpu.selectedPort === 'D') currentVal = readRAM(IO.PORTD);
    if (cpu.selectedPort === 'B') currentVal = readRAM(IO.PORTB);
    if (cpu.selectedPort === 'C') currentVal = readRAM(IO.PORTC);

    for (let i = 7; i >= 0; i--) {
        const led = document.getElementById(`ledPin${i}`);
        const bitLbl = document.getElementById(`lblPin${i}`);
        if (led && bitLbl) {
            bitLbl.textContent = `${cpu.selectedPort}${i}`;
            led.className = 'led-light ' + ((currentVal & (1 << i)) !== 0 ? 'active-led-green' : '');
        }
    }

    const term = document.getElementById('uartTerminal');
    if (term && term.textContent !== cpu.uartLog) {
        term.textContent = cpu.uartLog || "UART готов к приёму данных...";
        term.scrollTop = term.scrollHeight;
    }
}

function clearUart() { cpu.uartLog = ""; renderHardware(); }

/* ================= ГЛАВА 9: ИГРОВОЙ ЦИКЛ ================= */

function haltExecution() {
    cpu.running = false; clearTimeout(cpu.timer);
    document.getElementById('btnRun')?.classList.remove('running');
    document.getElementById('runIcon').textContent = '▶';
    document.getElementById('runText').textContent = 'Пуск';
}

function toggleRun() {
    if (cpu.error) return;
    cpu.running = !cpu.running;
    const btn = document.getElementById('btnRun');
    if (cpu.running) {
        btn.classList.add('running');
        document.getElementById('runIcon').textContent = '⏸';
        document.getElementById('runText').textContent = 'Пауза';
        runLoop();
    } else haltExecution();
}

function runLoop() {
    if (!cpu.running) return;
    let delay = 20; let batchSize = 1;
    if (cpu.speed <= 50) {
        delay = Math.max(16, Math.floor(1000 / cpu.speed)); batchSize = 1;
    } else {
        delay = 20; batchSize = Math.max(1, Math.round(cpu.speed / 50));
    }
    for (let i = 0; i < batchSize; i++) {
        cpuStep();
        if (!cpu.running || cpu.error) { haltExecution(); break; }
    }
    if (cpu.running) cpu.timer = setTimeout(runLoop, delay);
}

function cpuReset() {
    haltExecution();
    cpu.r.fill(0); cpu.prevR.fill(0); cpu.ram.fill(0);
    cpu.pc = 0; cpu.sp = 0x08FF; cpu.cycles = 0;
    cpu.sreg = { C:0, Z:0, N:0, V:0, S:0, H:0, T:0, I:0 };
    cpu.uartLog = "";

    vButtons.forEach(btn => {
        btn.pressed = false;
        document.getElementById('vbtn_' + btn.id)?.classList.remove('latched');
    });

    parseProgram(document.getElementById('asmCode').value);
    syncHardwareState();
    clearAnalyzer();
    updateUI();
}

function updateSpeed(val) {
    cpu.speed = parseInt(val, 10);
    document.getElementById('speedVal').textContent = cpu.speed + ' оп/с';
}

/* ================= ГЛАВА 10: ДАМП ПАМЯТИ И UI ================= */

function setMemView(view) {
    cpu.memView = view;
    document.getElementById('btnMemRAM')?.classList.toggle('active', view === 'ram');
    document.getElementById('btnMemStack')?.classList.toggle('active', view === 'stack');
    renderMemoryDumps();
}

function setMemFormat(format) {
    cpu.memFormat = format;
    document.getElementById('btnFmtHex')?.classList.toggle('active', format === 'hex');
    document.getElementById('btnFmtDec')?.classList.toggle('active', format === 'dec');
    renderMemoryDumps();
}

function renderMemoryDumps() {
    const memBox = document.getElementById('memDumpView');
    if (!memBox) return;

    let output = '';
    if (cpu.memView === 'ram') {
        for (let addr = 0x0100; addr <= 0x0178; addr += 8) {
            let bytes = [];
            for (let b = 0; b < 8; b++) {
                let val = readRAM(addr + b);
                bytes.push(cpu.memFormat === 'dec' ? val.toString(10).padStart(3, '0') : val.toString(16).padStart(2, '0').toUpperCase());
            }
            output += `0x${addr.toString(16).toUpperCase()}:  ${bytes.join('  ')}\n`;
        }
    } else {
        for (let addr = 0x08C0; addr <= 0x08F8; addr += 8) {
            let bytes = [];
            for (let b = 0; b < 8; b++) {
                const isSP = ((addr + b) === cpu.sp);
                let val = readRAM(addr + b);
                let valStr = cpu.memFormat === 'dec' ? val.toString(10).padStart(3, '0') : val.toString(16).padStart(2, '0').toUpperCase();
                bytes.push(isSP ? `[${valStr}]` : ` ${valStr} `);
            }
            output += `0x${addr.toString(16).toUpperCase()}: ${bytes.join(' ')}\n`;
        }
    }
    memBox.textContent = output;
}

function updateUI() {
    document.getElementById('cycleCounter').textContent = `Такты: ${cpu.cycles}`;
    const statusElem = document.getElementById('compilerStatus');
    if (cpu.error) {
        statusElem.textContent = '❌ ' + cpu.error; statusElem.style.color = '#ff3d00';
    } else {
        statusElem.textContent = `Строка: ${cpu.program[cpu.pc]?.lineNum || 'END'}`; statusElem.style.color = '#8b9bb4';
    }

    document.getElementById('valPC').textContent = '0x' + cpu.pc.toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valSP').textContent = '0x' + cpu.sp.toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valX').textContent = '0x' + getPointerAddr('x').toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valY').textContent = '0x' + getPointerAddr('y').toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valZ').textContent = '0x' + getPointerAddr('z').toString(16).padStart(4, '0').toUpperCase();

    const fGrid = document.getElementById('flagsGrid');
    fGrid.innerHTML = ['I','T','H','S','V','N','Z','C'].map(f => `<div class="flag-cell ${cpu.sreg[f] ? 'flag-on' : ''}"><span>${f}</span><b>${cpu.sreg[f]}</b></div>`).join('');

    const rGrid = document.getElementById('registersGrid');
    let rHtml = '';
    for (let i = 0; i < 32; i++) {
        rHtml += `<div class="reg-cell ${cpu.r[i] !== cpu.prevR[i] ? 'changed' : ''}"><span class="reg-name">R${i}</span><span class="reg-val-hex">0x${cpu.r[i].toString(16).padStart(2, '0').toUpperCase()}</span><span class="reg-val-dec">(${cpu.r[i]})</span></div>`;
    }
    rGrid.innerHTML = rHtml;

    renderMemoryDumps();
    renderHardware();
    drawLogicAnalyzer();
    renderGutter();
}

/* ================= ГЛАВА 11: ПОДСВЕТКА И ПЕРЕНОС PC ================= */

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightCode(rawText) {
    if (!rawText) return '';
    rawText = rawText.replace(/\r/g, '');
    const lines = rawText.split('\n');

    if (currentLang === 'c') {
        return lines.map(line => {
            let codePart = line;
            let comment = '';
            const cIdx = line.indexOf('//');
            if (cIdx !== -1) {
                codePart = line.substring(0, cIdx);
                comment = line.substring(cIdx);
            }

            let p = escapeHtml(codePart)
                .replace(/\b(uint8_t|int8_t|uint16_t|int16_t|uint32_t|int|void)\b/g, '<span class="syn-type">$1</span>')
                .replace(/\b(while|for|if|else|return|break)\b/g, '<span class="syn-kw">$1</span>')
                .replace(/(#define|#include)/g, '<span class="syn-dir">$1</span>')
                .replace(/\b(DDR[BCD]|PORT[BCD]|PIN[BCD]|UDR0|EICRA|EIMSK|PCICR|PCMSK[0-2])\b/g, '<span class="syn-op">$1</span>')
                .replace(/\b(\$[0-9a-fA-F]+|0x[0-9a-fA-F]+|0b[01]+|-?\d+)\b/g, '<span class="syn-num">$1</span>');

            return p + (comment ? `<span class="syn-com">${escapeHtml(comment)}</span>` : '');
        }).join('\n');
    }

    const KNOWN_OPS = new Set(['ldi','mov','add','adc','sub','subi','sbc','inc','dec','neg','and','andi','or','ori','eor','clr','ser','cpi','cp','sbrs','sbrc','sec','clc','sez','clz','st','ld','sts','lds','push','pop','jmp','rjmp','breq','brne','brcs','brcc','brlo','brsh','call','ret','reti','sei','cli','in','out','break','nop']);

    return lines.map(line => {
        let codePart = line;
        let comment = '';
        const semi = line.indexOf(';');
        const slash = line.indexOf('//');
        let idx = -1;
        if (semi !== -1 && slash !== -1) idx = Math.min(semi, slash);
        else if (semi !== -1) idx = semi;
        else if (slash !== -1) idx = slash;

        if (idx !== -1) {
            codePart = line.substring(0, idx);
            comment = line.substring(idx);
        }

        let p = escapeHtml(codePart)
            .replace(/^(\s*)([a-zA-Z0-9_]+:)/g, '$1<span class="syn-lbl">$2</span>')
            .replace(/(\.[a-zA-Z0-9_]+)/g, '<span class="syn-dir">$1</span>')
            .replace(/\b(\$[0-9a-fA-F]+|0x[0-9a-fA-F]+|0b[01]+|-?\d+)\b/g, '<span class="syn-num">$1</span>');

        p = p.replace(/\b([a-zA-Z]+)\b/g, (m) => KNOWN_OPS.has(m.toLowerCase()) ? `<span class="syn-op">${m}</span>` : m);
        return p + (comment ? `<span class="syn-com">${escapeHtml(comment)}</span>` : '');
    }).join('\n');
}

function updateSyntax() {
    const code = document.getElementById('asmCode').value;
    document.getElementById('highlightingContent').innerHTML = highlightCode(code) + '\n';
    renderGutter();
}

function setEditorLang(lang) {
    currentLang = lang;
    document.getElementById('btnLangAsm').classList.toggle('active', lang === 'asm');
    document.getElementById('btnLangC').classList.toggle('active', lang === 'c');
    document.getElementById('editorTitle').textContent = lang === 'c' ? '⚡ Редактор (C / Си)' : '📝 Редактор (.asm)';
    updateSyntax();
    cpuReset();
}

function toggleBreakpoint(lineNum) {
    if (cpu.breakpoints.has(lineNum)) cpu.breakpoints.delete(lineNum);
    else cpu.breakpoints.add(lineNum);
    updateSyntax();
}

function setPcToLine(targetLine) {
    if (cpu.program.length === 0) parseProgram(document.getElementById('asmCode').value);
    if (cpu.program.length === 0) return;

    haltExecution();
    let targetIdx = -1;
    for (let i = 0; i < cpu.program.length; i++) {
        if (cpu.program[i].lineNum >= targetLine) {
            targetIdx = i;
            break;
        }
    }
    if (targetIdx === -1) targetIdx = cpu.program.length;
    cpu.pc = targetIdx;
    updateUI();
}

function renderGutter() {
    const code = document.getElementById('asmCode').value;
    const curLineNum = cpu.program[cpu.pc]?.lineNum || -1;
    let html = '';
    const lineCount = code.split('\n').length;

    for (let i = 1; i <= lineCount; i++) {
        const isCurrentPC = (i === curLineNum);
        const hasBp = cpu.breakpoints.has(i);

        html += `<div class="gutter-row ${hasBp ? 'has-bp' : ''} ${isCurrentPC ? 'is-pc' : ''}" 
                      onclick="if (event.altKey) { setPcToLine(${i}); } else { toggleBreakpoint(${i}); }"
                      ondblclick="setPcToLine(${i})"
                      title="Клик: точка останова | Двойной клик: переместить PC сюда">
                    <span class="bp-marker"></span>
                    <span class="pc-arrow">▶</span>
                    <span class="gutter-num">${i}</span>
                 </div>`;
    }
    document.getElementById('lineGutter').innerHTML = html;
}

function clearEditor() {
    document.getElementById('asmCode').value = '';
    document.getElementById('hintBanner').style.display = 'none';
    cpu.breakpoints.clear();
    updateSyntax();
    cpuReset();
}

/* ================= ГЛАВА 12: 5 ВЫБРАННЫХ ПРОГРАММ ================= */

const PROGRAMS = {
    test_all: {
        hint: "Проверка команд, установки флагов SREG (I, T, H, S, V, N, Z, C) и арифметики.",
        lang: "asm",
        code: `; Комплексный тест: проверка команд, регистров и всех флагов SREG
.include "m328pdef.inc"
start:
    ldi r16, 0x08
    out sph, r16
    ldi r16, 0xff
    out spl, r16
    sec
    clc
    sez
    clz
    sen
    cln
    sev
    clv
    set
    clt
    seh
    clh
    sei
    cli
    nop
    ldi r16, 0x0F
    ldi r17, 0x01
    add r16, r17
    ldi r17, 10
    subi r17, -3
    ldi r18, 0x80
    neg r18
    break
finish:
    rjmp finish`
    },

    c_zadanie5: {
        hint: "Кнопки K1 (PD2), K2 (PD3), K3 (PD4) переключают светодиоды PD0 (RX), PD1 (TX) и PB5 (L).",
        lang: "c",
        code: `// Управление светодиодами кнопками-триггерами (PD2..PD4 -> PD0, PD1, PB5)
#define F_CPU 16000000UL
#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    // Настройка линий светодиодов на ВЫХОД:
    DDRD |= (1 << DDD0) | (1 << DDD1); // PD0 (RX) и PD1 (TX)
    DDRB |= (1 << DDB5);               // PB5 (светодиод L)

    // Гасим светодиоды:
    PORTD &= ~((1 << PORTD0) | (1 << PORTD1));
    PORTB &= ~(1 << PORTB5);

    // Входы кнопок с подтяжкой:
    DDRD &= ~((1 << DDD2) | (1 << DDD3) | (1 << DDD4));
    PORTD |= (1 << PORTD2) | (1 << PORTD3) | (1 << PORTD4);

    while (1)
    {
        // Кнопка K1 (PD2) переключает светодиод RX (PD0)
        if (!(PIND & (1 << PIND2)))
        {
            _delay_ms(40);
            if (!(PIND & (1 << PIND2)))
            {
                PORTD ^= (1 << PORTD0);
                while (!(PIND & (1 << PIND2)));
                _delay_ms(40);
            }
        }

        // Кнопка K2 (PD3) переключает светодиод TX (PD1)
        if (!(PIND & (1 << PIND3)))
        {
            _delay_ms(40);
            if (!(PIND & (1 << PIND3)))
            {
                PORTD ^= (1 << PORTD1);
                while (!(PIND & (1 << PIND3)));
                _delay_ms(40);
            }
        }

        // Кнопка K3 (PD4) переключает светодиод L (PB5)
        if (!(PIND & (1 << PIND4)))
        {
            _delay_ms(40);
            if (!(PIND & (1 << PIND4)))
            {
                PORTB ^= (1 << PORTB5);
                while (!(PIND & (1 << PIND4)));
                _delay_ms(40);
            }
        }
    }
}`
    },

    uart_tx: {
        hint: "Вывод символов текста в виртуальный порт UDR0 (монитор UART).",
        lang: "asm",
        code: `; Отправка текстовых символов в терминал UART (регистр UDR0)
.include "m328pdef.inc"
start:
    ldi r16, 0x48    ; 'H'
    out UDR0, r16
    ldi r16, 0x69    ; 'i'
    out UDR0, r16
    ldi r16, 0x21    ; '!'
    out UDR0, r16
    ldi r16, 0x0A    ; '\\n'
    out UDR0, r16
stop:
    break`
    },

    c_example3: {
        hint: "Опрос кнопки K4 (PB0) и включение светодиода L (PB5) при нажатии.",
        lang: "c",
        code: `// Опрос кнопки PB0 (с подтяжкой) и включение светодиода L (PB5)
#include <avr/io.h>

int main(void)
{
    DDRB = 0x20;     // PB5 - выход
    PORTB |= 0x01;   // PB0 - подтяжка

    while (1)
    {
        if ((PINB & 0x01) == 0)
            PORTB |= 0x20;   // Включить светодиод L
        else
            PORTB &= ~0x20;  // Выключить светодиод L
    }
}`
    },

    sort_ram: {
        hint: "Программа записывает 5 чисел в ОЗУ (0x0100..0x0104) и сортирует их по возрастанию.",
        lang: "asm",
        code: `; Сортировка массива из 5 чисел в ОЗУ (0x0100..0x0104) по возрастанию
.include "m328pdef.inc"

ldi r16, 0x16
sts 0x0100, r16
ldi r16, 0x03
sts 0x0101, r16
ldi r16, 0x25
sts 0x0102, r16
ldi r16, 0x45
sts 0x0103, r16
ldi r16, 0x01
sts 0x0104, r16

ldi r20, 5
out_1:
    ldi xh, 0x01
    ldi xl, 0x00
    ldi r21, 4

in_1:
    ld r16, x+
    ld r17, x
    cp r16, r17
    brlo no_s

    st x, r16
    st -x, r17
    adiw xl, 1

no_s:
    dec r21
    brne in_1
    dec r20
    brne out_1

finish:
    break
    rjmp finish`
    }
};

function loadSelectedExample() {
    const key = document.getElementById('exampleSelector').value;
    const banner = document.getElementById('hintBanner');
    if (PROGRAMS[key]) {
        document.getElementById('asmCode').value = PROGRAMS[key].code;
        if (!PROGRAMS[key].hint) banner.style.display = 'none';
        else {
            banner.style.display = 'flex';
            document.getElementById('hintText').innerHTML = PROGRAMS[key].hint;
        }
        setEditorLang(PROGRAMS[key].lang || 'asm');
    }
}

/* ================= ГЛАВА 13: ИНИЦИАЛИЗАЦИЯ И СЛУШАТЕЛИ ================= */

document.addEventListener('DOMContentLoaded', () => {
    const txtArea = document.getElementById('asmCode');
    const highlighting = document.getElementById('highlighting');
    const gutter = document.getElementById('lineGutter');

    txtArea.addEventListener('input', () => { updateSyntax(); cpuReset(); });
    txtArea.addEventListener('scroll', () => {
        highlighting.scrollTop = txtArea.scrollTop;
        highlighting.scrollLeft = txtArea.scrollLeft;
        gutter.scrollTop = txtArea.scrollTop;
    });

    window.addEventListener('resize', () => {
        resizeAnalyzerCanvas();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'F11') { e.preventDefault(); cpuStep(); }
        if (e.key === 'F9') {
            e.preventDefault();
            toggleBreakpoint(txtArea.value.substring(0, txtArea.selectionStart).split('\n').length);
        }
    });

    // Первоначальное состояние панелей
    ['editor', 'board', 'analyzer'].forEach(p => {
        const elem = document.getElementById(`panel_${p}`);
        const btn = document.getElementById(`tabBtn_${p}`);
        if (elem && btn) {
            elem.classList.remove('panel-hidden');
            btn.classList.add('active');
        }
    });
    const cpuElem = document.getElementById('panel_cpu');
    const cpuBtn = document.getElementById('tabBtn_cpu');
    if (cpuElem && cpuBtn) {
        cpuElem.classList.add('panel-hidden');
        cpuBtn.classList.remove('active');
    }

    loadSelectedExample();
    setTimeout(resizeAnalyzerCanvas, 100);
});
