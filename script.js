/* ==========================================================================
   AVR ATmega328P Studio & Logic Analyzer Engine (script.js)
   Полная аппаратная эмуляция, компилятор Micro-C, Intel HEX, Smart Watch
   ========================================================================== */

/* ================= 1. КАРТА РЕГИСТРОВ И АДРЕСОВ ВВОДА-ВЫВОДА ================= */

const IO = {
    PINB:   0x23, DDRB:   0x24, PORTB:  0x25,
    PINC:   0x26, DDRC:   0x27, PORTC:  0x28,
    PIND:   0x29, DDRD:   0x2A, PORTD:  0x2B,
    EECR:   0x3F, EEDR:   0x40, EEARL:  0x41, EEARH: 0x42,
    TCCR0A: 0x44, TCCR0B: 0x45, TCNT0:  0x46, OCR0A: 0x47, OCR0B: 0x48,
    PCIFR:  0x3B, EIFR:   0x3C, EIMSK:  0x3D,
    SPL:    0x5D, SPH:    0x5E, SREG:   0x5F,
    ACSR:   0x50,
    PCICR:  0x68, EICRA:  0x69,
    PCMSK0: 0x6B, PCMSK1: 0x6C, PCMSK2: 0x6D,
    ADCL:   0x78, ADCH:   0x79,
    ADCSRA: 0x7A, ADCSRB: 0x7B, ADMUX:  0x7C,
    DIDR0:  0x7E, DIDR1:  0x7F,
    UCSR0A: 0xC0, UCSR0B: 0xC1, UCSR0C: 0xC2,
    UBRR0L: 0xC4, UBRR0H: 0xC5, UDR0:   0xC6
};

const IO_OFFSET = 0x20;

// Таблица векторов прерываний ATmega328P
const VECTORS = {
    RESET:       0x0000,
    INT0:        0x0002,
    INT1:        0x0004,
    PCINT0:      0x0006,
    PCINT1:      0x0008,
    PCINT2:      0x000A,
    USART_RX:    0x0024,
    USART_UDRE:  0x0026,
    USART_TX:    0x0028,
    ADC:         0x002A,
    ANALOG_COMP: 0x002E
};

const CYCLES = {
    nop: 1, ldi: 1, mov: 1, add: 1, adc: 1, sub: 1, subi: 1, sbc: 1, sbci: 1,
    and: 1, andi: 1, or: 1, ori: 1, eor: 1, com: 1, neg: 1, inc: 1, dec: 1,
    tst: 1, clr: 1, ser: 1, in: 1, out: 1, sec: 1, clc: 1, sez: 1, clz: 1,
    sen: 1, cln: 1, sev: 1, clv: 1, ses: 1, cls: 1, seh: 1, clh: 1, set: 1, clt: 1,
    sei: 1, cli: 1, sbi: 2, cbi: 2, sbis: 1, sbic: 1, bst: 1, bld: 1, lpm: 3,
    mul: 2, muls: 2,
    lsl: 1, lsr: 1, asr: 1, rol: 1, ror: 1, cp: 1, cpc: 1, cpi: 1, cpse: 1,
    adiw: 2, sbiw: 2, sbrs: 1, sbrc: 1, rjmp: 2, jmp: 3, call: 4, ret: 4, reti: 4,
    lds: 2, sts: 2, ld: 1, st: 1, push: 2, pop: 2,
    breq: 1, brne: 1, brcs: 1, brcc: 1, brlo: 1, brsh: 1,
    brmi: 1, brpl: 1, brge: 1, brlt: 1, brhs: 1, brhc: 1, brts: 1, brtc: 1,
    brvs: 1, brvc: 1
};

/* ================= 2. СОСТОЯНИЕ СИСТЕМЫ И ПЕРЕМЕННЫЕ ================= */

let currentLang = 'asm';
let currentFontSize = 14;
let appZoom = parseFloat(localStorage.getItem('avr_app_zoom')) || 1.0;
let cachedUserCCode = '';

const PANEL_LIST = ['editor', 'board', 'analyzer', 'cpu', 'tools'];
const activePanels = {
    editor: true,
    board: true,
    analyzer: true,
    cpu: true,
    tools: false
};

const cpu = {
    r: new Uint8Array(32),
    prevR: new Uint8Array(32),
    ram: new Uint8Array(0x0900),
    flashBytes: new Uint8Array(32768),
    eeprom: (function() {
        try {
            const s = localStorage.getItem('avr_eeprom');
            if (s) return new Uint8Array(JSON.parse(s));
        } catch(e) {}
        return new Uint8Array(1024);
    })(),
    pc: 0,
    sp: 0x08FF,
    sreg: { C:0, Z:0, N:0, V:0, S:0, H:0, T:0, I:0 },
    cycles: 0,
    running: false,
    timer: null,
    speed: 40,
    program: [],
    labels: {},
    equConstants: {},
    symbols: [],          // Умный Watch: [{ name, type, size, locType, location }]
    breakpoints: new Set(),
    syntaxErrors: new Map(),
    rxBuffer: [],
    uartLog: "",
    uartTxBusyCycles: 0,  // Тайминг занятости передатчика
    error: null,
    selectedPort: 'D',
    memView: 'ram',
    memFormat: 'hex',
    potVal: 0,
    prevPinB: 0xFF,
    prevPinC: 0xFF,
    prevPinD: 0xFF
};

const defaultButtons = [
    { id: 'K1', port: 'D', pin: 2, label: 'PD2 (INT0)', pressed: false, type: 'btn_latch' },
    { id: 'K2', port: 'D', pin: 3, label: 'PD3 (INT1)', pressed: false, type: 'btn_latch' },
    { id: 'K3', port: 'D', pin: 4, label: 'PD4', pressed: false, type: 'btn_latch' },
    { id: 'K4', port: 'B', pin: 0, label: 'PB0 (PCINT0)', pressed: false, type: 'btn_latch' },
    { id: 'K5', port: 'B', pin: 1, label: 'PB1 (PCINT1)', pressed: false, type: 'btn_latch' },
    { id: 'K6', port: 'B', pin: 2, label: 'PB2 (PCINT2)', pressed: false, type: 'btn_latch' },
    { id: 'K7', port: 'B', pin: 3, label: 'PB3', pressed: false, type: 'btn_latch' },
    { id: 'K8', port: 'B', pin: 4, label: 'PB4', pressed: false, type: 'btn_latch' }
];

let vButtons = [...defaultButtons];
let customIoComponents = [];

/* ================= 3. ЗУМ И МАСШТАБИРОВАНИЕ ИНТЕРФЕЙСА ================= */

function applyAppZoom() {
    const container = document.getElementById('appContainer');
    if (container) {
        container.style.zoom = appZoom;
    }
    const zoomValElem = document.getElementById('zoomVal');
    if (zoomValElem) {
        zoomValElem.textContent = Math.round(appZoom * 100) + '%';
    }
    try {
        localStorage.setItem('avr_app_zoom', appZoom);
    } catch(e) {}
    setTimeout(resizeAnalyzerCanvas, 40);
}

function changeAppZoom(delta) {
    appZoom = Math.min(1.8, Math.max(0.6, Math.round((appZoom + delta) * 10) / 10));
    applyAppZoom();
}

function resetAppZoom() {
    appZoom = 1.0;
    applyAppZoom();
}

/* ================= 4. НАВИГАЦИЯ И УПРАВЛЕНИЕ ПАНЕЛЯМИ ================= */

function togglePanel(panelName) {
    const isMobile = window.innerWidth <= 900;
    if (isMobile) {
        PANEL_LIST.forEach(name => {
            activePanels[name] = (name === panelName);
            const pElem = document.getElementById('panel_' + name);
            const tBtn = document.getElementById('tabBtn_' + name);
            if (pElem) pElem.classList.toggle('panel-hidden', name !== panelName);
            if (tBtn) tBtn.classList.toggle('active', name === panelName);
        });
    } else {
        const activeCount = Object.values(activePanels).filter(Boolean).length;
        if (activePanels[panelName] && activeCount <= 1) return;
        activePanels[panelName] = !activePanels[panelName];

        const pElem = document.getElementById('panel_' + panelName);
        const tBtn = document.getElementById('tabBtn_' + panelName);
        if (pElem) pElem.classList.toggle('panel-hidden', !activePanels[panelName]);
        if (tBtn) tBtn.classList.toggle('active', activePanels[panelName]);
    }
    if (panelName === 'analyzer' && activePanels.analyzer) {
        setTimeout(resizeAnalyzerCanvas, 40);
    }
}

function changeFontSize(delta) {
    currentFontSize = Math.min(24, Math.max(10, currentFontSize + delta));
    const newLineHeight = Math.round(currentFontSize * 1.55);
    document.documentElement.style.setProperty('--code-font-size', currentFontSize + 'px');
    document.documentElement.style.setProperty('--line-height', newLineHeight + 'px');
    document.getElementById('fontSizeVal').textContent = currentFontSize + 'px';
    renderGutter();
}

function switchBoardBottomTab(tab) {
    const isUart = (tab === 'uart');
    document.getElementById('btnTabUart')?.classList.toggle('active', isUart);
    document.getElementById('btnTabExtraPins')?.classList.toggle('active', !isUart);
    const uCon = document.getElementById('viewUartConsole');
    const ePin = document.getElementById('viewExtraPins');
    if (uCon) uCon.style.display = isUart ? 'block' : 'none';
    if (ePin) ePin.style.display = isUart ? 'none' : 'block';
    if (!isUart) renderExtraPins();
}

function toggleCardCollapse(cardId) {
    const card = document.getElementById(cardId);
    const icon = document.getElementById(cardId + '_icon');
    if (!card) return;
    const isCollapsed = card.classList.toggle('collapsed');
    if (icon) icon.textContent = isCollapsed ? '▼' : '▲';
}

/* ================= 5. DRAG-AND-DROP КОЛОНОК ================= */

function initDragAndDrop() {
    const track = document.getElementById('panelsTrack');
    if (!track) return;

    // Восстановление порядка колонок
    try {
        const savedOrder = JSON.parse(localStorage.getItem('avr_panel_order'));
        if (Array.isArray(savedOrder) && savedOrder.length === PANEL_LIST.length) {
            savedOrder.forEach(id => {
                const p = document.getElementById('panel_' + id);
                if (p) track.appendChild(p);
            });
        }
    } catch(e) {}

    let draggedPanel = null;

    document.querySelectorAll('.slide-panel').forEach(panel => {
        const header = panel.querySelector('.slide-header');
        if (!header) return;

        header.addEventListener('dragstart', (e) => {
            draggedPanel = panel;
            panel.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', panel.id);
        });

        header.addEventListener('dragend', () => {
            panel.classList.remove('dragging');
            document.querySelectorAll('.slide-panel').forEach(p => p.classList.remove('drag-over'));
            draggedPanel = null;
            savePanelOrder();
            setTimeout(resizeAnalyzerCanvas, 40);
        });

        panel.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!draggedPanel || draggedPanel === panel) return;
            e.dataTransfer.dropEffect = 'move';
            panel.classList.add('drag-over');
        });

        panel.addEventListener('dragleave', () => {
            panel.classList.remove('drag-over');
        });

        panel.addEventListener('drop', (e) => {
            e.preventDefault();
            panel.classList.remove('drag-over');
            if (!draggedPanel || draggedPanel === panel) return;

            const children = Array.from(track.children);
            const draggedIdx = children.indexOf(draggedPanel);
            const targetIdx = children.indexOf(panel);

            if (draggedIdx < targetIdx) {
                track.insertBefore(draggedPanel, panel.nextSibling);
            } else {
                track.insertBefore(draggedPanel, panel);
            }
            savePanelOrder();
            setTimeout(resizeAnalyzerCanvas, 40);
        });
    });
}

function savePanelOrder() {
    const track = document.getElementById('panelsTrack');
    if (!track) return;
    const order = Array.from(track.children)
        .map(el => el.getAttribute('data-panel-id'))
        .filter(Boolean);
    try {
        localStorage.setItem('avr_panel_order', JSON.stringify(order));
    } catch(e) {}
}

/* ================= 6. ДЕБАГГЕР И АНАЛИЗАТОР СИНТАКСИСА ================= */

const KNOWN_OPS = new Set([
    'ldi','mov','add','adc','sub','subi','sbc','sbci','inc','dec','lsl','lsr','asr','rol','ror',
    'neg','com','and','andi','or','ori','eor','tst','clr','ser','cpi','cp','cpse','sbrs','sbrc',
    'sec','clc','sez','clz','sen','cln','sev','clv','ses','cls','seh','clh','set','clt',
    'bst','bld','sbi','cbi','sbis','sbic','lpm','mul','muls',
    'adiw','sbiw','st','ld','sts','lds','push','pop','jmp','rjmp','breq','brne','brcs','brcc',
    'brlo','brsh','brmi','brpl','brge','brlt','brhs','brhc','brts','brtc','brvs','brvc',
    'call','ret','reti','sei','cli','in','out','break','nop'
]);

function getClosestInstruction(typo) {
    let bestMatch = '';
    let minDistance = Infinity;
    for (const op of KNOWN_OPS) {
        const d = levenshteinDistance(typo.toLowerCase(), op);
        if (d < minDistance) {
            minDistance = d;
            bestMatch = op;
        }
    }
    return minDistance <= 2 ? bestMatch : null;
}

function levenshteinDistance(s1, s2) {
    const m = s1.length, n = s2.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

function validateSourceCode(text, lang) {
    cpu.syntaxErrors.clear();
    const lines = text.split('\n');

    const braceStack = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '{' || char === '(' || char === '[') {
                braceStack.push({ char, line: i + 1 });
            } else if (char === '}' || char === ')' || char === ']') {
                if (braceStack.length === 0) {
                    cpu.syntaxErrors.set(i + 1, "Лишняя закрывающая скобка '" + char + "'");
                    break;
                }
                const top = braceStack.pop();
                if ((char === '}' && top.char !== '{') ||
                    (char === ')' && top.char !== '(') ||
                    (char === ']' && top.char !== '[')) {
                    cpu.syntaxErrors.set(i + 1, "Несоответствие скобок: ожидалась '" + top.char + "', получена '" + char + "'");
                    break;
                }
            }
        }
    }
    if (braceStack.length > 0) {
        const unclosed = braceStack.pop();
        cpu.syntaxErrors.set(unclosed.line, "Незакрытая скобка '" + unclosed.char + "'");
    }

    if (lang === 'asm') {
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            const sIdx = line.indexOf(';');
            if (sIdx !== -1) line = line.substring(0, sIdx);
            line = line.trim();
            if (!line || line.startsWith('.') || line.endsWith(':')) continue;

            if (line.includes(':')) {
                line = line.split(':')[1].trim();
                if (!line) continue;
            }

            const tokens = line.split(/\s+/);
            const op = tokens[0].toLowerCase();

            if (!KNOWN_OPS.has(op)) {
                const suggestion = getClosestInstruction(op);
                const hint = suggestion ? ' Возможно: "' + suggestion + '"?' : '';
                cpu.syntaxErrors.set(i + 1, 'Неизвестная команда "' + op + '".' + hint);
                continue;
            }

            const argsStr = line.substring(tokens[0].length).trim();
            const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];
            if (op === 'ldi' && args.length >= 1) {
                const regNum = parseReg(args[0]);
                if (regNum < 16) {
                    cpu.syntaxErrors.set(i + 1, 'LDI не работает с R' + regNum + '. Разрешены R16..R31');
                }
            }
        }
    }

    const statusElem = document.getElementById('compilerStatus');
    if (cpu.syntaxErrors.size > 0) {
        const firstErrLine = cpu.syntaxErrors.keys().next().value;
        const errMsg = cpu.syntaxErrors.get(firstErrLine);
        cpu.error = 'Строка ' + firstErrLine + ': ' + errMsg;
        statusElem.textContent = '❌ ' + cpu.error;
        statusElem.parentElement.classList.add('has-error-text');
    } else {
        statusElem.parentElement.classList.remove('has-error-text');
        if (!cpu.error) statusElem.textContent = 'Готов';
    }
}

/* ================= 7. АВТОДОПОЛНЕНИЕ GHOST TEXT ================= */

const COMMON_REGISTERS = [
    'PORTB', 'PORTC', 'PORTD', 'DDRB', 'DDRC', 'DDRD', 'PINB', 'PINC', 'PIND',
    'ACSR', 'ADMUX', 'ADCSRA', 'ADCSRB', 'ADCH', 'ADCL', 'DIDR0', 'DIDR1',
    'UDR0', 'UCSR0A', 'UCSR0B', 'UCSR0C', 'UBRR0L', 'UBRR0H',
    'EICRA', 'EIMSK', 'EIFR', 'PCICR', 'PCIFR', 'PCMSK0', 'PCMSK1', 'PCMSK2',
    'SREG', 'SPL', 'SPH'
];

const DICT_C = [
    '#define F_CPU 16000000UL', '#include <avr/io.h>', '#include <avr/interrupt.h>',
    'int main(void)', 'uint8_t', 'uint16_t', 'uint32_t', 'int', 'char', 'while (1)',
    'sei();', 'cli();', 'ISR(USART_RX_vect)', 'ISR(USART_TX_vect)', 'ISR(INT0_vect)',
    'TXEN0', 'RXEN0', 'RXCIE0', 'TXCIE0', 'UDRIE0', 'UCSZ00', 'UCSZ01', 'PB5', 'PD2',
    ...COMMON_REGISTERS
];

const DICT_ASM = [
    '.include "m328pdef.inc"', '.org 0x0000', '.org 0x0002', '.org 0x0024', '.cseg', '.db',
    'ldi', 'mov', 'add', 'adc', 'sub', 'subi', 'rjmp', 'jmp', 'call', 'ret', 'reti',
    'in', 'out', 'sts', 'lds', 'lpm', 'bst', 'brtc', 'brts', 'cpi', 'breq', 'brne',
    'sei', 'cli', 'nop', 'break', 'low(Msg<<1)', 'high(Msg<<1)',
    ...COMMON_REGISTERS
];

let currentGhostSuggestion = '';

function updateGhostAutocomplete() {
    const txtArea = document.getElementById('asmCode');
    const ghostOverlay = document.getElementById('ghostOverlay');
    const mobileBtn = document.getElementById('mobileTabBtn');
    if (!txtArea || !ghostOverlay) return;

    const cursor = txtArea.selectionStart;
    const textBefore = txtArea.value.substring(0, cursor);
    const currentLine = textBefore.split('\n').pop();
    const trimmedLine = currentLine.trimStart();

    const activeDict = (currentLang === 'c') ? DICT_C : DICT_ASM;
    let candidate = null;
    let prefix = '';

    if (trimmedLine.startsWith('#') || trimmedLine.startsWith('.') || trimmedLine.startsWith('int m')) {
        candidate = activeDict.find(w => w.startsWith(trimmedLine) && w !== trimmedLine);
        if (candidate) prefix = trimmedLine;
    }

    if (!candidate) {
        const match = currentLine.match(/([.#a-zA-Z_0-9]+)$/);
        if (match && match[1].length >= 1) {
            prefix = match[1];
            candidate = activeDict.find(w => w.toLowerCase().startsWith(prefix.toLowerCase()) && w.toLowerCase() !== prefix.toLowerCase());
        }
    }

    if (candidate && prefix) {
        const suffix = candidate.substring(prefix.length);
        currentGhostSuggestion = suffix;
        const beforeWord = escapeHtml(txtArea.value.substring(0, cursor));
        const afterCursor = escapeHtml(txtArea.value.substring(cursor));
        ghostOverlay.innerHTML = beforeWord + '<span class="ghost-hint">' + escapeHtml(suffix) + '</span>' + afterCursor;
        if (mobileBtn) mobileBtn.textContent = '⇥ Tab: ' + candidate;
    } else {
        currentGhostSuggestion = '';
        ghostOverlay.innerHTML = '';
        if (mobileBtn) mobileBtn.textContent = '⇥ Tab';
    }
}

function applyGhostCompletion() {
    if (!currentGhostSuggestion) return;
    const txtArea = document.getElementById('asmCode');
    const start = txtArea.selectionStart;
    const end = txtArea.selectionEnd;

    txtArea.value = txtArea.value.substring(0, start) + currentGhostSuggestion + txtArea.value.substring(end);
    txtArea.selectionStart = txtArea.selectionEnd = start + currentGhostSuggestion.length;

    currentGhostSuggestion = '';
    document.getElementById('ghostOverlay').innerHTML = '';
    updateSyntax();
    cpuReset();
}

/* ================= 8. КОМПИЛЯТОР MICRO-C И ТАБЛИЦА СИМВОЛОВ ================= */

const AVR_CONSTS = {
    ISC00: 0, ISC01: 1, ISC10: 2, ISC11: 3,
    INT0: 0, INT1: 1, PCIE0: 0, PCIE1: 1, PCIE2: 2,
    TXEN0: 3, RXEN0: 4, UDRIE0: 5, TXCIE0: 6, RXCIE0: 7,
    UCSZ00: 1, UCSZ01: 2, UCSZ02: 2,
    PORTD0: 0, PORTD1: 1, PORTD2: 2, PORTD3: 3, PORTD4: 4, PORTD5: 5, PORTD6: 6, PORTD7: 7,
    PORTB0: 0, PORTB1: 1, PORTB2: 2, PORTB3: 3, PORTB4: 4, PORTB5: 5, PORTB6: 6, PORTB7: 7,
    PD0: 0, PD1: 1, PD2: 2, PD3: 3, PD4: 4, PD5: 5, PD6: 6, PD7: 7,
    PB0: 0, PB1: 1, PB2: 2, PB3: 3, PB4: 4, PB5: 5, PB6: 6, PB7: 7
};

function evaluateCExpression(expr, defines) {
    if (!expr) return null;
    expr = expr.trim();
    if (defines) {
        for (const [k, v] of Object.entries(defines)) {
            expr = expr.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
        }
    }
    for (const [k, v] of Object.entries(AVR_CONSTS)) {
        expr = expr.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
    }
    expr = expr.replace(/'(.)'/g, (m, c) => c.charCodeAt(0));
    expr = expr.replace(/UL|U|L/gi, '');
    try {
        return Function("'use strict'; return (" + expr + ");")();
    } catch (e) {
        return null;
    }
}

function compileCToAsm(cCode) {
    cpu.symbols = [];
    let code = cCode.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    code = code.replace(/if\s*(\((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*\))\s*([^{;]+;)/g, 'if $1 { $2 }');
    code = code.replace(/else\s+([^{;]+;)/g, 'else { $1 }');
    code = code.replace(/\{/g, '\n{\n').replace(/\}/g, '\n}\n').replace(/;/g, ';\n');

    const rawLines = code.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const asmList = [];
    let regCounter = 17;
    const varMap = {};
    let labelCounter = 1;
    const controlStack = [];
    const defines = {};
    const globalInits = [];
    let insideMain = false;

    let mainLineNum = 1;
    for (let i = 0; i < rawLines.length; i++) {
        if (rawLines[i].includes('main(')) { mainLineNum = i + 1; break; }
    }

    for (let i = 0; i < rawLines.length; i++) {
        const defMatch = rawLines[i].match(/^#define\s+([a-zA-Z0-9_]+)\s+(.+)$/);
        if (defMatch) defines[defMatch[1]] = defMatch[2].replace(/UL|U|L/gi, '').trim();
    }

    function applyDefines(str) {
        for (const [k, v] of Object.entries(defines)) {
            str = str.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
        }
        return str;
    }

    asmList.push({ asm: '.include "m328pdef.inc"', lineNum: mainLineNum });
    asmList.push({ asm: 'rjmp __main', lineNum: mainLineNum });

    for (let i = 0; i < rawLines.length; i++) {
        let line = rawLines[i];
        const lineNum = i + 1;
        if (!line || line.startsWith('#')) continue;

        const isrMatch = line.match(/ISR\s*\(\s*([a-zA-Z0-9_]+)\s*\)/);
        if (isrMatch) {
            const vName = isrMatch[1];
            let lbl = '__vector_default';
            if (vName.includes('INT0')) lbl = '__vector_int0';
            else if (vName.includes('INT1')) lbl = '__vector_int1';
            else if (vName.includes('USART_RX')) lbl = '__vector_usart_rx';
            else if (vName.includes('USART_UDRE')) lbl = '__vector_usart_udre';
            else if (vName.includes('USART_TX')) lbl = '__vector_usart_tx';

            asmList.push({ asm: lbl + ':', lineNum });
            asmList.push({ asm: 'push r16', lineNum });
            asmList.push({ asm: 'in r16, SREG', lineNum });
            asmList.push({ asm: 'push r16', lineNum });
            controlStack.push({ type: 'isr' });
            continue;
        }

        if (line.includes('main(')) {
            insideMain = true;
            asmList.push({ asm: '__main:', lineNum });
            for (let init of globalInits) asmList.push(init);
            continue;
        }

        if (line.includes('sei()')) { asmList.push({ asm: 'sei', lineNum }); continue; }
        if (line.includes('cli()')) { asmList.push({ asm: 'cli', lineNum }); continue; }

        if (line === '}' || line.startsWith('}')) {
            if (controlStack.length > 0) {
                const top = controlStack[controlStack.length - 1];
                if (top.type === 'if') {
                    if (rawLines[i+1]?.startsWith('else')) {
                        asmList.push({ asm: 'rjmp ' + top.lblEnd, lineNum });
                        asmList.push({ asm: top.lblFalse + ':', lineNum });
                        top.type = 'else';
                    } else {
                        controlStack.pop();
                        asmList.push({ asm: top.lblFalse + ':', lineNum });
                        asmList.push({ asm: top.lblEnd + ':', lineNum });
                    }
                } else if (top.type === 'else') {
                    controlStack.pop();
                    asmList.push({ asm: top.lblEnd + ':', lineNum });
                } else if (top.type === 'while') {
                    controlStack.pop();
                    asmList.push({ asm: 'rjmp ' + top.startLbl, lineNum });
                } else if (top.type === 'isr') {
                    controlStack.pop();
                    asmList.push({ asm: 'pop r16', lineNum });
                    asmList.push({ asm: 'out SREG, r16', lineNum });
                    asmList.push({ asm: 'pop r16', lineNum });
                    asmList.push({ asm: 'reti', lineNum });
                }
            }
            continue;
        }

        if (line.startsWith('else')) {
            line = line.substring(4).trim();
            if (!line || line === '{') continue;
        }
        if (line === '{') continue;

        // Объявления переменных (uint8_t data = UDR0; int flag = 0;)
        const declMatch = line.match(/\b(unsigned\s+char|uint8_t|int8_t|uint16_t|int16_t|uint32_t|int|char)\s+([^;]+);/);
        if (declMatch) {
            const typeName = declMatch[1];
            const rawVars = declMatch[2].split(',');
            for (let vItem of rawVars) {
                const parts = vItem.trim().split('=');
                const vName = parts[0].trim();
                const initVal = parts[1] ? parts[1].trim() : '0';
                const reg = 'r' + (regCounter++);
                const size = (typeName.includes('32') ? 4 : (typeName.includes('16') || typeName === 'int') ? 2 : 1);
                
                varMap[vName] = { reg, type: typeName, size };
                cpu.symbols.push({ name: vName, type: typeName, size, locType: 'reg', location: reg.toUpperCase() });

                if (initVal === 'UDR0') {
                    asmList.push({ asm: 'lds ' + reg + ', UDR0', lineNum });
                } else {
                    let constVal = evaluateCExpression(applyDefines(initVal), defines);
                    if (constVal !== null) {
                        const inst = { asm: 'ldi ' + reg + ', ' + (constVal & 0xFF), lineNum };
                        if (!insideMain) globalInits.push(inst);
                        else asmList.push(inst);
                    }
                }
            }
            continue;
        }

        // Битовые операции с регистрами PORT / DDR / UCSR
        const portOrMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|UCSR0B|UCSR0C|EICRA|EIMSK)\s*\|\=\s*([^;]+);/);
        if (portOrMatch) {
            const portName = portOrMatch[1];
            const mask = evaluateCExpression(applyDefines(portOrMatch[2]), defines) & 0xFF;
            const isExtended = ['UCSR0B','UCSR0C','EICRA','UBRR0H','UBRR0L'].includes(portName);
            asmList.push({ asm: (isExtended ? 'lds' : 'in') + ' r16, ' + portName, lineNum });
            asmList.push({ asm: 'ori r16, ' + mask, lineNum });
            asmList.push({ asm: (isExtended ? 'sts' : 'out') + ' ' + portName + ', r16', lineNum });
            continue;
        }

        const portAndNotMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|UCSR0B|UCSR0C)\s*&\=\s*~\s*\(?\s*([^;]+)\)?;/);
        if (portAndNotMatch) {
            const portName = portAndNotMatch[1];
            const mask = evaluateCExpression(applyDefines(portAndNotMatch[2].replace(/\)+$/, '')), defines) & 0xFF;
            const invMask = (~mask) & 0xFF;
            const isExtended = ['UCSR0B','UCSR0C','EICRA'].includes(portName);
            asmList.push({ asm: (isExtended ? 'lds' : 'in') + ' r16, ' + portName, lineNum });
            asmList.push({ asm: 'andi r16, ' + invMask, lineNum });
            asmList.push({ asm: (isExtended ? 'sts' : 'out') + ' ' + portName + ', r16', lineNum });
            continue;
        }

        // Присваивания (UBRR0 = 103;, UDR0 = 0x3E;)
        const assignMatch = line.match(/\b([a-zA-Z0-9_]+)\s*=\s*([^;]+);/);
        if (assignMatch) {
            const dst = assignMatch[1].trim();
            const src = assignMatch[2].trim();

            if (dst === 'UBRR0' || dst === 'UBRR0L') {
                const cVal = evaluateCExpression(applyDefines(src), defines) || 0;
                asmList.push({ asm: 'ldi r16, ' + (cVal & 0xFF), lineNum });
                asmList.push({ asm: 'sts UBRR0L, r16', lineNum });
                continue;
            }

            if (['PORTB','PORTD','DDRB','DDRD','UCSR0B','UCSR0C','UDR0','EICRA','EIMSK'].includes(dst)) {
                let cVal = evaluateCExpression(applyDefines(src), defines);
                const isExtended = ['UCSR0B','UCSR0C','UDR0','EICRA'].includes(dst);
                if (cVal !== null) {
                    asmList.push({ asm: 'ldi r16, ' + (cVal & 0xFF), lineNum });
                    asmList.push({ asm: (isExtended ? 'sts' : 'out') + ' ' + dst + ', r16', lineNum });
                } else if (varMap[src]) {
                    asmList.push({ asm: (isExtended ? 'sts' : 'out') + ' ' + dst + ', ' + varMap[src].reg, lineNum });
                }
                continue;
            }

            if (varMap[dst]) {
                if (src === 'UDR0') {
                    asmList.push({ asm: 'lds ' + varMap[dst].reg + ', UDR0', lineNum });
                } else {
                    let cVal = evaluateCExpression(applyDefines(src), defines);
                    if (cVal !== null) asmList.push({ asm: 'ldi ' + varMap[dst].reg + ', ' + (cVal & 0xFF), lineNum });
                    else if (varMap[src]) asmList.push({ asm: 'mov ' + varMap[dst].reg + ', ' + varMap[src].reg, lineNum });
                }
                continue;
            }
        }

        // Ветвление if (data == 'M') или if (x >= 800000)
        const ifMatch = line.match(/if\s*\(\s*([a-zA-Z0-9_]+)\s*(==|!=|>=|>|<=|<)\s*([^)]+)\)/);
        if (ifMatch) {
            const vName = ifMatch[1];
            const op = ifMatch[2];
            let cmpVal = evaluateCExpression(applyDefines(ifMatch[3]), defines);
            if (cmpVal !== null && varMap[vName]) {
                const lblFalse = '__lbl_false_' + (labelCounter++);
                const lblEnd = '__lbl_end_' + (labelCounter++);
                asmList.push({ asm: 'cpi ' + varMap[vName].reg + ', ' + (cmpVal & 0xFF), lineNum });
                if (op === '==')      asmList.push({ asm: 'brne ' + lblFalse, lineNum });
                else if (op === '!=') asmList.push({ asm: 'breq ' + lblFalse, lineNum });
                else if (op === '>=') asmList.push({ asm: 'brlt ' + lblFalse, lineNum });
                else if (op === '<')  asmList.push({ asm: 'brge ' + lblFalse, lineNum });
                controlStack.push({ type: 'if', lblFalse, lblEnd });
                continue;
            }
        }

        // Цикл while (1)
        if (line.startsWith('while') && line.includes('1')) {
            const startLbl = '__while_start_' + (labelCounter++);
            asmList.push({ asm: startLbl + ':', lineNum });
            controlStack.push({ type: 'while', startLbl });
            continue;
        }

        // Инкремент x++;
        const incMatch = line.match(/\b([a-zA-Z0-9_]+)\+\+;/);
        if (incMatch && varMap[incMatch[1]]) {
            asmList.push({ asm: 'inc ' + varMap[incMatch[1]].reg, lineNum });
            continue;
        }
    }

    while (controlStack.length > 0) {
        const top = controlStack.pop();
        if (top.type === 'while') asmList.push({ asm: 'rjmp ' + top.startLbl, lineNum: rawLines.length });
        else if (top.type === 'if') {
            asmList.push({ asm: top.lblFalse + ':', lineNum: rawLines.length });
            asmList.push({ asm: top.lblEnd + ':', lineNum: rawLines.length });
        } else if (top.type === 'else') {
            asmList.push({ asm: top.lblEnd + ':', lineNum: rawLines.length });
        } else if (top.type === 'isr') {
            asmList.push({ asm: 'pop r16', lineNum: rawLines.length });
            asmList.push({ asm: 'out SREG, r16', lineNum: rawLines.length });
            asmList.push({ asm: 'pop r16', lineNum: rawLines.length });
            asmList.push({ asm: 'reti', lineNum: rawLines.length });
        }
    }

    return asmList;
}

/* ================= 9. ПАРСЕР АССЕМБЛЕРА ================= */

function evaluateAsmExpression(expr) {
    if (!expr) return 0;
    expr = expr.trim();

    for (const [k, v] of Object.entries(cpu.equConstants)) {
        expr = expr.replace(new RegExp('\\b' + k + '\\b', 'gi'), v);
    }
    for (const [k, v] of Object.entries(AVR_CONSTS)) {
        expr = expr.replace(new RegExp('\\b' + k + '\\b', 'gi'), v);
    }
    for (const [lbl, addr] of Object.entries(cpu.labels)) {
        expr = expr.replace(new RegExp('\\b' + lbl + '\\b', 'gi'), addr);
    }

    if (expr.toLowerCase().includes('ramend')) return 0x08FF;

    // Поддержка low(...) и high(...) со сдвигами меток: low(Msg << 1)
    expr = expr.replace(/high\s*\(([^)]+)\)/gi, (m, inner) => '((' + inner + ') >> 8) & 0xFF');
    expr = expr.replace(/low\s*\(([^)]+)\)/gi, (m, inner) => '(' + inner + ') & 0xFF');
    expr = expr.replace(/\$([0-9a-fA-F]+)/g, '0x$1');

    try {
        return Function("'use strict'; return (" + expr + ");")();
    } catch (e) {
        return parseInt(expr, 10) || 0;
    }
}

function parseVal(arg) {
    if (!arg) return 0;
    arg = arg.trim();
    const upper = arg.toUpperCase();
    if (IO[upper] !== undefined) {
        return IO[upper] < 0x60 ? IO[upper] - IO_OFFSET : IO[upper];
    }
    return evaluateAsmExpression(arg);
}

function parseReg(arg) {
    if (!arg) return 0;
    arg = arg.trim().toLowerCase();
    const aliases = { 'xl': 26, 'xh': 27, 'yl': 28, 'yh': 29, 'zl': 30, 'zh': 31 };
    if (aliases[arg] !== undefined) return aliases[arg];
    const clean = arg.replace(/[^0-9]/g, '');
    return Math.min(31, Math.max(0, parseInt(clean, 10) || 0));
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

function resolveLabel(target, lineNum) {
    if (!target) return null;
    const key = target.trim().toLowerCase();
    if (cpu.labels[key] === undefined) {
        cpu.error = 'Строка ' + lineNum + ': метка "' + target + '" не найдена';
        return null;
    }
    return cpu.labels[key];
}

function parseProgram(text) {
    cpu.program = [];
    cpu.labels = {};
    cpu.equConstants = {};
    cpu.flashBytes.fill(0);
    cpu.error = null;
    if (!text) return;
    text = text.replace(/\r/g, '');

    validateSourceCode(text, currentLang);
    if (cpu.syntaxErrors.size > 0) return;

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

    // Режим Ассемблера (ASM)
    const lines = text.split('\n');

    // Проход 1: сбор констант .equ
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const sIdx = line.indexOf(';');
        if (sIdx !== -1) line = line.substring(0, sIdx);
        line = line.trim();
        const eqMatch = line.match(/\.equ\s+([a-zA-Z0-9_]+)\s*=\s*(.+)/i);
        if (eqMatch) {
            cpu.equConstants[eqMatch[1].trim()] = evaluateAsmExpression(eqMatch[2].trim());
        }
    }

    // Проход 2: трансляция команд и данных .db
    let wordIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const sIdx = line.indexOf(';');
        if (sIdx !== -1) line = line.substring(0, sIdx);
        line = line.trim();
        if (!line) continue;

        if (line.toLowerCase().startsWith('.org')) {
            const orgTarget = evaluateAsmExpression(line.substring(4).trim());
            while (wordIndex < orgTarget) {
                cpu.program[wordIndex] = { op: 'nop', args: [], lineNum: i + 1, raw: 'nop' };
                wordIndex++;
            }
            continue;
        }

        if (line.includes(':')) {
            const parts = line.split(':');
            const lblName = parts[0].trim().toLowerCase();
            cpu.labels[lblName] = wordIndex;
            line = parts.slice(1).join(':').trim();
            if (!line) continue;
        }

        if (line.toLowerCase().startsWith('.db')) {
            const dataStr = line.substring(3).trim();
            let bytePtr = wordIndex * 2;
            const items = dataStr.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            for (let itm of items) {
                itm = itm.trim();
                if (itm.startsWith('"') && itm.endsWith('"')) {
                    const strVal = itm.slice(1, -1);
                    for (let c = 0; c < strVal.length; c++) {
                        cpu.flashBytes[bytePtr++] = strVal.charCodeAt(c);
                    }
                } else if (itm === "'\\n'") {
                    cpu.flashBytes[bytePtr++] = 10;
                } else if (itm === "'\\r'") {
                    cpu.flashBytes[bytePtr++] = 13;
                } else {
                    cpu.flashBytes[bytePtr++] = evaluateAsmExpression(itm) & 0xFF;
                }
            }
            const wordsUsed = Math.ceil((bytePtr - (wordIndex * 2)) / 2);
            for (let w = 0; w < wordsUsed; w++) {
                cpu.program[wordIndex + w] = { op: 'nop', args: [], lineNum: i + 1, raw: '.db' };
            }
            wordIndex += wordsUsed;
            continue;
        }

        if (line.startsWith('.')) continue;

        const tokens = line.split(/\s+/);
        const op = tokens[0].toLowerCase();
        const argsStr = line.substring(tokens[0].length).trim();
        const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];

        cpu.program[wordIndex] = { op, args, lineNum: i + 1, raw: line };
        wordIndex++;
    }

    for (let j = 0; j < cpu.program.length; j++) {
        if (!cpu.program[j]) {
            cpu.program[j] = { op: 'nop', args: [], lineNum: 1, raw: 'nop' };
        }
    }
}

/* ================= 10. ГЕНЕРАТОР INTEL HEX (.HEX) ================= */

function encodeAvrInstruction(inst) {
    if (!inst) return [0x00, 0x00];
    const op = inst.op.toLowerCase();
    const a = inst.args;

    try {
        switch (op) {
            case 'nop': return [0x00, 0x00];
            case 'sec': return [0x78, 0x94];
            case 'clc': return [0x88, 0x94];
            case 'sei': return [0x78, 0x94];
            case 'cli': return [0xF8, 0x94];
            case 'ret': return [0x08, 0x95];
            case 'reti': return [0x18, 0x95];
            case 'break': return [0x98, 0x95];
            case 'lpm': {
                if (a.length >= 2 && a[1].includes('+')) {
                    const rd = parseReg(a[0]);
                    const code = 0x9005 | (rd << 4);
                    return [code & 0xFF, (code >> 8) & 0xFF];
                }
                return [0xC8, 0x95];
            }
            case 'ldi': {
                const rd = parseReg(a[0]) - 16;
                const k = parseVal(a[1]) & 0xFF;
                const code = 0xE000 | ((k & 0xF0) << 4) | (rd << 4) | (k & 0x0F);
                return [code & 0xFF, (code >> 8) & 0xFF];
            }
            case 'mov': {
                const rd = parseReg(a[0]), rr = parseReg(a[1]);
                const code = 0x2C00 | ((rr & 0x10) << 5) | (rd << 4) | (rr & 0x0F);
                return [code & 0xFF, (code >> 8) & 0xFF];
            }
            case 'add': {
                const rd = parseReg(a[0]), rr = parseReg(a[1]);
                const code = 0x0C00 | ((rr & 0x10) << 5) | (rd << 4) | (rr & 0x0F);
                return [code & 0xFF, (code >> 8) & 0xFF];
            }
            case 'sub': {
                const rd = parseReg(a[0]), rr = parseReg(a[1]);
                const code = 0x1800 | ((rr & 0x10) << 5) | (rd << 4) | (rr & 0x0F);
                return [code & 0xFF, (code >> 8) & 0xFF];
            }
            case 'subi': {
                const rd = parseReg(a[0]) - 16;
                const k = parseVal(a[1]) & 0xFF;
                const code = 0x5000 | ((k & 0xF0) << 4) | (rd << 4) | (k & 0x0F);
                return [code & 0xFF, (code >> 8) & 0xFF];
            }
            case 'cpi': {
                const rd = parseReg(a[0]) - 16;
                const k = parseVal(a[1]) & 0xFF;
                const code = 0x3000 | ((k & 0xF0) << 4) | (rd << 4) | (k & 0x0F);
                return [code & 0xFF, (code >> 8) & 0xFF];
            }
            case 'in': {
                const rd = parseReg(a[0]);
                const port = (resolveIoRamAddr(a[1]) - IO_OFFSET) & 0x3F;
                const code = 0xB000 | ((port & 0x30) << 5) | (rd << 4) | (port & 0x0F);
                return [code & 0xFF, (code >> 8) & 0xFF];
            }
            case 'out': {
                const port = (resolveIoRamAddr(a[0]) - IO_OFFSET) & 0x3F;
                const rr = parseReg(a[1]);
                const code = 0xB800 | ((port & 0x30) << 5) | (rr << 4) | (port & 0x0F);
                return [code & 0xFF, (code >> 8) & 0xFF];
            }
            case 'sts': {
                const addr = resolveDataRamAddr(a[0]) & 0xFFFF;
                const rr = parseReg(a[1]);
                const code1 = 0x9200 | (rr << 4);
                return [code1 & 0xFF, (code1 >> 8) & 0xFF, addr & 0xFF, (addr >> 8) & 0xFF];
            }
            case 'lds': {
                const rd = parseReg(a[0]);
                const addr = resolveDataRamAddr(a[1]) & 0xFFFF;
                const code1 = 0x9000 | (rd << 4);
                return [code1 & 0xFF, (code1 >> 8) & 0xFF, addr & 0xFF, (addr >> 8) & 0xFF];
            }
            case 'jmp': {
                const target = resolveLabel(a[0], 0) || 0;
                const code1 = 0x940C;
                return [code1 & 0xFF, (code1 >> 8) & 0xFF, target & 0xFF, (target >> 8) & 0xFF];
            }
            case 'rjmp': {
                const target = resolveLabel(a[0], 0) || 0;
                const offset = (target - (cpu.pc + 1)) & 0x0FFF;
                const code = 0xC000 | offset;
                return [code & 0xFF, (code >> 8) & 0xFF];
            }
            case 'bst': {
                const rd = parseReg(a[0]);
                const bit = parseVal(a[1]) & 0x07;
                const code = 0xFA00 | (rd << 4) | bit;
                return [code & 0xFF, (code >> 8) & 0xFF];
            }
            case 'brtc': {
                const target = resolveLabel(a[0], 0) || 0;
                const offset = (target - (cpu.pc + 1)) & 0x7F;
                const code = 0xF400 | (offset << 3) | 0x04;
                return [code & 0xFF, (code >> 8) & 0xFF];
            }
            case 'breq': {
                const target = resolveLabel(a[0], 0) || 0;
                const offset = (target - (cpu.pc + 1)) & 0x7F;
                const code = 0xF001 | (offset << 3);
                return [code & 0xFF, (code >> 8) & 0xFF];
            }
        }
    } catch(e) {}
    return [0x00, 0x00];
}

function exportIntelHex() {
    parseProgram(document.getElementById('asmCode').value);
    if (cpu.error) {
        alert('Невозможно создать .HEX: обнаружена ошибка в коде:\n' + cpu.error);
        return;
    }

    const hexBuffer = new Uint8Array(32768);
    // Копирование байтов данных .db
    for (let i = 0; i < cpu.flashBytes.length; i++) {
        hexBuffer[i] = cpu.flashBytes[i];
    }

    // Кодирование ассемблерных команд в машинные слова
    let bytePtr = 0;
    for (let i = 0; i < cpu.program.length; i++) {
        const inst = cpu.program[i];
        if (inst && inst.raw !== '.db') {
            const bytes = encodeAvrInstruction(inst);
            for (let b = 0; b < bytes.length; b++) {
                hexBuffer[i * 2 + b] = bytes[b];
            }
        }
    }

    let maxAddr = Math.max(cpu.program.length * 2, 32);
    while (maxAddr > 0 && hexBuffer[maxAddr - 1] === 0) maxAddr--;
    if (maxAddr % 16 !== 0) maxAddr = (Math.floor(maxAddr / 16) + 1) * 16;

    let hexText = '';
    for (let addr = 0; addr < maxAddr; addr += 16) {
        const len = 16;
        let sum = len + ((addr >> 8) & 0xFF) + (addr & 0xFF) + 0x00;
        let line = ':' + len.toString(16).padStart(2, '0').toUpperCase();
        line += addr.toString(16).padStart(4, '0').toUpperCase() + '00';

        for (let b = 0; b < 16; b++) {
            const val = hexBuffer[addr + b] || 0;
            line += val.toString(16).padStart(2, '0').toUpperCase();
            sum += val;
        }

        const checksum = ((~sum + 1) & 0xFF).toString(16).padStart(2, '0').toUpperCase();
        hexText += line + checksum + '\n';
    }

    hexText += ':00000001FF\n'; // Конец файла Intel HEX

    const blob = new Blob([hexText], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'firmware.hex';
    a.click();
}

/* ================= 11. ПАМЯТЬ И ДОСТУП К ПЕРИФЕРИИ ================= */

function writeRAM(addr, val) {
    val &= 0xFF;
    if (addr < 0 || addr >= cpu.ram.length) return;

    if (addr === IO.PINB) { writeRAM(IO.PORTB, readRAM(IO.PORTB) ^ val); return; }
    if (addr === IO.PINC) { writeRAM(IO.PORTC, readRAM(IO.PORTC) ^ val); return; }
    if (addr === IO.PIND) { writeRAM(IO.PORTD, readRAM(IO.PORTD) ^ val); return; }

    if (addr === IO.UDR0) {
        cpu.uartLog += String.fromCharCode(val);
        // Моделирование занятости передатчика UART
        cpu.ram[IO.UCSR0A] &= ~(1 << 5); // UDRE0 = 0 (занят)
        cpu.ram[IO.UCSR0A] &= ~(1 << 6); // TXC0 = 0 (передача)
        cpu.uartTxBusyCycles = 4;        // Через 4 такта регистр освободится
        appendUartTerminal(String.fromCharCode(val));
    }

    cpu.ram[addr] = val;
    if (addr >= 0 && addr < 32) cpu.r[addr] = val;
    if (addr === IO.SPL) cpu.sp = (cpu.sp & 0xFF00) | val;
    else if (addr === IO.SPH) cpu.sp = (cpu.sp & 0x00FF) | (val << 8);
}

function readRAM(addr) {
    if (addr >= 0 && addr < 32) return cpu.r[addr];

    if (addr === IO.UDR0) {
        if (cpu.rxBuffer.length > 0) {
            const b = cpu.rxBuffer.shift();
            if (cpu.rxBuffer.length === 0) cpu.ram[IO.UCSR0A] &= ~(1 << 7);
            return b;
        }
        cpu.ram[IO.UCSR0A] &= ~(1 << 7);
        return 0;
    }
    return cpu.ram[addr] || 0;
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

/* ================= 12. ДИСПЕТЧЕР ПРЕРЫВАНИЙ ================= */

function applyHardwarePins() {
    let pinb = 0xFF, pind = 0xFF, pinc = 0xFF;
    vButtons.forEach(btn => {
        if (btn.pressed) {
            if (btn.port === 'B') pinb &= ~(1 << btn.pin);
            if (btn.port === 'D') pind &= ~(1 << btn.pin);
            if (btn.port === 'C') pinc &= ~(1 << btn.pin);
        }
    });

    const ddrb = readRAM(IO.DDRB), portb = readRAM(IO.PORTB);
    const ddrd = readRAM(IO.DDRD), portd = readRAM(IO.PORTD);
    const ddrc = readRAM(IO.DDRC), portc = readRAM(IO.PORTC);

    cpu.ram[IO.PINB] = (pinb & ~ddrb) | (portb & ddrb);
    cpu.ram[IO.PIND] = (pind & ~ddrd) | (portd & ddrd);
    cpu.ram[IO.PINC] = (pinc & ~ddrc) | (portc & ddrc);
}

function checkInterrupts() {
    const curPind = readRAM(IO.PIND);
    const eicra = readRAM(IO.EICRA);
    let eifr = readRAM(IO.EIFR);

    const isc0 = eicra & 0x03;
    const pd2Now = (curPind >> 2) & 1;
    const pd2Prev = (cpu.prevPinD >> 2) & 1;

    // Внешнее прерывание INT0 (PD2)
    if (isc0 === 0 && pd2Now === 0) eifr |= (1 << 0);
    else if (isc0 === 1 && pd2Now !== pd2Prev) eifr |= (1 << 0);
    else if (isc0 === 2 && pd2Prev === 1 && pd2Now === 0) eifr |= (1 << 0); // По спаду
    else if (isc0 === 3 && pd2Prev === 0 && pd2Now === 1) eifr |= (1 << 0); // По фронту
    cpu.ram[IO.EIFR] = eifr;

    cpu.prevPinD = curPind;

    if (cpu.sreg.I === 1) {
        const eimsk = readRAM(IO.EIMSK);
        const ucsrb = readRAM(IO.UCSR0B);
        const ucsra = readRAM(IO.UCSR0A);

        if ((eimsk & 0x01) && (eifr & 0x01)) {
            cpu.ram[IO.EIFR] &= ~0x01;
            dispatchInterrupt(VECTORS.INT0, '__vector_int0');
            return;
        }

        // Прерывание UART по завершению приема (USART_RX)
        if ((ucsrb & (1 << 7)) && (ucsra & (1 << 7))) {
            dispatchInterrupt(VECTORS.USART_RX, '__vector_usart_rx');
            return;
        }

        // Прерывание UART по опустошению буфера (USART_UDRE)
        if ((ucsrb & (1 << 5)) && (ucsra & (1 << 5))) {
            dispatchInterrupt(VECTORS.USART_UDRE, '__vector_usart_udre');
            return;
        }

        // Прерывание UART по завершению передачи (USART_TX)
        if ((ucsrb & (1 << 6)) && (ucsra & (1 << 6))) {
            cpu.ram[IO.UCSR0A] &= ~(1 << 6);
            dispatchInterrupt(VECTORS.USART_TX, '__vector_usart_tx');
            return;
        }
    }
}

function dispatchInterrupt(vectorWordAddr, vectorLabel) {
    pushStack(cpu.pc & 0xFF);
    pushStack((cpu.pc >> 8) & 0xFF);
    cpu.sreg.I = 0;

    if (currentLang === 'c' && cpu.labels[vectorLabel] !== undefined) {
        cpu.pc = cpu.labels[vectorLabel];
    } else if (cpu.program[vectorWordAddr]) {
        cpu.pc = vectorWordAddr;
    } else if (cpu.labels[vectorLabel] !== undefined) {
        cpu.pc = cpu.labels[vectorLabel];
    }
}

/* ================= 13. ШАГ ПРОЦЕССОРА ================= */

function cpuStep(silent = false) {
    if (cpu.pc < 0) cpu.pc = 0;
    if (cpu.error) { haltExecution(); if (!silent) updateUI(); return; }

    if (cpu.program.length === 0) parseProgram(document.getElementById('asmCode').value);
    if (cpu.program.length === 0 || cpu.error || cpu.pc >= cpu.program.length) {
        haltExecution(); if (!silent) updateUI(); return;
    }

    const inst = cpu.program[cpu.pc];
    if (!inst) { haltExecution(); if (!silent) updateUI(); return; }

    cpu.prevR.set(cpu.r);
    const op = inst.op;
    const a = inst.args;
    let nextPC = cpu.pc + 1;

    // Симуляция тайминга опустошения буфера UART (UDRE0)
    if (cpu.uartTxBusyCycles > 0) {
        cpu.uartTxBusyCycles--;
        if (cpu.uartTxBusyCycles === 0) {
            cpu.ram[IO.UCSR0A] |= (1 << 5); // UDRE0 = 1 (буфер пуст)
            cpu.ram[IO.UCSR0A] |= (1 << 6); // TXC0 = 1 (передача завершена)
        }
    }

    switch (op) {
        case 'ldi':  { cpu.r[parseReg(a[0])] = parseVal(a[1]) & 0xFF; break; }
        case 'mov':  { cpu.r[parseReg(a[0])] = cpu.r[parseReg(a[1])]; break; }
        case 'in':   { cpu.r[parseReg(a[0])] = readRAM(resolveIoRamAddr(a[1])); break; }
        case 'out':  { writeRAM(resolveIoRamAddr(a[0]), cpu.r[parseReg(a[1])]); break; }
        case 'lds':  { cpu.r[parseReg(a[0])] = readRAM(resolveDataRamAddr(a[1])); break; }
        case 'sts':  { writeRAM(resolveDataRamAddr(a[0]), cpu.r[parseReg(a[1])]); break; }
        case 'push': { pushStack(cpu.r[parseReg(a[0])]); break; }
        case 'pop':  { cpu.r[parseReg(a[0])] = popStack(); break; }
        case 'clr':  { cpu.r[parseReg(a[0])] = 0; cpu.sreg.Z = 1; break; }
        case 'ser':  { cpu.r[parseReg(a[0])] = 0xFF; break; }

        case 'lpm': {
            let destReg = 0;
            let isPostInc = false;
            if (a.length >= 1) destReg = parseReg(a[0]);
            if (a.length >= 2 && a[1].includes('+')) isPostInc = true;
            const zAddr = getPointerAddr('z');
            cpu.r[destReg] = cpu.flashBytes[zAddr] || 0;
            if (isPostInc) setPointerAddr('z', zAddr + 1);
            break;
        }

        case 'bst': {
            const reg = parseReg(a[0]);
            const bit = parseVal(a[1]);
            cpu.sreg.T = (cpu.r[reg] >> bit) & 1;
            break;
        }
        case 'brtc': {
            if (cpu.sreg.T === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC;
            break;
        }
        case 'brts': {
            if (cpu.sreg.T === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC;
            break;
        }

        case 'sbi': {
            const addr = resolveIoRamAddr(a[0]);
            writeRAM(addr, readRAM(addr) | (1 << parseVal(a[1])));
            break;
        }
        case 'cbi': {
            const addr = resolveIoRamAddr(a[0]);
            writeRAM(addr, readRAM(addr) & ~(1 << parseVal(a[1])));
            break;
        }

        case 'subi': {
            const reg = parseReg(a[0]);
            const res = (cpu.r[reg] - (parseVal(a[1]) & 0xFF)) & 0xFF;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.r[reg] = res;
            break;
        }
        case 'cpi': {
            const reg = parseReg(a[0]);
            const res = (cpu.r[reg] - (parseVal(a[1]) & 0xFF)) & 0xFF;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            break;
        }
        case 'inc': {
            const reg = parseReg(a[0]);
            cpu.r[reg] = (cpu.r[reg] + 1) & 0xFF;
            cpu.sreg.Z = (cpu.r[reg] === 0) ? 1 : 0;
            break;
        }
        case 'dec': {
            const reg = parseReg(a[0]);
            cpu.r[reg] = (cpu.r[reg] - 1) & 0xFF;
            cpu.sreg.Z = (cpu.r[reg] === 0) ? 1 : 0;
            break;
        }

        case 'jmp':
        case 'rjmp': {
            const target = resolveLabel(a[0], inst.lineNum);
            if (target !== null) nextPC = target;
            break;
        }
        case 'breq': { if (cpu.sreg.Z === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brne': { if (cpu.sreg.Z === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }

        case 'sei': { cpu.sreg.I = 1; break; }
        case 'cli': { cpu.sreg.I = 0; break; }
        case 'reti': {
            const high = popStack();
            const low = popStack();
            nextPC = (high << 8) | low;
            cpu.sreg.I = 1;
            break;
        }
        case 'break': { haltExecution(); if (!silent) updateUI(); return; }
        case 'nop': break;
    }

    cpu.pc = nextPC;
    cpu.cycles += CYCLES[op] || 1;

    syncHardwareState();
    checkInterrupts();
    recordAnalyzerSample();

    if (!silent) updateUI();
}

/* ================= 14. СИНХРОНИЗАЦИЯ ПЕРИФЕРИИ И ПЛАТЫ ================= */

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
    applyHardwarePins();

    writeRAM(IO.SPL, cpu.sp & 0xFF);
    writeRAM(IO.SPH, (cpu.sp >> 8) & 0xFF);

    let sregByte = 0;
    const flags = ['C','Z','N','V','S','H','T','I'];
    flags.forEach((f, idx) => { if (cpu.sreg[f]) sregByte |= (1 << idx); });
    cpu.ram[IO.SREG] = sregByte;

    for (let i = 0; i < 32; i++) cpu.ram[i] = cpu.r[i];

    renderHardware();
}

function selectLedPort(portLetter) {
    cpu.selectedPort = portLetter;
    document.querySelectorAll('.port-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('btnPort' + portLetter)?.classList.add('active');
    document.getElementById('ledPortTitle').textContent = 'Линейка светодиодов (Порт ' + portLetter + ')';
    renderHardware();
}

function renderHardware() {
    const portb = readRAM(IO.PORTB);
    const ledPB5 = document.getElementById('ledPB5');
    if (ledPB5) ledPB5.className = 'led-light ' + ((portb & (1 << 5)) ? 'active-led-yellow' : '');

    const portd = readRAM(IO.PORTD);
    const ledTX = document.getElementById('ledTX');
    if (ledTX) ledTX.className = 'led-light ' + ((portd & (1 << 1)) ? 'active-led-green' : '');

    const ledRX = document.getElementById('ledRX');
    if (ledRX) ledRX.className = 'led-light ' + ((portd & (1 << 0)) ? 'active-led-green' : '');

    let currentVal = 0;
    if (cpu.selectedPort === 'D') currentVal = readRAM(IO.PORTD);
    if (cpu.selectedPort === 'B') currentVal = readRAM(IO.PORTB);
    if (cpu.selectedPort === 'C') currentVal = readRAM(IO.PORTC);

    for (let i = 7; i >= 0; i--) {
        const led = document.getElementById('ledPin' + i);
        const bitLbl = document.getElementById('lblPin' + i);
        if (led && bitLbl) {
            bitLbl.textContent = cpu.selectedPort + i;
            led.className = 'led-light ' + ((currentVal & (1 << i)) ? 'active-led-green' : '');
        }
    }
}

/* ================= 15. UART И МОНИТОР ================= */

function appendUartTerminal(char) {
    const term = document.getElementById('uartTerminal');
    if (term) {
        term.textContent = cpu.uartLog || 'UART готов к работе...';
        term.scrollTop = term.scrollHeight;
    }
}

function clearUart() {
    cpu.uartLog = '';
    const term = document.getElementById('uartTerminal');
    if (term) term.textContent = 'UART очищен.';
}

function sendUartInput() {
    const inp = document.getElementById('serialInput');
    if (!inp || !inp.value) return;
    const text = inp.value;
    inp.value = '';

    for (let i = 0; i < text.length; i++) {
        cpu.rxBuffer.push(text.charCodeAt(i));
    }

    cpu.ram[IO.UCSR0A] |= (1 << 7); // RXC0 = 1 (есть входящий байт)
    checkInterrupts();
    updateUI();
}

/* ================= 16. RUNLOOP И УПРАВЛЕНИЕ ================= */

function haltExecution() {
    cpu.running = false;
    clearTimeout(cpu.timer);
    document.getElementById('btnRun')?.classList.remove('running');
    document.getElementById('runIcon').textContent = '▶';
    document.getElementById('runText').textContent = 'Пуск';
}

function toggleRun() {
    if (cpu.error) return;
    if (cpu.pc >= cpu.program.length) cpu.pc = 0;

    cpu.running = !cpu.running;
    const btn = document.getElementById('btnRun');
    if (cpu.running) {
        btn.classList.add('running');
        document.getElementById('runIcon').textContent = '⏸';
        document.getElementById('runText').textContent = 'Пауза';
        runLoop();
    } else {
        haltExecution();
    }
}

function runLoop() {
    if (!cpu.running) return;

    let batchSize = cpu.speed > 50 ? Math.round(cpu.speed / 20) : 1;
    let delay = cpu.speed <= 50 ? Math.floor(1000 / cpu.speed) : 16;

    for (let i = 0; i < batchSize; i++) {
        cpuStep(true);
        if (!cpu.running || cpu.error) {
            haltExecution();
            break;
        }
    }

    updateUI();
    if (cpu.running) cpu.timer = setTimeout(runLoop, delay);
}

function cpuReset() {
    haltExecution();
    cpu.r.fill(0);
    cpu.prevR.fill(0);
    cpu.ram.fill(0);
    cpu.pc = 0;
    cpu.sp = 0x08FF;
    cpu.cycles = 0;
    cpu.sreg = { C:0, Z:0, N:0, V:0, S:0, H:0, T:0, I:0 };
    cpu.rxBuffer = [];
    cpu.uartLog = '';
    cpu.uartTxBusyCycles = 0;

    // Сброс UART: UDRE0 = 1 (буфер пуст)
    cpu.ram[IO.UCSR0A] = (1 << 5);

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

/* ================= 17. ЛОГИЧЕСКИЙ АНАЛИЗАТОР ================= */

const ALL_CHANNELS = [
    { id: 'PD0', port: 'D', pin: 0, label: 'PD0 (RX)', color: '#38bdf8' },
    { id: 'PD1', port: 'D', pin: 1, label: 'PD1 (TX)', color: '#06b6d4' },
    { id: 'PD2', port: 'D', pin: 2, label: 'PD2 (INT0)', color: '#3b82f6' },
    { id: 'PD3', port: 'D', pin: 3, label: 'PD3 (INT1)', color: '#6366f1' },
    { id: 'PD4', port: 'D', pin: 4, label: 'PD4 (K3)',  color: '#8b5cf6' },
    { id: 'PB0', port: 'B', pin: 0, label: 'PB0 (K4)',  color: '#f43f5e' },
    { id: 'PB5', port: 'B', pin: 5, label: 'PB5 (LED L)', color: '#eab308' }
];

let selectedChannelIds = new Set(['PD2', 'PD1', 'PD0', 'PB5', 'PB0']);
const analyzer = { zoom: 1.0, maxSamples: 1500, samples: [] };

function renderChannelSelector() {
    const container = document.getElementById('analyzerChannelSelector');
    if (!container) return;
    container.innerHTML = ALL_CHANNELS.map(ch => {
        const active = selectedChannelIds.has(ch.id);
        const style = active ? ('border-color:' + ch.color + '; color:' + ch.color + ';') : '';
        return '<span class="ch-badge ' + (active ? 'active' : '') + '" style="' + style + '" onclick="toggleChannel(\'' + ch.id + '\')">' + ch.label + '</span>';
    }).join('');
}

function toggleChannel(chId) {
    if (selectedChannelIds.has(chId)) {
        if (selectedChannelIds.size > 1) selectedChannelIds.delete(chId);
    } else selectedChannelIds.add(chId);
    renderChannelSelector();
    resizeAnalyzerCanvas();
}

function selectChannelPreset(type) {
    if (type === 'all') selectedChannelIds = new Set(ALL_CHANNELS.map(c => c.id));
    else if (type === 'd') selectedChannelIds = new Set(['PD0','PD1','PD2','PD3','PD4']);
    else if (type === 'b') selectedChannelIds = new Set(['PB0','PB5']);
    renderChannelSelector();
    resizeAnalyzerCanvas();
}

function clearAnalyzer() {
    analyzer.samples = [];
    recordAnalyzerSample();
    drawLogicAnalyzer();
}

function zoomAnalyzer(delta) {
    if (delta > 0 && analyzer.zoom < 8) analyzer.zoom *= 1.5;
    if (delta < 0 && analyzer.zoom > 0.4) analyzer.zoom /= 1.5;
    document.getElementById('analyzerZoomVal').textContent = analyzer.zoom.toFixed(1) + 'x';
    drawLogicAnalyzer();
}

function recordAnalyzerSample() {
    if (!activePanels.analyzer) return;
    const pind = readRAM(IO.PIND), portd = readRAM(IO.PORTD);
    const pinb = readRAM(IO.PINB), portb = readRAM(IO.PORTB);

    function getPin(p, bit) {
        if (p === 'D') return (portd & (1 << bit)) ? 1 : ((pind >> bit) & 1);
        if (p === 'B') return (portb & (1 << bit)) ? 1 : ((pinb >> bit) & 1);
        return 0;
    }

    const sample = { cycle: cpu.cycles, vals: {} };
    ALL_CHANNELS.forEach(ch => {
        if (selectedChannelIds.has(ch.id)) sample.vals[ch.id] = getPin(ch.port, ch.pin);
    });

    analyzer.samples.push(sample);
    if (analyzer.samples.length > analyzer.maxSamples) analyzer.samples.shift();
}

function resizeAnalyzerCanvas() {
    const canvas = document.getElementById('logicCanvas');
    const wrapper = document.getElementById('canvasWrapper');
    if (!canvas || !wrapper) return;

    const activeList = ALL_CHANNELS.filter(c => selectedChannelIds.has(c.id));
    const h = Math.max(wrapper.clientHeight - 4, activeList.length * 32 + 20);
    const w = Math.max(wrapper.clientWidth - 4, 600);

    canvas.width = w;
    canvas.height = h;
    drawLogicAnalyzer();
}

function drawLogicAnalyzer() {
    if (!activePanels.analyzer) return;
    const canvas = document.getElementById('logicCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    ctx.fillStyle = '#040508';
    ctx.fillRect(0, 0, w, h);

    const activeList = ALL_CHANNELS.filter(c => selectedChannelIds.has(c.id));
    const trackH = 32;
    const stepX = 5 * analyzer.zoom;
    const totalVisible = Math.floor((w - 95) / stepX);
    const startIdx = Math.max(0, analyzer.samples.length - totalVisible);

    activeList.forEach((ch, idx) => {
        const baseY = 20 + idx * trackH;
        const lowY = baseY + trackH - 12;

        ctx.strokeStyle = '#151c28';
        ctx.beginPath();
        ctx.moveTo(90, lowY);
        ctx.lineTo(w, lowY);
        ctx.stroke();

        ctx.fillStyle = ch.color;
        ctx.font = 'bold 11px monospace';
        ctx.fillText(ch.label, 8, lowY - 3);

        ctx.strokeStyle = ch.color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        if (analyzer.samples.length === 0) return;

        let prevVal = analyzer.samples[startIdx]?.vals[ch.id] || 0;
        let prevX = 95;
        let prevY = prevVal ? baseY : lowY;
        ctx.moveTo(prevX, prevY);

        for (let i = startIdx + 1; i < analyzer.samples.length; i++) {
            const curVal = analyzer.samples[i].vals[ch.id];
            const curX = 95 + (i - startIdx) * stepX;
            const curY = curVal ? baseY : lowY;
            if (curVal !== prevVal) {
                ctx.lineTo(curX, prevY);
                ctx.lineTo(curX, curY);
            } else {
                ctx.lineTo(curX, curY);
            }
            prevVal = curVal;
            prevX = curX;
            prevY = curY;
        }
        ctx.stroke();
    });
}

/* ================= 18. УМНЫЙ WATCH И ИНСТРУМЕНТЫ ================= */

function renderWatchTable() {
    const tbody = document.getElementById('watchTableBody');
    const countBadge = document.getElementById('watchVarsCount');
    if (!tbody) return;

    let html = '';

    if (cpu.symbols && cpu.symbols.length > 0) {
        if (countBadge) countBadge.textContent = 'Переменных: ' + cpu.symbols.length;
        cpu.symbols.forEach(sym => {
            let val = 0;
            if (sym.locType === 'reg') {
                const regIdx = parseReg(sym.location);
                val = cpu.r[regIdx];
            }
            html += '<tr>';
            html += '<td><b>' + sym.name + '</b></td>';
            html += '<td><span class="watch-type-badge">' + sym.type + '</span></td>';
            html += '<td>' + val + ' (DEC)</td>';
            html += '<td>0x' + val.toString(16).padStart(2, '0').toUpperCase() + '</td>';
            html += '<td>0b' + val.toString(2).padStart(8, '0') + '</td>';
            html += '<td><span class="watch-loc-badge">' + sym.location + '</span></td>';
            html += '</tr>';
        });
    } else {
        // Режим по умолчанию: инспекция регистров R16..R24
        if (countBadge) countBadge.textContent = 'Регистры: R16..R24';
        for (let i = 16; i <= 24; i++) {
            const val = cpu.r[i];
            html += '<tr>';
            html += '<td><b>R' + i + '</b></td>';
            html += '<td><span class="watch-type-badge">reg</span></td>';
            html += '<td>' + val + '</td>';
            html += '<td>0x' + val.toString(16).padStart(2, '0').toUpperCase() + '</td>';
            html += '<td>0b' + val.toString(2).padStart(8, '0') + '</td>';
            html += '<td><span class="watch-loc-badge">CPU</span></td>';
            html += '</tr>';
        }
    }
    tbody.innerHTML = html;
}

function onConverterInput(source) {
    const decInp = document.getElementById('convDec');
    const hexInp = document.getElementById('convHex');
    const binInp = document.getElementById('convBin');
    if (!decInp || !hexInp || !binInp) return;

    let val = 0;
    if (source === 'dec') val = parseInt(decInp.value, 10) || 0;
    if (source === 'hex') val = parseInt(hexInp.value, 16) || 0;
    if (source === 'bin') val = parseInt(binInp.value, 2) || 0;

    val &= 0xFFFF;
    if (source !== 'dec') decInp.value = val;
    if (source !== 'hex') hexInp.value = '0x' + val.toString(16).toUpperCase();
    if (source !== 'bin') binInp.value = '0b' + val.toString(2);
}

/* ================= 19. ОБНОВЛЕНИЕ UI И ДАМПОВ ================= */

function updateUI() {
    const cycleElem = document.getElementById('cycleCounter');
    if (cycleElem) cycleElem.textContent = 'Такты: ' + cpu.cycles;

    const statusElem = document.getElementById('compilerStatus');
    if (cpu.error) {
        statusElem.textContent = '❌ ' + cpu.error;
        statusElem.parentElement.classList.add('has-error-text');
    } else {
        statusElem.textContent = 'Строка: ' + (cpu.program[cpu.pc]?.lineNum || 'END');
        statusElem.parentElement.classList.remove('has-error-text');
    }

    if (activePanels.cpu) {
        document.getElementById('valPC').textContent = '0x' + cpu.pc.toString(16).padStart(4, '0').toUpperCase();
        document.getElementById('valSP').textContent = '0x' + cpu.sp.toString(16).padStart(4, '0').toUpperCase();
        document.getElementById('valX').textContent = '0x' + getPointerAddr('x').toString(16).padStart(4, '0').toUpperCase();
        document.getElementById('valY').textContent = '0x' + getPointerAddr('y').toString(16).padStart(4, '0').toUpperCase();
        document.getElementById('valZ').textContent = '0x' + getPointerAddr('z').toString(16).padStart(4, '0').toUpperCase();

        const fGrid = document.getElementById('flagsGrid');
        if (fGrid) {
            fGrid.innerHTML = ['I','T','H','S','V','N','Z','C'].map(f =>
                '<div class="flag-cell ' + (cpu.sreg[f] ? 'flag-on' : '') + '"><span>' + f + '</span><b>' + cpu.sreg[f] + '</b></div>'
            ).join('');
        }

        const rGrid = document.getElementById('registersGrid');
        if (rGrid) {
            let rHtml = '';
            for (let i = 0; i < 32; i++) {
                rHtml += '<div class="reg-cell ' + (cpu.r[i] !== cpu.prevR[i] ? 'changed' : '') + '">';
                rHtml += '<span class="reg-name">R' + i + '</span>';
                rHtml += '<span class="reg-val-hex">0x' + cpu.r[i].toString(16).padStart(2, '0').toUpperCase() + '</span>';
                rHtml += '<span class="reg-val-dec">(' + cpu.r[i] + ')</span></div>';
            }
            rGrid.innerHTML = rHtml;
        }
        renderMemoryDumps();
    }

    if (activePanels.board) renderHardware();
    if (activePanels.tools) renderWatchTable();

    drawLogicAnalyzer();
    renderGutter();
}

function setMemView(view) {
    cpu.memView = view;
    document.getElementById('btnMemRAM')?.classList.toggle('active', view === 'ram');
    document.getElementById('btnMemStack')?.classList.toggle('active', view === 'stack');
    document.getElementById('btnMemFlash')?.classList.toggle('active', view === 'flash');
    document.getElementById('btnMemEEPROM')?.classList.toggle('active', view === 'eeprom');
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
        for (let addr = 0x0100; addr <= 0x0150; addr += 8) {
            let bytes = [];
            for (let b = 0; b < 8; b++) {
                let v = readRAM(addr + b);
                bytes.push(cpu.memFormat === 'dec' ? v.toString(10).padStart(3, '0') : v.toString(16).padStart(2, '0').toUpperCase());
            }
            output += '0x' + addr.toString(16).toUpperCase() + ':  ' + bytes.join('  ') + '\n';
        }
    } else if (cpu.memView === 'flash') {
        for (let addr = 0x0000; addr <= 0x0080; addr += 8) {
            let bytes = [];
            for (let b = 0; b < 8; b++) {
                let v = cpu.flashBytes[addr + b] || 0;
                bytes.push(cpu.memFormat === 'dec' ? v.toString(10).padStart(3, '0') : v.toString(16).padStart(2, '0').toUpperCase());
            }
            output += '0x' + addr.toString(16).padStart(4, '0').toUpperCase() + ':  ' + bytes.join('  ') + '\n';
        }
    }
    memBox.textContent = output;
}

/* ================= 20. РЕДАКТОР, ПОДСВЕТКА И ПЕРЕКЛЮЧЕНИЕ ЯЗЫКОВ ================= */

function escapeHtml(t) {
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightCode(rawText) {
    if (!rawText) return '';
    const lines = rawText.replace(/\r/g, '').split('\n');

    if (currentLang === 'c') {
        return lines.map(line => {
            let code = line, comment = '';
            const cIdx = line.indexOf('//');
            if (cIdx !== -1) { code = line.substring(0, cIdx); comment = line.substring(cIdx); }
            let p = escapeHtml(code)
                .replace(/\b(unsigned\s+char|uint8_t|int8_t|uint16_t|int16_t|uint32_t|int|char|void)\b/g, '<span class="syn-type">$1</span>')
                .replace(/\b(while|for|if|else|return|break|ISR)\b/g, '<span class="syn-kw">$1</span>')
                .replace(/(#define|#include)/g, '<span class="syn-dir">$1</span>')
                .replace(/\b(DDR[BCD]|PORT[BCD]|PIN[BCD]|UCSR0[ABC]|UBRR0[LH]|UDR0)\b/g, '<span class="syn-op">$1</span>')
                .replace(/\b(\$[0-9a-fA-F]+|0x[0-9a-fA-F]+|0b[01]+|-?\d+)\b/g, '<span class="syn-num">$1</span>');
            return p + (comment ? '<span class="syn-com">' + escapeHtml(comment) + '</span>' : '');
        }).join('\n');
    }

    return lines.map(line => {
        let code = line, comment = '';
        const sIdx = line.indexOf(';');
        if (sIdx !== -1) { code = line.substring(0, sIdx); comment = line.substring(sIdx); }
        let p = escapeHtml(code)
            .replace(/^(\s*)([a-zA-Z0-9_]+:)/g, '$1<span class="syn-lbl">$2</span>')
            .replace(/(\.[a-zA-Z0-9_]+)/g, '<span class="syn-dir">$1</span>')
            .replace(/\b(\$[0-9a-fA-F]+|0x[0-9a-fA-F]+|0b[01]+|-?\d+)\b/g, '<span class="syn-num">$1</span>');
        p = p.replace(/\b([a-zA-Z]+)\b/g, (m) => KNOWN_OPS.has(m.toLowerCase()) ? '<span class="syn-op">' + m + '</span>' : m);
        return p + (comment ? '<span class="syn-com">' + escapeHtml(comment) + '</span>' : '');
    }).join('\n');
}

function updateSyntax() {
    const code = document.getElementById('asmCode').value;
    document.getElementById('highlightingContent').innerHTML = highlightCode(code) + '\n';
    validateSourceCode(code, currentLang);
    renderGutter();
}

function switchLanguageTab(lang) {
    const txtArea = document.getElementById('asmCode');
    if (currentLang === 'c' && lang !== 'c') cachedUserCCode = txtArea.value;

    currentLang = lang;
    document.getElementById('btnLangAsm')?.classList.toggle('active', lang === 'asm');
    document.getElementById('btnLangC')?.classList.toggle('active', lang === 'c');
    document.getElementById('btnLangDisasm')?.classList.toggle('active', lang === 'c_asm');

    if (lang === 'c_asm') {
        document.getElementById('editorTitle').textContent = '⚡ Листинг C ➔ ASM';
        txtArea.readOnly = true;
        if (cachedUserCCode) {
            const compiled = compileCToAsm(cachedUserCCode);
            txtArea.value = compiled.map(item => item.asm).join('\n');
        }
    } else {
        txtArea.readOnly = false;
        if (lang === 'c') {
            document.getElementById('editorTitle').textContent = '⚡ Редактор (C)';
            if (cachedUserCCode) txtArea.value = cachedUserCCode;
        } else {
            document.getElementById('editorTitle').textContent = '📝 Редактор (.asm)';
        }
    }
    updateSyntax();
    cpuReset();
}

function renderGutter() {
    const code = document.getElementById('asmCode').value;
    const curLineNum = cpu.program[cpu.pc]?.lineNum || -1;
    const gutter = document.getElementById('lineGutter');
    if (!gutter) return;

    const lines = code.split('\n');
    let html = '';
    for (let i = 1; i <= lines.length; i++) {
        const isCurrentPC = (i === curLineNum);
        const hasErr = cpu.syntaxErrors.has(i);
        html += '<div class="gutter-row ' + (hasErr ? 'has-error' : '') + ' ' + (isCurrentPC ? 'is-pc' : '') + '">' +
                '<span class="pc-arrow">' + (isCurrentPC ? '▶' : '') + '</span>' +
                '<span class="gutter-num">' + i + '</span></div>';
    }
    gutter.innerHTML = html;
}

function clearEditor() {
    document.getElementById('asmCode').value = '';
    cpu.syntaxErrors.clear();
    cachedUserCCode = '';
    updateSyntax();
    cpuReset();
}

function saveCodeToFile() {
    const code = document.getElementById('asmCode').value;
    const ext = (currentLang === 'c') ? '.c' : '.asm';
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'program' + ext;
    a.click();
}

function loadCodeFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('asmCode').value = e.target.result;
        switchLanguageTab(file.name.endsWith('.c') ? 'c' : 'asm');
    };
    reader.readAsText(file);
}

/* ================= 21. БАЗА ПРОГРАММ (ВКЛЮЧАЯ ТЕМУ 6: UART) ================= */

const PROGRAMS = {
    // 1. Прием символа 'M' по прерыванию USART_RX (Тема 6)
    c_uart_rx_led: {
        hint: "<b>Тема 6:</b> Прием символа 'M' через UART по прерыванию <code>USART_RX_vect</code>. Зажигает светодиод L (PB5). Отправьте символ 'M' через консоль!",
        lang: "c",
        code: `#include <avr/io.h>
#include <avr/interrupt.h>

ISR (USART_RX_vect)
{
    uint8_t data = UDR0;
    if (data == 'M')
    {
        PORTB |= (1 << PB5);    // Зажечь светодиод L
    }
    else
    {
        PORTB &= ~(1 << PB5);   // Погасить светодиод L
    }
}

int main(void)
{
    DDRB |= (1 << PB5);         // PB5 на выход
    PORTB &= ~(1 << PB5);

    UBRR0 = 103;
    UCSR0B = (1 << RXEN0) | (1 << RXCIE0);   // Приемник и прерывание по приему
    UCSR0C = (1 << UCSZ01) | (1 << UCSZ00); // 8 бит данных

    sei();

    while (1)
    {
    }
}`
    },

    // 2. Отправка символа '>' по кнопке INT0 (Тема 6)
    asm_uart_tx_button: {
        hint: "<b>Тема 6:</b> Нажмите кнопку K1 (PD2). Срабатывает прерывание INT0, и в UDR0 отправляется символ '>' (0x3E).",
        lang: "asm",
        code: `.include "m328Pdef.inc"

.org 0x0000
    jmp Reset
.org 0x0002
    jmp knopka

Reset:
    ldi r16, 0x03
    sts EICRA, r16
    ldi r16, 0x01
    out EIMSK, r16

    cbi DDRD, 2
    sbi PORTD, 2

    ldi r16, 0x00
    sts UBRR0H, r16
    ldi r16, 103
    sts UBRR0L, r16

    ldi r16, (1 << TXEN0)
    sts UCSR0B, r16

    ldi r16, (1 << UCSZ01) | (1 << UCSZ00)
    sts UCSR0C, r16

    sei

main:
    jmp main

knopka:
    ldi r16, 0x3E       ; Символ '>'
    sts UDR0, r16
    reti`
    },

    // 3. Непрерывная передача строки из Flash-памяти (LPM и опрос UDRE0) (Тема 6)
    asm_uart_flash_string: {
        hint: "<b>Тема 6:</b> Чтение строки из Flash через <code>lpm r16, Z+</code> с анализом готовности буфера <code>UDRE0</code> (бит 5 UCSR0A).",
        lang: "asm",
        code: `.include "m328Pdef.inc"

.org 0x0000
    jmp Reset

Reset:
    ldi r16, 0x00
    sts UBRR0H, r16
    ldi r16, 103
    sts UBRR0L, r16
    ldi r16, (1 << TXEN0)
    sts UCSR0B, r16
    ldi r16, (1 << UCSZ01) | (1 << UCSZ00)
    sts UCSR0C, r16
    sei

main:
    ldi ZL, low(Msg << 1)
    ldi ZH, high(Msg << 1)
    ldi r18, 0x17       ; Длина строки (23 байта)

send:
    lpm r16, Z+
    sts UDR0, r16
    subi r18, 0x01

repeat:
    lds r17, UCSR0A
    bst r17, 5          ; Бит UDRE0 (готовность буфера)
    brtc repeat
    cpi r18, 0x00
    breq main
    jmp send

.cseg
Msg: .db "Atmega328P:ReadyToWork", '\\n'`
    },

    test_all: {
        hint: "Комплексный тест ядра: проверка инструкций АЛУ, регистров и всех флагов регистра SREG.",
        lang: "asm",
        code: `.include "m328pdef.inc"
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
    sei
    cli
    nop
    ldi r16, 0x0F
    ldi r17, 0x01
    add r16, r17
    break
finish:
    rjmp finish`
    },

    led_running: {
        hint: "Бегущий огонёк по светодиодам Порта D.",
        lang: "asm",
        code: `.include "m328pdef.inc"
start:
    ser r16
    out DDRD, r16
    ldi r17, 1
loop:
    out PORTD, r17
    lsl r17
    brne loop
    ldi r17, 1
    rjmp loop`
    },

    uart_tx: {
        hint: "Вывод символов текста напрямую в виртуальный регистр UDR0.",
        lang: "asm",
        code: `.include "m328pdef.inc"
start:
    ldi r16, 0x48    ; 'H'
    sts UDR0, r16
    ldi r16, 0x69    ; 'i'
    sts UDR0, r16
    ldi r16, 0x21    ; '!'
    sts UDR0, r16
    ldi r16, 0x0A    ; '\\n'
    sts UDR0, r16
stop:
    break`
    },

    sort_ram: {
        hint: "Сортировка массива из 5 чисел в ОЗУ (0x0100..0x0104) методом пузырька.",
        lang: "asm",
        code: `.include "m328pdef.inc"
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
    break`
    },

    c_interrupt_int0: {
        hint: "Внешнее прерывание INT0 по спаду (K1 на PD2) переключает светодиоды RX и TX.",
        lang: "c",
        code: `#include <avr/io.h>
#include <avr/interrupt.h>

ISR(INT0_vect)
{
    PORTD ^= (1 << PORTD0) | (1 << PORTD1);
}

int main(void)
{
    EICRA = (1 << ISC01);
    EIMSK = (1 << INT0);
    DDRD |= (1 << DDD0) | (1 << DDD1);
    PORTD |= (1 << PORTD2); 
    sei();

    while (1) { }
}`
    },

    c_blink_counter: {
        hint: "Мигание светодиодом PB5 через программный счетчик до 800 000.",
        lang: "c",
        code: `#define F_CPU 16000000UL
#include <avr/io.h>

int main(void)
{
    DDRB |= (1 << DDB5);
    uint32_t x = 0;
    int flag = 0;

    while (1)
    {
        if (x >= 800000)
        {
            if (flag == 0)
            {
                PORTB |= (1 << PORTB5);
                flag = 1;
            }
            else
            {
                PORTB &= ~(1 << PORTB5);
                flag = 0;
            }
            x = 0;
        }
        x++;
    }
}`
    },

    c_zadanie5: {
        hint: "Кнопки K1, K2, K3 управляют светодиодами PD0, PD1 и PB5.",
        lang: "c",
        code: `#define F_CPU 16000000UL
#include <avr/io.h>

int main(void)
{
    DDRD |= (1 << DDD0) | (1 << DDD1);
    DDRB |= (1 << DDB5);
    PORTD |= (1 << PORTD2) | (1 << PORTD3) | (1 << PORTD4);

    while (1)
    {
    }
}`
    },

    c_example3: {
        hint: "Опрос кнопки K4 (PB0) и включение светодиода PB5.",
        lang: "c",
        code: `#include <avr/io.h>

int main(void)
{
    DDRB = 0x20;
    PORTB |= 0x01;

    while (1)
    {
        if ((PINB & 0x01) == 0)
            PORTB |= 0x20;
        else
            PORTB &= ~0x20;
    }
}`
    }
};

function loadSelectedExample() {
    const key = document.getElementById('exampleSelector').value;
    const banner = document.getElementById('hintBanner');
    const p = PROGRAMS[key];
    if (!p) return;

    cachedUserCCode = '';
    const txtArea = document.getElementById('asmCode');

    currentLang = p.lang || 'asm';
    document.getElementById('btnLangAsm')?.classList.toggle('active', currentLang === 'asm');
    document.getElementById('btnLangC')?.classList.toggle('active', currentLang === 'c');
    document.getElementById('btnLangDisasm')?.classList.toggle('active', false);
    document.getElementById('editorTitle').textContent = (currentLang === 'c') ? '⚡ Редактор (C)' : '📝 Редактор (.asm)';
    txtArea.readOnly = false;

    txtArea.value = p.code;
    if (currentLang === 'c') cachedUserCCode = p.code;

    if (banner) {
        if (!p.hint) banner.style.display = 'none';
        else {
            banner.style.display = 'flex';
            document.getElementById('hintText').innerHTML = p.hint;
        }
    }

    updateSyntax();
    cpuReset();
}

/* ================= 22. ИНИЦИАЛИЗАЦИЯ И СТАРТ ================= */

document.addEventListener('DOMContentLoaded', () => {
    const txtArea = document.getElementById('asmCode');
    const highlighting = document.getElementById('highlighting');
    const ghostOverlay = document.getElementById('ghostOverlay');
    const gutter = document.getElementById('lineGutter');

    txtArea.addEventListener('input', () => {
        updateSyntax();
        updateGhostAutocomplete();
        cpuReset();
    });

    txtArea.addEventListener('scroll', () => {
        highlighting.scrollTop = txtArea.scrollTop;
        highlighting.scrollLeft = txtArea.scrollLeft;
        if (ghostOverlay) {
            ghostOverlay.scrollTop = txtArea.scrollTop;
            ghostOverlay.scrollLeft = txtArea.scrollLeft;
        }
        gutter.scrollTop = txtArea.scrollTop;
    });

    txtArea.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            if (currentGhostSuggestion) {
                e.preventDefault();
                applyGhostCompletion();
            }
        }
    });

    window.addEventListener('resize', () => {
        resizeAnalyzerCanvas();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'F11') { e.preventDefault(); cpuStep(); }
    });

    initDragAndDrop();
    applyAppZoom();
    renderChannelSelector();
    loadSelectedExample();

    if (window.innerWidth <= 900) {
        togglePanel('editor');
    }
});
