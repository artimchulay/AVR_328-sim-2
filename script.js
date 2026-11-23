
/* ==========================================================================
   AVR ATmega328P Studio & Logic Analyzer Engine (script.js) - COMPLETE
   - Шаг назад (cpuHistory + cpuStepBack + Shift+F11)
   - Единое меню файлов (handleFileAction) и ручная скорость процессора
   - Растягивание панелей вбок (.panel-resizer) + Drag-and-Drop + Zoom
   - Автоотступы при переходе на новую строку и авто-сдвиг '}'
   - Кремовая и тёмная темы (toggleTheme), шаблоны tpl_asm и tpl_c
   - Полный компилятор Micro-C, парсер ASM, АЦП/SREG/UART/LCD и Intel HEX
   ========================================================================== */

/* ================= 1. КАРТА РЕГИСТРОВ И ВЕКТОРОВ ================= */

const IO = {
    PINB:   0x23, DDRB:   0x24, PORTB:  0x25,
    PINC:   0x26, DDRC:   0x27, PORTC:  0x28,
    PIND:   0x29, DDRD:   0x2A, PORTD:  0x2B,
    EECR:   0x3F, EEDR:   0x40, EEARL:  0x41, EEARH:  0x42,
    TCCR0A: 0x44, TCCR0B: 0x45, TCNT0:  0x46, OCR0A:  0x47, OCR0B:  0x48,
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
    sei: 1, cli: 1, sbi: 2, cbi: 2, sbis: 1, sbic: 1, sbrs: 1, sbrc: 1, bst: 1, bld: 1, lpm: 3,
    mul: 2, muls: 2,
    lsl: 1, lsr: 1, asr: 1, rol: 1, ror: 1, cp: 1, cpc: 1, cpi: 1, cpse: 1,
    adiw: 2, sbiw: 2, rjmp: 2, jmp: 3, call: 4, ret: 4, reti: 4,
    lds: 2, sts: 2, ld: 1, st: 1, push: 2, pop: 2,
    breq: 1, brne: 1, brcs: 1, brcc: 1, brlo: 1, brsh: 1,
    brmi: 1, brpl: 1, brge: 1, brlt: 1, brhs: 1, brhc: 1, brts: 1, brtc: 1,
    brvs: 1, brvc: 1,
    swap: 1, movw: 1, sbr: 1, cbr: 1, mulsu: 2, rcall: 3, brls: 1, brhi: 1, sleep: 1, wdr: 1
};

/* ================= 2. СОСТОЯНИЕ ПРОЦЕССОРА ================= */

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

const MAX_CPU_HISTORY = 300;
let cpuHistory = [];
let panelWeights = (function() {
    try {
        return JSON.parse(localStorage.getItem('avr_panel_weights')) || {};
    } catch (e) { return {}; }
})();

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
    defAliases: {},
    symbols: [],
    breakpoints: new Set(),
    syntaxErrors: new Map(),
    rxBuffer: [],
    uartLog: "",
    uartTxBusyCycles: 0,
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

/* ================= 3. ТЕМА, ЗУМ, РЕСАЙЗЕРЫ И ИНТЕРФЕЙС ================= */

function toggleTheme() {
    const isLight = document.body.classList.toggle('theme-light');
    try { localStorage.setItem('avr_theme', isLight ? 'light' : 'dark'); } catch (e) {}
    const txt = document.getElementById('btnThemeText');
    if (txt) txt.textContent = isLight ? 'Темная' : 'Светлая';
    drawLogicAnalyzer();
}

function applyAppZoom() {
    document.documentElement.style.setProperty('--app-zoom', appZoom);
    const zVal = document.getElementById('zoomVal');
    if (zVal) zVal.textContent = Math.round(appZoom * 100) + '%';
    try { localStorage.setItem('avr_app_zoom', appZoom); } catch(e) {}
    applyPanelWeights();
    requestAnimationFrame(() => setTimeout(resizeAnalyzerCanvas, 50));
}

function changeAppZoom(delta) {
    appZoom = Math.min(1.5, Math.max(0.6, Math.round((appZoom + delta) * 10) / 10));
    applyAppZoom();
}

function resetAppZoom() {
    appZoom = 1.0;
    applyAppZoom();
}

function applyPanelWeights() {
    const isMobile = window.innerWidth <= 900;
    PANEL_LIST.forEach(name => {
        const p = document.getElementById('panel_' + name);
        if (!p) return;
        if (isMobile) {
            p.style.flex = '';
        } else {
            const w = panelWeights[name] || 1;
            p.style.flex = w + ' 1 0';
        }
    });
}

function savePanelWeights() {
    try { localStorage.setItem('avr_panel_weights', JSON.stringify(panelWeights)); } catch(e) {}
}

function syncPanelResizers() {
    const track = document.getElementById('panelsTrack');
    if (!track) return;

    track.querySelectorAll('.panel-resizer').forEach(r => r.remove());

    if (window.innerWidth <= 900) {
        applyPanelWeights();
        return;
    }

    const visiblePanels = Array.from(track.querySelectorAll('.slide-panel'))
        .filter(p => !p.classList.contains('panel-hidden'));

    for (let i = 0; i < visiblePanels.length - 1; i++) {
        const leftPanel = visiblePanels[i];
        const rightPanel = visiblePanels[i + 1];
        const resizer = document.createElement('div');
        resizer.className = 'panel-resizer';
        resizer.title = 'Потяните для изменения ширины (двойной клик — сбросить)';

        resizer.addEventListener('dblclick', () => {
            PANEL_LIST.forEach(name => { panelWeights[name] = 1; });
            applyPanelWeights();
            savePanelWeights();
            resizeAnalyzerCanvas();
        });

        resizer.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            resizer.classList.add('active');
            resizer.setPointerCapture(e.pointerId);

            const leftId = leftPanel.getAttribute('data-panel-id');
            const rightId = rightPanel.getAttribute('data-panel-id');
            const startX = e.clientX;
            const leftStartW = leftPanel.getBoundingClientRect().width;
            const rightStartW = rightPanel.getBoundingClientRect().width;
            const totalW = leftStartW + rightStartW;
            const minW = Math.min(230 * appZoom, totalW * 0.4);

            const wLeft0 = panelWeights[leftId] || 1;
            const wRight0 = panelWeights[rightId] || 1;
            const totalWeight = wLeft0 + wRight0;

            let rafId = null;

            const onMove = (ev) => {
                const dx = ev.clientX - startX;
                const newLeftW = Math.min(totalW - minW, Math.max(minW, leftStartW + dx));
                const ratio = newLeftW / totalW;

                panelWeights[leftId] = Math.max(0.2, totalWeight * ratio);
                panelWeights[rightId] = Math.max(0.2, totalWeight * (1 - ratio));

                leftPanel.style.flex = panelWeights[leftId] + ' 1 0';
                rightPanel.style.flex = panelWeights[rightId] + ' 1 0';

                if (!rafId) {
                    rafId = requestAnimationFrame(() => {
                        rafId = null;
                        resizeAnalyzerCanvas();
                    });
                }
            };

            const onUp = () => {
                resizer.classList.remove('active');
                resizer.removeEventListener('pointermove', onMove);
                resizer.removeEventListener('pointerup', onUp);
                resizer.removeEventListener('pointercancel', onUp);
                savePanelWeights();
                resizeAnalyzerCanvas();
            };

            resizer.addEventListener('pointermove', onMove);
            resizer.addEventListener('pointerup', onUp);
            resizer.addEventListener('pointercancel', onUp);
        });

        leftPanel.insertAdjacentElement('afterend', resizer);
    }

    applyPanelWeights();
}

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
    syncPanelResizers();
    if (activePanels[panelName]) {
        updateUI();
        if (panelName === 'analyzer') setTimeout(resizeAnalyzerCanvas, 40);
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

function toggleCardFullscreen(cardId) {
    const card = document.getElementById(cardId);
    const panel = document.getElementById('panel_tools');
    const btn = document.getElementById('btnMax_' + cardId);
    if (!card || !panel) return;

    if (card.classList.contains('collapsed')) {
        toggleCardCollapse(cardId);
    }

    const isFullscreen = card.classList.toggle('card-fullscreen-mode');
    panel.classList.toggle('has-maximized-card', isFullscreen);

    if (btn) {
        btn.textContent = isFullscreen ? '🗗' : '↕';
        btn.title = isFullscreen ? 'Вернуть прежний размер' : 'Развернуть на всю колонку';
    }
}

/* ================= 4. DRAG-AND-DROP КОЛОНОК ================= */

function initDragAndDrop() {
    const track = document.getElementById('panelsTrack');
    if (!track) return;

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
            syncPanelResizers();
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
            syncPanelResizers();
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
    try { localStorage.setItem('avr_panel_order', JSON.stringify(order)); } catch(e) {}
}

/* ================= 5. ДЕБАГГЕР И АНАЛИЗАТОР ОШИБОК ================= */

const KNOWN_OPS = new Set([
    'ldi','mov','movw','add','adc','sub','subi','sbc','sbci','inc','dec','lsl','lsr','asr','rol','ror','swap',
    'neg','com','and','andi','or','ori','eor','tst','clr','ser','cpi','cp','cpc','cpse','sbrs','sbrc','sbr','cbr',
    'sec','clc','sez','clz','sen','cln','sev','clv','ses','cls','seh','clh','set','clt',
    'bst','bld','sbi','cbi','sbis','sbic','lpm','mul','muls',
    'adiw','sbiw','st','ld','sts','lds','push','pop','jmp','rjmp','breq','brne','brcs','brcc',
    'brlo','brsh','brmi','brpl','brge','brlt','brhs','brhc','brts','brtc','brvs','brvc',
    'call','ret','reti','sei','cli','in','out','break','nop','mulsu','rcall','brls','brhi','sleep','wdr'
]);

function validateSourceCode(text, lang) {
    cpu.syntaxErrors.clear();
    const lines = text.split('\n');

    const defRegs = {};
    if (lang === 'asm') {
        for (let i = 0; i < lines.length; i++) {
            const clean = lines[i].replace(/;.*$/, '').trim();
            const dm = clean.match(/^\.def\s+([a-zA-Z0-9_]+)\s*=\s*r([0-9]+)/i);
            if (dm) defRegs[dm[1].toLowerCase()] = parseInt(dm[2], 10);
        }
    }

    const braceStack = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let inString = false;
        let inChar = false;

        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            const next = line[j + 1];

            if (!inString && !inChar) {
                if (lang === 'asm' && char === ';') break;
                if (char === '/' && next === '/') break;
            }
            if (char === '"' && !inChar && line[j - 1] !== '\\') { inString = !inString; continue; }
            if (char === "'" && !inString && line[j - 1] !== '\\') { inChar = !inChar; continue; }
            if (inString || inChar) continue;

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
            if (!line || line.startsWith('.')) continue;

            const subCmds = line.split(':').map(c => c.trim()).filter(Boolean);
            for (let sub of subCmds) {
                if (sub.endsWith(':') || !sub) continue;
                const tokens = sub.split(/\s+/);
                const op = tokens[0].toLowerCase();
                if (KNOWN_OPS.has(op)) {
                    const argsStr = sub.substring(tokens[0].length).trim();
                    const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];
                    if (['ldi', 'subi', 'sbci', 'andi', 'ori', 'cpi', 'sbr', 'cbr'].includes(op) && args.length >= 1) {
                        const a0 = args[0].toLowerCase();
                        const regNum = (defRegs[a0] !== undefined) ? defRegs[a0] : parseReg(args[0]);
                        if (regNum < 16) cpu.syntaxErrors.set(i + 1, op.toUpperCase() + ' не работает с R' + regNum + '. Разрешены R16..R31');
                    }
                }
            }
        }
    }

    const statusElem = document.getElementById('compilerStatus');
    if (cpu.syntaxErrors.size > 0) {
        const firstErrLine = cpu.syntaxErrors.keys().next().value;
        const errMsg = cpu.syntaxErrors.get(firstErrLine);
        cpu.error = 'Строка ' + firstErrLine + ': ' + errMsg;
        if (statusElem) {
            statusElem.textContent = '❌ ' + cpu.error;
            statusElem.parentElement.classList.add('has-error-text');
        }
    } else {
        if (statusElem) {
            statusElem.parentElement.classList.remove('has-error-text');
            if (!cpu.error) statusElem.textContent = 'Готов';
        }
    }
}

/* ================= 6. GHOST TEXT АВТОДОПОЛНЕНИЕ ================= */

const COMMON_REGISTERS = [
    'PORTB', 'PORTC', 'PORTD', 'DDRB', 'DDRC', 'DDRD', 'PINB', 'PINC', 'PIND',
    'ACSR', 'ADMUX', 'ADCSRA', 'ADCSRB', 'ADCH', 'ADCL', 'DIDR0', 'DIDR1',
    'UDR0', 'UCSR0A', 'UCSR0B', 'UCSR0C', 'UBRR0L', 'UBRR0H',
    'EICRA', 'EIMSK', 'EIFR', 'PCICR', 'PCIFR', 'PCMSK0', 'PCMSK1', 'PCMSK2',
    'SREG', 'SPL', 'SPH'
];

const DICT_C = [
    '#define F_CPU 16000000UL', '#include <avr/io.h>', '#include <util/delay.h>', '#include <avr/interrupt.h>',
    'int main(void)', 'void', 'unsigned char', 'uint8_t', 'uint16_t', 'uint32_t', 'int', 'char', 'volatile',
    'while (1)', 'while', 'if', 'else', 'for', 'return', 'break', '_delay_ms(50);', 'sei();', 'cli();',
    'ISR(INT0_vect)', 'ISR(INT1_vect)', 'ISR(USART_RX_vect)', 'ISR(USART_TX_vect)',
    'TXEN0', 'RXEN0', 'RXCIE0', 'TXCIE0', 'UDRIE0', 'UCSZ00', 'UCSZ01', 'PB5', 'PD2',
    ...COMMON_REGISTERS
];

const DICT_ASM = [
    '.include "m328pdef.inc"', '.org 0x0000', '.org 0x0002', '.org 0x0024', '.cseg', '.db',
    'ldi', 'mov', 'add', 'adc', 'sub', 'subi', 'rjmp', 'jmp', 'call', 'ret', 'reti',
    'in', 'out', 'sts', 'lds', 'lpm', 'bst', 'brtc', 'brts', 'cpi', 'breq', 'brne',
    'sbrc', 'sbrs', 'sbic', 'sbis', 'sbi', 'cbi', 'muls', 'mulsu', 'rcall', 'sbr', 'cbr',
    'brge', 'brlt', 'brvs', 'brvc', 'brhs', 'brhc', 'brls', 'brhi', 'adiw', 'sbiw', 'sleep', 'wdr',
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

/* ================= 7. ТЕМА 7: КОМПАРАТОР И АЦП ================= */

function updatePotentiometer(rawVal) {
    cpu.potVal = parseInt(rawVal, 10);
    const volts = (cpu.potVal / 1023 * 5.0).toFixed(2);
    const badge = document.getElementById('potVoltageBadge');
    if (badge) badge.textContent = volts + ' V (ADC: ' + cpu.potVal + ')';

    syncAnalogHardware();
    recordAnalyzerSample(true);
    updateUI();
}

function syncAnalogHardware() {
    const admux = readRAM(IO.ADMUX);
    const isLeftAdjust = (admux & (1 << 5)) !== 0;

    if (isLeftAdjust) {
        cpu.ram[IO.ADCH] = (cpu.potVal >> 2) & 0xFF;
        cpu.ram[IO.ADCL] = (cpu.potVal << 6) & 0xC0;
    } else {
        cpu.ram[IO.ADCL] = cpu.potVal & 0xFF;
        cpu.ram[IO.ADCH] = (cpu.potVal >> 8) & 0x03;
    }

    let acsr = readRAM(IO.ACSR);
    const useBandgap = (acsr & (1 << 6)) !== 0;
    const vAin0 = useBandgap ? 1.1 : 2.5;
    const vAin1 = cpu.potVal / 1023 * 5.0;

    const prevAco = (acsr >> 5) & 1;
    let curAco = (vAin0 > vAin1) ? 1 : 0;

    if (curAco) acsr |= (1 << 5);
    else acsr &= ~(1 << 5);

    const acis = acsr & 0x03;
    let triggerComp = false;
    if (acis === 0 && curAco !== prevAco) triggerComp = true;
    else if (acis === 2 && prevAco === 1 && curAco === 0) triggerComp = true;
    else if (acis === 3 && prevAco === 0 && curAco === 1) triggerComp = true;

    if (triggerComp) acsr |= (1 << 4);
    cpu.ram[IO.ACSR] = acsr;
}

/* ================= 8. МОДАЛЬНЫЙ КОНФИГУРАТОР I/O ================= */

function openIoModal() {
    document.getElementById('ioModal').style.display = 'flex';
    updateModalPinHint();
}

function closeIoModal() {
    document.getElementById('ioModal').style.display = 'none';
}

function updateModalPinHint() {
    const pin = document.getElementById('modalIoPin').value;
    const hintBox = document.getElementById('modalPinHintText');
    const hints = {
        PD0: 'RXD (Вход UART), Pin Change PCINT16',
        PD1: 'TXD (Выход UART), Pin Change PCINT17',
        PD2: 'Внешнее прерывание INT0, Pin Change PCINT18',
        PD3: 'Внешнее прерывание INT1, Pin Change PCINT19',
        PD4: 'Тактовый вход XCK, Pin Change PCINT20',
        PD5: 'Вход таймера T1, Pin Change PCINT21',
        PD6: 'Вход компаратора AIN0 (+), Pin Change PCINT22',
        PD7: 'Вход компаратора AIN1 (-), Pin Change PCINT23',
        PB0: 'Pin Change прерывание PCINT0 (Группа 0)',
        PB1: 'Pin Change прерывание PCINT1',
        PB2: 'Pin Change прерывание PCINT2',
        PB3: 'Вход SPI MOSI, PCINT3',
        PB4: 'Вход SPI MISO, PCINT4',
        PB5: 'Встроенный светодиод L, SCK, PCINT5',
        PC0: 'Аналоговый вход A0 / ADC0, PCINT8',
        PC1: 'Аналоговый вход A1 / ADC1, PCINT9',
        PC2: 'Аналоговый вход A2 / ADC2, PCINT10',
        PC3: 'Аналоговый вход A3 / ADC3, PCINT11',
        PC4: 'Шина I2C SDA, ADC4, PCINT12',
        PC5: 'Шина I2C SCL, ADC5, PCINT13'
    };
    if (hintBox) hintBox.textContent = 'Назначение: ' + (hints[pin] || 'Дискретный ввод-вывод');
}

function addCustomIoComponent() {
    const type = document.getElementById('modalIoType').value;
    const pinFull = document.getElementById('modalIoPin').value;
    const nameInp = document.getElementById('modalIoName').value.trim();

    const port = pinFull.charAt(1);
    const pin = parseInt(pinFull.charAt(2), 10);
    const id = 'custom_' + Date.now();
    const label = nameInp || pinFull;

    const comp = { id, type, port, pin, pinFull, label, pressed: false };
    customIoComponents.push(comp);

    if (type.startsWith('btn')) vButtons.push(comp);

    renderCustomComponents();
    closeIoModal();
    syncHardwareState();
    updateUI();
}

function removeCustomIoComponent(id) {
    customIoComponents = customIoComponents.filter(c => c.id !== id);
    vButtons = vButtons.filter(b => b.id !== id);
    renderCustomComponents();
    syncHardwareState();
    updateUI();
}

function clearAllCustomIo() {
    customIoComponents = [];
    vButtons = [...defaultButtons];
    renderCustomComponents();
    syncHardwareState();
    updateUI();
}

function resetIoToDefault() {
    clearAllCustomIo();
    closeIoModal();
}

function renderCustomComponents() {
    const card = document.getElementById('customIoCard');
    const grid = document.getElementById('customComponentsGrid');
    if (!card || !grid) return;

    if (customIoComponents.length === 0) {
        card.style.display = 'none';
        grid.innerHTML = '';
        return;
    }

    card.style.display = 'block';
    let html = '';
    for (let c of customIoComponents) {
        if (c.type.startsWith('btn')) {
            html += '<div class="custom-item-box">';
            html += '<button type="button" class="btn-remove-custom" onclick="removeCustomIoComponent(\'' + c.id + '\')" title="Удалить">✕</button>';
            html += '<button type="button" class="v-btn ' + (c.pressed ? 'latched' : '') + '" id="vbtn_' + c.id + '" onclick="toggleVButton(\'' + c.id + '\')" style="width:100%;">';
            html += c.label + ' <span>' + c.pinFull + '</span></button></div>';
        } else {
            html += '<div class="custom-item-box">';
            html += '<button type="button" class="btn-remove-custom" onclick="removeCustomIoComponent(\'' + c.id + '\')" title="Удалить">✕</button>';
            html += '<div class="led-light" id="led_' + c.id + '"></div>';
            html += '<span class="custom-item-label">' + c.label + ' (' + c.pinFull + ')</span></div>';
        }
    }
    grid.innerHTML = html;
}

function renderExtraPins() {
    const grid = document.getElementById('extraPinsGrid');
    if (!grid) return;
    const portc = readRAM(IO.PORTC);
    const ddrc = readRAM(IO.DDRC);

    let html = '';
    for (let pin = 0; pin < 6; pin++) {
        const isHigh = ((ddrc & (1 << pin)) !== 0) && ((portc & (1 << pin)) !== 0);
        html += '<div class="led-col">';
        html += '<div class="led-light ' + (isHigh ? 'active-led-green' : '') + '"></div>';
        html += '<span class="led-bit-name">PC' + pin + '</span></div>';
    }
    grid.innerHTML = html;
}

/* ================= 9. ОПТИМИЗИРОВАННЫЙ ЛОГИЧЕСКИЙ АНАЛИЗАТОР ================= */

const ALL_CHANNELS = [
    { id: 'PD0', port: 'D', pin: 0, label: 'PD0 (RX)', color: '#38bdf8' },
    { id: 'PD1', port: 'D', pin: 1, label: 'PD1 (TX)', color: '#06b6d4' },
    { id: 'PD2', port: 'D', pin: 2, label: 'PD2 (INT0)', color: '#3b82f6' },
    { id: 'PD3', port: 'D', pin: 3, label: 'PD3 (INT1)', color: '#6366f1' },
    { id: 'PD4', port: 'D', pin: 4, label: 'PD4 (K3)',  color: '#8b5cf6' },
    { id: 'PD5', port: 'D', pin: 5, label: 'PD5',       color: '#a855f7' },
    { id: 'PD6', port: 'D', pin: 6, label: 'PD6 (AIN0)', color: '#d946ef' },
    { id: 'PD7', port: 'D', pin: 7, label: 'PD7 (AIN1)', color: '#ec4899' },
    { id: 'PB0', port: 'B', pin: 0, label: 'PB0 (K4)',  color: '#f43f5e' },
    { id: 'PB1', port: 'B', pin: 1, label: 'PB1 (K5)',  color: '#fb7185' },
    { id: 'PB2', port: 'B', pin: 2, label: 'PB2 (K6)',  color: '#f97316' },
    { id: 'PB3', port: 'B', pin: 3, label: 'PB3 (K7)',  color: '#fb923c' },
    { id: 'PB4', port: 'B', pin: 4, label: 'PB4 (K8)',  color: '#facc15' },
    { id: 'PB5', port: 'B', pin: 5, label: 'PB5 (LED L)', color: '#eab308' },
    { id: 'PC0', port: 'C', pin: 0, label: 'PC0 (ADC0)', color: '#84cc16' },
    { id: 'PC1', port: 'C', pin: 1, label: 'PC1 (ADC1)', color: '#22c55e' },
    { id: 'PC2', port: 'C', pin: 2, label: 'PC2 (ADC2)', color: '#10b981' },
    { id: 'PC3', port: 'C', pin: 3, label: 'PC3 (ADC3)', color: '#14b8a6' },
    { id: 'PC4', port: 'C', pin: 4, label: 'PC4 (SDA)',  color: '#2dd4bf' },
    { id: 'PC5', port: 'C', pin: 5, label: 'PC5 (SCL)',  color: '#38bdf8' }
];

let selectedChannelIds = new Set(['PD2', 'PD1', 'PD0', 'PB5', 'PB0']);

const analyzer = {
    zoom: 1.0,
    maxSamples: 1500,
    samples: []
};

let analyzerScheduled = false;
let lastPinSampleHash = -1;

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
    } else {
        selectedChannelIds.add(chId);
    }
    renderChannelSelector();
    resizeAnalyzerCanvas();
}

function selectChannelPreset(type) {
    if (type === 'd') selectedChannelIds = new Set(['PD0','PD1','PD2','PD3','PD4','PD5','PD6','PD7']);
    else if (type === 'b') selectedChannelIds = new Set(['PB0','PB1','PB2','PB3','PB4','PB5']);
    else if (type === 'c') selectedChannelIds = new Set(['PC0','PC1','PC2','PC3','PC4','PC5']);
    else if (type === 'all') selectedChannelIds = new Set(ALL_CHANNELS.map(c => c.id));
    renderChannelSelector();
    resizeAnalyzerCanvas();
}

function clearAnalyzer() {
    analyzer.samples = [];
    lastPinSampleHash = -1;
    recordAnalyzerSample(true);
    scheduleAnalyzerDraw();
}

function zoomAnalyzer(delta) {
    if (delta > 0 && analyzer.zoom < 8) analyzer.zoom *= 1.5;
    if (delta < 0 && analyzer.zoom > 0.4) analyzer.zoom /= 1.5;
    document.getElementById('analyzerZoomVal').textContent = analyzer.zoom.toFixed(1) + 'x';
    scheduleAnalyzerDraw();
}

function recordAnalyzerSample(force = false) {
    if (!activePanels.analyzer) return;

    const pind = readRAM(IO.PIND), ddrd = readRAM(IO.DDRD), portd = readRAM(IO.PORTD);
    const pinb = readRAM(IO.PINB), ddrb = readRAM(IO.DDRB), portb = readRAM(IO.PORTB);
    const pinc = readRAM(IO.PINC), ddrc = readRAM(IO.DDRC), portc = readRAM(IO.PORTC);

    const currentHash = (portd << 16) ^ (portb << 8) ^ portc ^ (pind << 24) ^ (pinb << 4) ^ pinc;

    if (!force && cpu.running && currentHash === lastPinSampleHash && (cpu.cycles % 16 !== 0)) {
        return;
    }
    lastPinSampleHash = currentHash;

    function getPinVal(portLetter, pin) {
        if (portLetter === 'D') return (ddrd & (1 << pin)) ? ((portd >> pin) & 1) : ((pind >> pin) & 1);
        if (portLetter === 'B') return (ddrb & (1 << pin)) ? ((portb >> pin) & 1) : ((pinb >> pin) & 1);
        if (portLetter === 'C') return (ddrc & (1 << pin)) ? ((portc >> pin) & 1) : ((pinc >> pin) & 1);
        return 0;
    }

    const sample = { cycle: cpu.cycles, vals: {} };
    for (let i = 0; i < ALL_CHANNELS.length; i++) {
        const ch = ALL_CHANNELS[i];
        if (selectedChannelIds.has(ch.id)) {
            sample.vals[ch.id] = getPinVal(ch.port, ch.pin);
        }
    }

    analyzer.samples.push(sample);
    if (analyzer.samples.length > analyzer.maxSamples) {
        analyzer.samples.shift();
    }
    scheduleAnalyzerDraw();
}

function scheduleAnalyzerDraw() {
    if (analyzerScheduled || !activePanels.analyzer) return;
    analyzerScheduled = true;
    requestAnimationFrame(() => {
        analyzerScheduled = false;
        drawLogicAnalyzer();
    });
}

function resizeAnalyzerCanvas() {
    const canvas = document.getElementById('logicCanvas');
    const wrapper = document.getElementById('canvasWrapper');
    if (!canvas || !wrapper) return;

    const activeChannels = ALL_CHANNELS.filter(c => selectedChannelIds.has(c.id));
    const trackHeight = 32;
    const requiredH = Math.max(wrapper.clientHeight - 4, activeChannels.length * trackHeight + 20);
    const requiredW = Math.max(wrapper.clientWidth - 4, 420);

    canvas.width = requiredW;
    canvas.height = requiredH;
    canvas.style.width = requiredW + 'px';
    canvas.style.height = requiredH + 'px';

    drawLogicAnalyzer();
}

function drawLogicAnalyzer() {
    if (!activePanels.analyzer) return;
    const canvas = document.getElementById('logicCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    const isLight = document.body.classList.contains('theme-light');
    ctx.fillStyle = isLight ? '#fffef8' : '#07090e';
    ctx.fillRect(0, 0, w, h);

    const activeList = ALL_CHANNELS.filter(c => selectedChannelIds.has(c.id));
    if (activeList.length === 0) return;

    const trackHeight = 32;
    const stepX = 5 * analyzer.zoom;
    const totalVisible = Math.floor((w - 95) / stepX);
    const startIdx = Math.max(0, analyzer.samples.length - totalVisible);

    activeList.forEach((ch, idx) => {
        const baseY = 20 + idx * trackHeight;
        const highY = baseY;
        const lowY  = baseY + trackHeight - 12;

        ctx.strokeStyle = isLight ? '#e2dac0' : '#18202e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(90, lowY);
        ctx.lineTo(w, lowY);
        ctx.stroke();

        ctx.fillStyle = ch.color;
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.fillText(ch.label, 8, lowY - 3);

        ctx.strokeStyle = ch.color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        if (analyzer.samples.length === 0) {
            ctx.moveTo(95, lowY);
            ctx.lineTo(w, lowY);
            ctx.stroke();
            return;
        }

        let prevVal = analyzer.samples[startIdx]?.vals[ch.id] || 0;
        let prevX = 95;
        let prevY = prevVal ? highY : lowY;
        ctx.moveTo(prevX, prevY);

        for (let i = startIdx + 1; i < analyzer.samples.length; i++) {
            const curVal = analyzer.samples[i].vals[ch.id];
            const curX = 95 + (i - startIdx) * stepX;
            const curY = curVal ? highY : lowY;

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

/* ================= 10. КОМПИЛЯТОР MICRO-C ================= */
const AVR_CONSTS = {
    ISC00: 0, ISC01: 1, ISC10: 2, ISC11: 3,
    INT0: 0, INT1: 1, PCIE0: 0, PCIE1: 1, PCIE2: 2,
    TXEN0: 3, RXEN0: 4, UDRIE0: 5, TXCIE0: 6, RXCIE0: 7,
    UCSZ00: 1, UCSZ01: 2, UCSZ02: 2, U2X0: 1, DOR0: 3, FE0: 4, UDRE0: 5, TXC0: 6, RXC0: 7,
    PD0: 0, PD1: 1, PD2: 2, PD3: 3, PD4: 4, PD5: 5, PD6: 6, PD7: 7,
    PORTD0: 0, PORTD1: 1, PORTD2: 2, PORTD3: 3, PORTD4: 4, PORTD5: 5, PORTD6: 6, PORTD7: 7,
    DDD0: 0, DDD1: 1, DDD2: 2, DDD3: 3, DDD4: 4, DDD5: 5, DDD6: 6, DDD7: 7,
    PIND0: 0, PIND1: 1, PIND2: 2, PIND3: 3, PIND4: 4, PIND5: 5, PIND6: 6, PIND7: 7,
    PB0: 0, PB1: 1, PB2: 2, PB3: 3, PB4: 4, PB5: 5, PB6: 6, PB7: 7,
    PORTB0: 0, PORTB1: 1, PORTB2: 2, PORTB3: 3, PORTB4: 4, PORTB5: 5, PORTB6: 6, PORTB7: 7,
    DDB0: 0, DDB1: 1, DDB2: 2, DDB3: 3, DDB4: 4, DDB5: 5, DDB6: 6, DDB7: 7,
    PINB0: 0, PINB1: 1, PINB2: 2, PINB3: 3, PINB4: 4, PINB5: 5, PINB6: 6, PINB7: 7,
    PC0: 0, PC1: 1, PC2: 2, PC3: 3, PC4: 4, PC5: 5, PC6: 6, PC7: 7,
    PORTC0: 0, PORTC1: 1, PORTC2: 2, PORTC3: 3, PORTC4: 4, PORTC5: 5, PORTC6: 6, PORTC7: 7,
    DDC0: 0, DDC1: 1, DDC2: 2, DDC3: 3, DDC4: 4, DDC5: 5, DDC6: 6, DDC7: 7,
    PINC0: 0, PINC1: 1, PINC2: 2, PINC3: 3, PINC4: 4, PINC5: 5, PINC6: 6, PINC7: 7,
    ACD: 7, ACBG: 6, ACO: 5, ACI: 4, ACIE: 3, ACIC: 2, ACIS1: 1, ACIS0: 0,
    ADEN: 7, ADSC: 6, ADATE: 5, ADIF: 4, ADIE: 3, ADPS2: 2, ADPS1: 1, ADPS0: 0,
    REFS1: 7, REFS0: 6, ADLAR: 5
};
const AVR_CONSTS_KEYS = Object.keys(AVR_CONSTS).sort((a,b) => b.length - a.length);
const AVR_CONSTS_REGEX = new RegExp('\\b(' + AVR_CONSTS_KEYS.join('|') + ')\\b', 'g');
const RW_PORTS = ['PORTB','PORTC','PORTD','DDRB','DDRC','DDRD','UCSR0A','UCSR0B','UCSR0C','EICRA','EIMSK','PCICR','PCMSK0','PCMSK1','PCMSK2','ACSR','ADCSRA','ADCSRB','ADMUX'];
const READ_REGS = ['PINB','PINC','PIND','UDR0','UCSR0A','ADCL','ADCH','ACSR','EIFR','PCIFR'];
const RW_PORTS_REGEX = new RegExp('\\b(' + RW_PORTS.join('|') + ')\\s*\\|\\=\\s*([^;]+);');
const AND_NOT_REGEX = new RegExp('\\b(' + RW_PORTS.join('|') + ')\\s*&\\=\\s*~([^;]+);');
const XOR_REGEX = new RegExp('\\b(' + RW_PORTS.join('|') + ')\\s*\\^\\=\\s*([^;]+);');

function isExtReg(name) { return IO[name] !== undefined && IO[name] >= 0x60; }

function evaluateCExpression(expr, defines) {
    if (!expr) return null;
    expr = expr.trim();
    if (defines) {
        for (const [k, v] of Object.entries(defines)) {
            expr = expr.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
        }
    }
    expr = expr.replace(AVR_CONSTS_REGEX, m => AVR_CONSTS[m]);
    expr = expr.replace(/'(.)'/g, (m, c) => c.charCodeAt(0));
    expr = expr.replace(/UL|U|L/gi, '');
    try { return Function("'use strict'; return (" + expr + ");")(); }
    catch (e) { return null; }
}

function scaleThreshold(val) {
    if (val === null || val === undefined) return 0;
    if (val >= 10000) return Math.max(5, Math.round(val / 20000));
    return (val < 0) ? (val & 0xFF) : Math.min(255, val);
}

function compileCToAsm(cCode) {
    cpu.symbols = [];
    const asmList = [];
    let regCounter = 18;
    function allocVarReg() {
        if (regCounter <= 25) return 'r' + (regCounter++);
        cpu.error = 'Превышен лимит локальных переменных C (макс. 8 в R18..R25)';
        return 'r25';
    }
    const varMap = {};
    let labelCounter = 1;
    const controlStack = [];
    const defines = {};
    const globalInits = [];
    let insideMain = false;
    let insideIsr = false;
    let sramPtr = 0x0100;
    const origLines = cCode.split('\n');
    const srcLines = [];
    for (let i = 0; i < origLines.length; i++) {
        let text = origLines[i];
        const start = i + 1;
        while (((text.match(/"/g) || []).length % 2) === 1 && i + 1 < origLines.length) {
            text += '\\n' + origLines[++i];
        }
        srcLines.push({ text, lineNum: start });
    }
    let mainLineNum = 1;
    for (const sl of srcLines) {
        if (sl.text.includes('main(')) mainLineNum = sl.lineNum;
        const cleanDef = sl.text.replace(/\/\/.*$/, '');
        const d = cleanDef.match(/^#define\s+([a-zA-Z0-9_]+)\s+(.+)$/);
        if (d) defines[d[1]] = d[2].replace(/UL|U|L/gi, '').trim();
    }
    function push(asm, lineNum) { asmList.push({ asm, lineNum }); }
    function applyDefines(str) {
        for (const [k, v] of Object.entries(defines)) {
            str = str.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
        }
        return str;
    }
    function extractPinAndBit(expr) {
        const portMatch = expr.match(/(PIN[BCD])/i);
        if (!portMatch) return null;
        const port = portMatch[1].toUpperCase();
        let bit = 0;
        const shiftMatch = expr.match(/1\s*<<\s*([a-zA-Z0-9_]+)/i);
        if (shiftMatch) {
            bit = evaluateCExpression(applyDefines(shiftMatch[1]), defines);
            if (bit === null || isNaN(bit)) bit = 0;
        } else {
            const hexMatch = expr.match(/&\s*(0x[0-9a-fA-F]+|\d+)/i);
            if (hexMatch) {
                const mask = evaluateCExpression(hexMatch[1], defines) || 1;
                bit = Math.max(0, Math.round(Math.log2(mask)));
            }
        }
        return { port, bit };
    }
    function emitArrRead(arr, idxToken, lineNum) {
        const info = varMap[arr];
        if (!info) return false;
        if (info.type === 'sram_array') {
            if (/^\d+$/.test(idxToken)) {
                push('lds r16, ' + (info.addr + parseInt(idxToken, 10)), lineNum);
            } else if (varMap[idxToken]) {
                push('ldi xl, low(' + info.addr + ')', lineNum);
                push('ldi xh, high(' + info.addr + ')', lineNum);
                push('add xl, ' + varMap[idxToken].reg, lineNum);
                push('clr r1', lineNum);
                push('adc xh, r1', lineNum);
                push('ld r16, X', lineNum);
            } else return false;
            return true;
        }
        if (info.type === 'string_array') {
            if (/^\d+$/.test(idxToken)) {
                push('ldi zl, low((' + info.label + ' << 1) + ' + idxToken + ')', lineNum);
                push('ldi zh, high((' + info.label + ' << 1) + ' + idxToken + ')', lineNum);
            } else if (varMap[idxToken]) {
                push('ldi zl, low(' + info.label + ' << 1)', lineNum);
                push('ldi zh, high(' + info.label + ' << 1)', lineNum);
                push('add zl, ' + varMap[idxToken].reg, lineNum);
                push('clr r16', lineNum);
                push('adc zh, r16', lineNum);
            } else return false;
            push('lpm r16, Z', lineNum);
            return true;
        }
        return false;
    }
    function emitStore(dst, lineNum) {
        push((isExtReg(dst) ? 'sts ' : 'out ') + dst + ', r16', lineNum);
    }
    function emitCondBranch(op, lblFalse, lineNum) {
        if (op === '==') push('brne ' + lblFalse, lineNum);
        else if (op === '!=') push('breq ' + lblFalse, lineNum);
        else if (op === '>=') push('brlo ' + lblFalse, lineNum);
        else if (op === '<') push('brsh ' + lblFalse, lineNum);
        else if (op === '>') { push('breq ' + lblFalse, lineNum); push('brlo ' + lblFalse, lineNum); }
        else if (op === '<=') {
            const skip = '__lbl_skip_' + (labelCounter++);
            push('breq ' + skip, lineNum);
            push('brsh ' + lblFalse, lineNum);
            push(skip + ':', lineNum);
        }
    }
    function isrPrologue(lineNum) {
        push('push r16', lineNum);
        push('push r17', lineNum);
        push('in r16, SREG', lineNum);
        push('push r16', lineNum);
    }
    function isrEpilogue(lineNum) {
        push('pop r16', lineNum);
        push('out SREG, r16', lineNum);
        push('pop r17', lineNum);
        push('pop r16', lineNum);
        push('reti', lineNum);
    }
    function splitInline(piece) {
        if (/^else\b/.test(piece) && !/^else\s+if\b/.test(piece)) {
            const rest = piece.substring(4).trim();
            if (rest && !rest.startsWith('{')) return ['else', '{', rest, '}'];
            return [piece];
        }
        if (!/^(if|while)\s*\(/.test(piece)) return [piece];
        let depth = 0, end = -1;
        for (let i = piece.indexOf('('); i < piece.length; i++) {
            if (piece[i] === '(') depth++;
            else if (piece[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end === -1) return [piece];
        const rest = piece.substring(end + 1).trim();
        if (!rest || rest === ';' || rest.startsWith('{')) return [piece];
        return [piece.substring(0, end + 1), '{', rest, '}'];
    }
    push('.include "m328pdef.inc"', mainLineNum);
    push('rjmp __main', mainLineNum);
    const rawLines = [];
    for (const sl of srcLines) {
        const lineNum = sl.lineNum;
        let l = sl.text;
        const cIdx = l.indexOf('//');
        if (cIdx !== -1) l = l.substring(0, cIdx);
        l = l.trim();
        if (!l || l.startsWith('#')) continue;
        l = l.replace(/\bPCICR0\b/g, 'PCICR');
        l = l.replace(/([a-zA-Z0-9_]+)\[([a-zA-Z0-9_]+)\+\+\]\s*=\s*([^;]+);/g, '$1[$2] = $3; $2++;');
        l = l.replace(/([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\[([a-zA-Z0-9_]+)\+\+\];/g, '$1 = $2[$3]; $3++;');
        l = l.replace(/\b(volatile|const)\s+/g, '');
        if (l.match(/while\s*\(\s*(!?)\s*\(\s*PIN[BCD]/i)) { rawLines.push({ text: l, lineNum }); continue; }
        const pieces = l.replace(/\{/g, '\n{\n').replace(/\}/g, '\n}\n').replace(/;/g, ';\n')
            .split('\n').map(p => p.trim()).filter(Boolean);
        for (let p of pieces) {
            for (let sp of splitInline(p)) rawLines.push({ text: sp, lineNum });
        }
    }

    function isBlockHeader(t) {
        if (t === 'else') return true;
        if (/^(if|else\s+if|while)\s*\(/.test(t) && !t.endsWith(';')) return true;
        return false;
    }
    function wrapSingleBodies(arr) {
        function parseOne(idx) {
            if (idx >= arr.length) return { nodes: [], nextIdx: idx };
            const item = arr[idx];
            if (item.text === '{') {
                const nodes = [item];
                let k = idx + 1;
                while (k < arr.length && arr[k].text !== '}') {
                    const res = parseOne(k);
                    nodes.push(...res.nodes);
                    k = res.nextIdx;
                }
                if (k < arr.length && arr[k].text === '}') {
                    nodes.push(arr[k]);
                    k++;
                }
                return { nodes, nextIdx: k };
            }
            if (isBlockHeader(item.text)) {
                const nodes = [item];
                let k = idx + 1;
                if (k < arr.length && arr[k].text === '{') {
                    const res = parseOne(k);
                    nodes.push(...res.nodes);
                    k = res.nextIdx;
                } else if (k < arr.length) {
                    const res = parseOne(k);
                    nodes.push({ text: '{', lineNum: item.lineNum }, ...res.nodes, { text: '}', lineNum: item.lineNum });
                    k = res.nextIdx;
                }
                return { nodes, nextIdx: k };
            }
            return { nodes: [item], nextIdx: idx + 1 };
        }
        const out = [];
        let p = 0;
        while (p < arr.length) {
            const res = parseOne(p);
            out.push(...res.nodes);
            p = res.nextIdx;
        }
        return out;
    }
    const normalizedLines = wrapSingleBodies(rawLines);
    rawLines.length = 0;
    rawLines.push(...normalizedLines);

    for (let i = 0; i < rawLines.length; i++) {
        let line = rawLines[i].text;
        const lineNum = rawLines[i].lineNum;
        const strArrMatch = line.match(/\bchar\s+([a-zA-Z0-9_]+)\s*\[\s*\]\s*=\s*(".*?")\s*;/);
        if (strArrMatch) {
            const strLbl = '__str_' + strArrMatch[1];
            push('.cseg', lineNum);
            push(strLbl + ': .db ' + strArrMatch[2] + ', 0', lineNum);
            varMap[strArrMatch[1]] = { type: 'string_array', label: strLbl };
            continue;
        }
        const ramDeclMatch = line.match(/\b(unsigned\s+char|uint8_t|int8_t|char)\s+([^;]+);/);
        if (ramDeclMatch && (line.includes('[') || line.includes(','))) {
            for (let vItem of ramDeclMatch[2].split(',')) {
                vItem = vItem.trim();
                const arrDef = vItem.match(/([a-zA-Z0-9_]+)\s*\[\s*(\d+)\s*\]/);
                if (arrDef) {
                    const aSize = parseInt(arrDef[2], 10);
                    varMap[arrDef[1]] = { type: 'sram_array', addr: sramPtr, size: aSize };
                    cpu.symbols.push({ name: arrDef[1], type: 'uint8_t[' + aSize + ']', size: aSize, locType: 'sram', location: '0x' + sramPtr.toString(16).toUpperCase() });
                    sramPtr += aSize;
                } else {
                    const p = vItem.split('=');
                    const vName = p[0].trim();
                    const initVal = p[1] ? p[1].trim() : '0';
                    const reg = allocVarReg();
                    varMap[vName] = { reg, type: 'uint8_t', size: 1 };
                    cpu.symbols.push({ name: vName, type: 'uint8_t', size: 1, locType: 'reg', location: reg.toUpperCase() });
                    let inst;
                    if (READ_REGS.includes(initVal)) inst = { asm: (isExtReg(initVal) ? 'lds ' : 'in ') + reg + ', ' + initVal, lineNum };
                    else {
                        const cv = evaluateCExpression(applyDefines(initVal), defines);
                        inst = { asm: 'ldi ' + reg + ', ' + ((cv !== null ? cv : 0) & 0xFF), lineNum };
                    }
                    if (!insideMain && !insideIsr) globalInits.push(inst); else asmList.push(inst);
                }
            }
            continue;
        }
        const sumMatch = line.match(/\b(uint16_t|int)\s+([a-zA-Z0-9_]+)\s*=\s*([^;]+);/);
        if (sumMatch && sumMatch[3].includes('+')) {
            const vName = sumMatch[2];
            const terms = sumMatch[3].split('+').map(t => t.trim());
            const regLow = allocVarReg();
            const regHigh = allocVarReg();
            varMap[vName] = { regLow, regHigh, type: 'uint16_t', size: 2 };
            cpu.symbols.push({ name: vName, type: 'uint16_t', size: 2, locType: 'reg', location: regLow.toUpperCase() + ':' + regHigh.toUpperCase() });
            push('clr ' + regLow, lineNum);
            push('clr ' + regHigh, lineNum);
            push('clr r1', lineNum);
            for (let term of terms) {
                const elemMatch = term.match(/([a-zA-Z0-9_]+)\[(\d+)\]/);
                if (elemMatch && varMap[elemMatch[1]]?.type === 'sram_array') {
                    push('lds r16, ' + (varMap[elemMatch[1]].addr + parseInt(elemMatch[2], 10)), lineNum);
                    push('add ' + regLow + ', r16', lineNum);
                    push('adc ' + regHigh + ', r1', lineNum);
                }
            }
            continue;
        }
        const arrWriteMatch = line.match(/\b([a-zA-Z0-9_]+)\[([a-zA-Z0-9_]+)\]\s*=\s*([^;]+);/);
        if (arrWriteMatch && varMap[arrWriteMatch[1]]?.type === 'sram_array') {
            const idxToken = arrWriteMatch[2];
            const expr = arrWriteMatch[3].trim();
            const baseAddr = varMap[arrWriteMatch[1]].addr;
            if (expr.includes('>> 8')) {
                const varSrc = expr.replace('>> 8', '').trim();
                if (varMap[varSrc]?.regHigh) push('mov r16, ' + varMap[varSrc].regHigh, lineNum);
            } else if (expr.includes('& 0xFF') || expr.includes('& 255')) {
                const varSrc = expr.replace(/&.+/, '').trim();
                if (varMap[varSrc]?.regLow) push('mov r16, ' + varMap[varSrc].regLow, lineNum);
            } else if (varMap[expr]) {
                push('mov r16, ' + varMap[expr].reg, lineNum);
            } else {
                const cVal = evaluateCExpression(applyDefines(expr), defines);
                push('ldi r16, ' + ((cVal !== null ? cVal : 0) & 0xFF), lineNum);
            }
            if (/^\d+$/.test(idxToken)) {
                push('sts ' + (baseAddr + parseInt(idxToken, 10)) + ', r16', lineNum);
            } else if (varMap[idxToken]) {
                push('ldi xl, low(' + baseAddr + ')', lineNum);
                push('ldi xh, high(' + baseAddr + ')', lineNum);
                push('add xl, ' + varMap[idxToken].reg, lineNum);
                push('clr r1', lineNum);
                push('adc xh, r1', lineNum);
                push('st X, r16', lineNum);
            }
            continue;
        }
        const isrMatch = line.match(/ISR\s*\(\s*([a-zA-Z0-9_]+)\s*\)/);
        if (isrMatch) {
            const vName = isrMatch[1];
            let lbl = '__vector_default';
            if (vName.includes('INT0')) lbl = '__vector_int0';
            else if (vName.includes('INT1')) lbl = '__vector_int1';
            else if (vName.includes('PCINT0')) lbl = '__vector_pcint0';
            else if (vName.includes('PCINT1')) lbl = '__vector_pcint1';
            else if (vName.includes('PCINT2')) lbl = '__vector_pcint2';
            else if (vName.includes('USART_RX')) lbl = '__vector_usart_rx';
            else if (vName.includes('USART_UDRE')) lbl = '__vector_usart_udre';
            else if (vName.includes('USART_TX')) lbl = '__vector_usart_tx';
            else if (vName.includes('ADC')) lbl = '__vector_adc';
            else if (vName.includes('ANALOG_COMP')) lbl = '__vector_analog_comp';
            push(lbl + ':', lineNum);
            isrPrologue(lineNum);
            insideIsr = true;
            controlStack.push({ type: 'isr' });
            continue;
        }
        if (line.includes('main(')) {
            insideMain = true;
            push('__main:', lineNum);
            for (let init of globalInits) asmList.push(init);
            continue;
        }
        if (line.includes('sei()') || line === 'sei;') { push('sei', lineNum); continue; }
        if (line.includes('cli()') || line === 'cli;') { push('cli', lineNum); continue; }
        if (line.includes('_delay_ms')) { push('nop', lineNum); continue; }
        if (line.startsWith('while') && line.includes('PIN')) {
            const isNegated = line.includes('!(') || line.includes('== 0') || line.includes('!(PIN');
            const pinInfo = extractPinAndBit(line);
            if (pinInfo) {
                const waitLbl = '__wait_pin_' + (labelCounter++);
                push(waitLbl + ':', lineNum);
                push('in r16, ' + pinInfo.port, lineNum);
                push((isNegated ? 'sbrs' : 'sbrc') + ' r16, ' + pinInfo.bit, lineNum);
                push('rjmp ' + waitLbl, lineNum);
                continue;
            }
        }
        if (line === '}' || line.startsWith('}')) {
            if (controlStack.length > 0) {
                const top = controlStack[controlStack.length - 1];
                if (top.type === 'if') {
                    if (rawLines[i+1]?.text?.startsWith('else')) {
                        push('rjmp ' + top.lblEnd, lineNum);
                        push(top.lblFalse + ':', lineNum);
                        top.type = 'else';
                    } else {
                        controlStack.pop();
                        push(top.lblFalse + ':', lineNum);
                        push(top.lblEnd + ':', lineNum);
                    }
                } else if (top.type === 'else') {
                    controlStack.pop();
                    push(top.lblEnd + ':', lineNum);
                } else if (top.type === 'while') {
                    controlStack.pop();
                    push('rjmp ' + top.startLbl, lineNum);
                } else if (top.type === 'isr') {
                    controlStack.pop();
                    insideIsr = false;
                    isrEpilogue(lineNum);
                }
            }
            continue;
        }
        if (line.startsWith('else if')) line = line.substring(5).trim();
        if (line.startsWith('else')) { line = line.substring(4).trim(); if (!line || line === '{') continue; }
        if (line === '{') continue;
        const declMatch = line.match(/\b(unsigned\s+char|uint8_t|int8_t|uint16_t|int16_t|uint32_t|int|char)\s+([^;]+);/);
        if (declMatch) {
            const typeName = declMatch[1];
            for (let vItem of declMatch[2].split(',')) {
                const parts = vItem.trim().split('=');
                const vName = parts[0].trim();
                const initVal = parts[1] ? parts[1].trim() : '0';
                const reg = allocVarReg();
                const size = (typeName.includes('32') ? 4 : (typeName.includes('16') || typeName === 'int') ? 2 : 1);
                varMap[vName] = { reg, type: typeName, size };
                cpu.symbols.push({ name: vName, type: typeName, size, locType: 'reg', location: reg.toUpperCase() });
                let inst;
                if (READ_REGS.includes(initVal)) inst = { asm: (isExtReg(initVal) ? 'lds ' : 'in ') + reg + ', ' + initVal, lineNum };
                else {
                    const cv = evaluateCExpression(applyDefines(initVal), defines);
                    inst = { asm: 'ldi ' + reg + ', ' + ((cv !== null ? cv : 0) & 0xFF), lineNum };
                }
                if (!insideMain && !insideIsr) globalInits.push(inst); else asmList.push(inst);
            }
            continue;
        }
        const arrReadMatch = line.match(/\b([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\s*\[\s*([a-zA-Z0-9_]+)\s*\]\s*;/);
        if (arrReadMatch) {
            const dst = arrReadMatch[1];
            if (emitArrRead(arrReadMatch[2], arrReadMatch[3], lineNum)) {
                if (varMap[dst]) push('mov ' + varMap[dst].reg + ', r16', lineNum);
                else emitStore(dst, lineNum);
                continue;
            }
        }
        const arrCmpMatch = line.match(/if\s*\(\s*([a-zA-Z0-9_]+)\s*\[\s*([a-zA-Z0-9_]+)\s*\]\s*(==|!=)\s*([^)]+)\)/);
        if (arrCmpMatch) {
            const cmpVal = evaluateCExpression(applyDefines(arrCmpMatch[4].trim()), defines);
            const lblFalse = '__lbl_false_' + (labelCounter++);
            const lblEnd = '__lbl_end_' + (labelCounter++);
            if (emitArrRead(arrCmpMatch[1], arrCmpMatch[2], lineNum)) {
                push('cpi r16, ' + ((cmpVal !== null ? cmpVal : 0) & 0xFF), lineNum);
                emitCondBranch(arrCmpMatch[3], lblFalse, lineNum);
                controlStack.push({ type: 'if', lblFalse, lblEnd });
                continue;
            }
        }
        if (line.startsWith('if') && line.includes('&&')) {
            const condContent = line.substring(line.indexOf('(') + 1, line.lastIndexOf(')'));
            const lblFalse = '__lbl_false_' + (labelCounter++);
            const lblEnd = '__lbl_end_' + (labelCounter++);
            for (let sub of condContent.split('&&').map(c => c.trim())) {
                const m = sub.match(/([a-zA-Z0-9_]+)\s*(==|!=|>=|>|<=|<)\s*([^]+)/);
                if (m && varMap[m[1]]) {
                    const cVal = evaluateCExpression(applyDefines(m[3]), defines);
                    push('cpi ' + varMap[m[1]].reg + ', ' + ((cVal !== null ? cVal : 0) & 0xFF), lineNum);
                    emitCondBranch(m[2], lblFalse, lineNum);
                }
            }
            controlStack.push({ type: 'if', lblFalse, lblEnd });
            continue;
        }
        const portOrMatch = line.match(RW_PORTS_REGEX);
        if (portOrMatch) {
            const portName = portOrMatch[1];
            const mask = evaluateCExpression(applyDefines(portOrMatch[2]), defines) & 0xFF;
            push((isExtReg(portName) ? 'lds' : 'in') + ' r16, ' + portName, lineNum);
            push('ori r16, ' + mask, lineNum);
            push((isExtReg(portName) ? 'sts' : 'out') + ' ' + portName + ', r16', lineNum);
            continue;
        }
        const portAndNotMatch = line.match(AND_NOT_REGEX);
        if (portAndNotMatch) {
            const portName = portAndNotMatch[1];
            const rawExpr = line.substring(line.indexOf('~') + 1, line.lastIndexOf(';')).trim();
            const mask = evaluateCExpression(applyDefines(rawExpr), defines) & 0xFF;
            push((isExtReg(portName) ? 'lds' : 'in') + ' r16, ' + portName, lineNum);
            push('andi r16, ' + ((~mask) & 0xFF), lineNum);
            push((isExtReg(portName) ? 'sts' : 'out') + ' ' + portName + ', r16', lineNum);
            continue;
        }
        const portXorMatch = line.match(XOR_REGEX);
        if (portXorMatch) {
            const portName = portXorMatch[1];
            const mask = evaluateCExpression(applyDefines(portXorMatch[2]), defines) & 0xFF;
            push((isExtReg(portName) ? 'lds' : 'in') + ' r16, ' + portName, lineNum);
            push('ldi r17, ' + mask, lineNum);
            push('eor r16, r17', lineNum);
            push((isExtReg(portName) ? 'sts' : 'out') + ' ' + portName + ', r16', lineNum);
            continue;
        }
        const assignMatch = line.match(/\b([a-zA-Z0-9_]+)\s*=\s*([^;]+);/);
        if (assignMatch) {
            const dst = assignMatch[1].trim();
            const src = assignMatch[2].trim();
            if (dst === 'UBRR0') {
                const cVal = evaluateCExpression(applyDefines(src), defines) || 0;
                push('ldi r16, ' + ((cVal >> 8) & 0xFF), lineNum);
                push('sts UBRR0H, r16', lineNum);
                push('ldi r16, ' + (cVal & 0xFF), lineNum);
                push('sts UBRR0L, r16', lineNum);
                continue;
            }
            if (dst === 'UBRR0L' || dst === 'UBRR0H') {
                const cVal = evaluateCExpression(applyDefines(src), defines) || 0;
                push('ldi r16, ' + (cVal & 0xFF), lineNum);
                push('sts ' + dst + ', r16', lineNum);
                continue;
            }
            if (RW_PORTS.includes(dst) || dst === 'UDR0') {
                const arrAccess = src.match(/^([a-zA-Z0-9_]+)\[([a-zA-Z0-9_]+)\]$/);
                if (arrAccess && emitArrRead(arrAccess[1], arrAccess[2], lineNum)) { emitStore(dst, lineNum); continue; }
                if (READ_REGS.includes(src)) {
                    push((isExtReg(src) ? 'lds' : 'in') + ' r16, ' + src, lineNum);
                    emitStore(dst, lineNum); continue;
                }
                if (varMap[src]) { push((isExtReg(dst) ? 'sts ' : 'out ') + dst + ', ' + varMap[src].reg, lineNum); continue; }
                const cVal = evaluateCExpression(applyDefines(src), defines);
                if (cVal !== null) { push('ldi r16, ' + (cVal & 0xFF), lineNum); emitStore(dst, lineNum); }
                continue;
            }
            if (varMap[dst]) {
                const arrAccess = src.match(/^([a-zA-Z0-9_]+)\[([a-zA-Z0-9_]+)\]$/);
                if (arrAccess && emitArrRead(arrAccess[1], arrAccess[2], lineNum)) {
                    push('mov ' + varMap[dst].reg + ', r16', lineNum); continue;
                }
                if (READ_REGS.includes(src)) {
                    push((isExtReg(src) ? 'lds ' : 'in ') + varMap[dst].reg + ', ' + src, lineNum); continue;
                }
                const bin = src.match(/^([a-zA-Z0-9_]+)\s*([\^&|])\s*([a-zA-Z0-9_]+)$/);
                if (bin && varMap[bin[1]] && varMap[bin[3]]) {
                    const opAsm = { '^': 'eor', '&': 'and', '|': 'or' }[bin[2]];
                    push('mov ' + varMap[dst].reg + ', ' + varMap[bin[1]].reg, lineNum);
                    push(opAsm + ' ' + varMap[dst].reg + ', ' + varMap[bin[3]].reg, lineNum);
                    continue;
                }
                if (varMap[src]) { push('mov ' + varMap[dst].reg + ', ' + varMap[src].reg, lineNum); continue; }
                const cVal = evaluateCExpression(applyDefines(src), defines);
                if (cVal !== null) push('ldi ' + varMap[dst].reg + ', ' + (cVal & 0xFF), lineNum);
                continue;
            }
        }
        if (line.startsWith('if') && line.includes('PIN')) {
            const isNegated = line.includes('!(') || line.includes('== 0') || line.includes('!(PIN');
            const pinInfo = extractPinAndBit(line);
            if (pinInfo) {
                const lblFalse = '__lbl_false_' + (labelCounter++);
                const lblEnd = '__lbl_end_' + (labelCounter++);
                push('in r16, ' + pinInfo.port, lineNum);
                push((isNegated ? 'sbrc' : 'sbrs') + ' r16, ' + pinInfo.bit, lineNum);
                push('rjmp ' + lblFalse, lineNum);
                controlStack.push({ type: 'if', lblFalse, lblEnd });
                continue;
            }
        }
        const ifMatch = line.match(/if\s*\(\s*([a-zA-Z0-9_]+)\s*(==|!=|>=|>|<=|<)\s*([^)]+)\)/);
        if (ifMatch) {
            const cmpVal = evaluateCExpression(applyDefines(ifMatch[3]), defines);
            if (cmpVal !== null && varMap[ifMatch[1]]) {
                const lblFalse = '__lbl_false_' + (labelCounter++);
                const lblEnd = '__lbl_end_' + (labelCounter++);
                push('cpi ' + varMap[ifMatch[1]].reg + ', ' + (scaleThreshold(cmpVal) & 0xFF), lineNum);
                emitCondBranch(ifMatch[2], lblFalse, lineNum);
                controlStack.push({ type: 'if', lblFalse, lblEnd });
                continue;
            }
        }
        if (line.startsWith('while') && line.includes('1')) {
            const startLbl = '__while_start_' + (labelCounter++);
            push(startLbl + ':', lineNum);
            controlStack.push({ type: 'while', startLbl });
            continue;
        }
        const incMatch = line.match(/\b([a-zA-Z0-9_]+)\+\+;/);
        if (incMatch && varMap[incMatch[1]]) { push('inc ' + varMap[incMatch[1]].reg, lineNum); continue; }
        const decMatch = line.match(/\b([a-zA-Z0-9_]+)--;/);
        if (decMatch && varMap[decMatch[1]]) { push('dec ' + varMap[decMatch[1]].reg, lineNum); continue; }
    }
    while (controlStack.length > 0) {
        const top = controlStack.pop();
        if (top.type === 'while') push('rjmp ' + top.startLbl, origLines.length);
        else if (top.type === 'if') { push(top.lblFalse + ':', origLines.length); push(top.lblEnd + ':', origLines.length); }
        else if (top.type === 'else') push(top.lblEnd + ':', origLines.length);
        else if (top.type === 'isr') isrEpilogue(origLines.length);
    }
    return asmList;
}

/* ================= 11. ПАРСЕР И ПРЕ-ДЕКОДИНГ ================= */

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

    expr = expr.replace(/'\\n'/g, '10').replace(/'\\r'/g, '13').replace(/'\\0'/g, '0');
    expr = expr.replace(/'(.)'/g, (m, c) => c.charCodeAt(0));
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
    if (cpu.defAliases && cpu.defAliases[arg] !== undefined) {
        return cpu.defAliases[arg];
    }
    const aliases = { 
        'xl': 26, 'xh': 27, 'x': 26,
        'yl': 28, 'yh': 29, 'y': 28,
        'zl': 30, 'zh': 31, 'z': 30 
    };
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

let inspectorNeedsRebuild = true;
let lastInspectorPc = -1;

function parseProgram(text) {
    cpu.program = [];
    cpu.labels = {};
    cpu.equConstants = {};
    cpu.defAliases = {};
    cpu.flashBytes.fill(0);
    cpu.error = null;
    inspectorNeedsRebuild = true;
    lastInspectorPc = -1;

    if (!text) return;
    text = text.replace(/\r/g, '');

    validateSourceCode(text, currentLang);
    if (cpu.syntaxErrors.size > 0) return;

    if (currentLang === 'c') {
        const compiled = compileCToAsm(text);
        let instIndex = 0;
        for (let item of compiled) {
            let line = item.asm.trim();
            if (!line || line.startsWith('.cseg')) continue;

            if (line.includes(':') && !line.toLowerCase().includes('.db')) {
                const parts = line.split(':');
                const lblName = parts[0].trim().toLowerCase();
                cpu.labels[lblName] = instIndex;
                line = parts.slice(1).join(':').trim();
                if (!line) continue;
            }

            const lblDbMatch = line.match(/^([a-zA-Z0-9_]+):\s*(\.db\b.*)/i);
            if (lblDbMatch) {
                cpu.labels[lblDbMatch[1].toLowerCase()] = instIndex;
                line = lblDbMatch[2];
            }

            if (line.toLowerCase().startsWith('.db')) {
                const dataStr = line.substring(3).trim();
                let bytePtr = instIndex * 2;
                const items = dataStr.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
                for (let itm of items) {
                    itm = itm.trim();
                    if (itm.startsWith('"') && itm.endsWith('"')) {
                        const strVal = itm.slice(1, -1);
                        for (let c = 0; c < strVal.length; c++) {
                            if (strVal[c] === '\\' && c + 1 < strVal.length) {
                                if (strVal[c+1] === 'n') { cpu.flashBytes[bytePtr++] = 10; c++; continue; }
                                if (strVal[c+1] === 'r') { cpu.flashBytes[bytePtr++] = 13; c++; continue; }
                            }
                            cpu.flashBytes[bytePtr++] = strVal.charCodeAt(c);
                        }
                    } else if (itm === "'\\n'") {
                        cpu.flashBytes[bytePtr++] = 10;
                    } else {
                        cpu.flashBytes[bytePtr++] = evaluateAsmExpression(itm) & 0xFF;
                    }
                }
                const wordsUsed = Math.ceil((bytePtr - (instIndex * 2)) / 2);
                for (let w = 0; w < wordsUsed; w++) {
                    cpu.program[instIndex + w] = { op: 'nop', args: [], lineNum: item.lineNum, raw: '.db', targetPc: -1 };
                }
                instIndex += wordsUsed;
                continue;
            }

            const tokens = line.split(/\s+/);
            const op = tokens[0].toLowerCase();
            const argsStr = line.substring(tokens[0].length).trim();
            const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];
            const instObj = { op, args, lineNum: item.lineNum, raw: line, targetPc: -1 };
            cpu.program[instIndex] = instObj;
            if (isTwoWordInstruction(instObj)) {
                cpu.program[instIndex + 1] = { op: '_word2', args: [], lineNum: item.lineNum, raw: '', targetPc: -1 };
                instIndex += 2;
            } else {
                instIndex += 1;
            }
        }
    } else {
        cpu.symbols = [];
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            const sIdx = line.indexOf(';');
            if (sIdx !== -1) line = line.substring(0, sIdx);
            line = line.trim();
            const eqMatch = line.match(/\.equ\s+([a-zA-Z0-9_]+)\s*=\s*(.+)/i);
            if (eqMatch) cpu.equConstants[eqMatch[1].trim()] = evaluateAsmExpression(eqMatch[2].trim());

            const defMatch = line.match(/\.def\s+([a-zA-Z0-9_]+)\s*=\s*r([0-9]+)/i);
            if (defMatch) {
                cpu.defAliases[defMatch[1].toLowerCase()] = parseInt(defMatch[2], 10);
                cpu.symbols.push({ name: defMatch[1], type: 'reg', size: 1, locType: 'reg', location: 'R' + defMatch[2] });
            }
        }

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
                    cpu.program[wordIndex] = { op: 'nop', args: [], lineNum: i + 1, raw: 'nop', targetPc: -1 };
                    wordIndex++;
                }
                continue;
            }

            const lblDbMatch = line.match(/^([a-zA-Z0-9_]+):\s*(\.db\b.*)/i);
            if (lblDbMatch) {
                cpu.labels[lblDbMatch[1].toLowerCase()] = wordIndex;
                line = lblDbMatch[2];
            }

            if (line.toLowerCase().startsWith('.db')) {
                const dataStr = line.substring(3).trim();
                let bytePtr = wordIndex * 2;
                const items = dataStr.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
                for (let itm of items) {
                    itm = itm.trim();
                    if (itm.startsWith('"') && itm.endsWith('"')) {
                        const strVal = itm.slice(1, -1);
                        for (let c = 0; c < strVal.length; c++) cpu.flashBytes[bytePtr++] = strVal.charCodeAt(c);
                    } else if (itm === "'\\n'") cpu.flashBytes[bytePtr++] = 10;
                    else if (itm === "'\\r'") cpu.flashBytes[bytePtr++] = 13;
                    else cpu.flashBytes[bytePtr++] = evaluateAsmExpression(itm) & 0xFF;
                }
                const wordsUsed = Math.ceil((bytePtr - (wordIndex * 2)) / 2);
                for (let w = 0; w < wordsUsed; w++) {
                    cpu.program[wordIndex + w] = { op: 'nop', args: [], lineNum: i + 1, raw: '.db', targetPc: -1 };
                }
                wordIndex += wordsUsed;
                continue;
            }

            if (line.startsWith('.')) continue;

            const segments = line.split(':');
            for (let sIdx = 0; sIdx < segments.length; sIdx++) {
                const part = segments[sIdx].trim();
                if (!part) continue;
                const hadColonAfter = (sIdx < segments.length - 1);
                const tokens = part.split(/\s+/);
                const first = tokens[0].toLowerCase();

                if (!KNOWN_OPS.has(first)) {
                    if (hadColonAfter && tokens.length === 1) {
                        cpu.labels[first] = wordIndex;
                        continue;
                    }
                    cpu.error = 'Строка ' + (i + 1) + ': неизвестная команда "' + tokens[0] + '"';
                    return;
                }

                const op = first;
                const argsStr = part.substring(tokens[0].length).trim();
                const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];
                const instObj = { op, args, lineNum: i + 1, raw: part, targetPc: -1 };
                cpu.program[wordIndex] = instObj;
                if (isTwoWordInstruction(instObj)) {
                    cpu.program[wordIndex + 1] = { op: '_word2', args: [], lineNum: i + 1, raw: '', targetPc: -1 };
                    wordIndex += 2;
                } else {
                    wordIndex += 1;
                }
            }
        }
    }

    for (let j = 0; j < cpu.program.length; j++) {
        const inst = cpu.program[j];
        if (!inst) {
            cpu.program[j] = { op: 'nop', args: [], lineNum: 1, raw: 'nop', targetPc: -1 };
            continue;
        }
        if (inst.op === '_word2') continue;

        const a = inst.args || [];
        inst.rd = a[0] ? parseReg(a[0]) : 0;
        inst.rr = a[1] ? parseReg(a[1]) : 0;

        if (['ldi', 'subi', 'sbci', 'andi', 'ori', 'cpi', 'sbr', 'cbr', 'adiw', 'sbiw'].includes(inst.op)) {
            inst.imm = a[1] ? (parseVal(a[1]) & 0xFF) : 0;
        }
        if (inst.op === 'in') {
            inst.ioAddr = a[1] ? resolveIoRamAddr(a[1]) : 0;
        } else if (['out', 'sbi', 'cbi', 'sbis', 'sbic'].includes(inst.op)) {
            inst.ioAddr = a[0] ? resolveIoRamAddr(a[0]) : 0;
            if (['sbi', 'cbi', 'sbis', 'sbic'].includes(inst.op)) {
                inst.bit = a[1] ? (parseVal(a[1]) & 0x07) : 0;
            }
        }

        if (['sbrs', 'sbrc', 'bst', 'bld'].includes(inst.op)) {
            inst.bit = a[1] ? (parseVal(a[1]) & 0x07) : 0;
        }

        if (['lds', 'sts'].includes(inst.op)) {
            inst.dataAddr = resolveDataRamAddr(inst.op === 'lds' ? a[1] : a[0]);
        }

        if (['jmp', 'rjmp', 'call', 'rcall', 'breq', 'brne', 'brcs', 'brcc', 'brlo', 'brsh', 'brts', 'brtc', 'brmi', 'brpl', 'brge', 'brlt', 'brhs', 'brhc', 'brvs', 'brvc', 'brls', 'brhi'].includes(inst.op)) {
            const targetLbl = a[0] ? a[0].toLowerCase() : '';
            if (cpu.labels[targetLbl] !== undefined) {
                inst.targetPc = cpu.labels[targetLbl];
            }
        }
    }
}

/* ================= 12. ГЕНЕРАТОР INTEL HEX ================= */

function encodeAvrInstruction(inst, wordAddr = 0) {
    if (!inst) return [0x00, 0x00];
    const op = inst.op.toLowerCase();
    const a = inst.args || [];
    const le16 = (code) => [code & 0xFF, (code >> 8) & 0xFF];

    const sregFlagBits = {
        sec: 0, clc: 0, sez: 1, clz: 1, sen: 2, cln: 2, sev: 3, clv: 3,
        ses: 4, cls: 4, seh: 5, clh: 5, set: 6, clt: 6, sei: 7, cli: 7
    };
    if (op in sregFlagBits) {
        const isClear = op.startsWith('cl');
        return le16((isClear ? 0x9488 : 0x9408) | (sregFlagBits[op] << 4));
    }

    const brSet = { brcs: 0, brlo: 0, breq: 1, brmi: 2, brvs: 3, brlt: 4, brhs: 5, brts: 6 };
    const brClr = { brcc: 0, brsh: 0, brne: 1, brpl: 2, brvc: 3, brge: 4, brhc: 5, brtc: 6 };
    if (op in brSet || op in brClr) {
        const target = inst.targetPc !== -1 ? inst.targetPc : 0;
        const offset = (target - (wordAddr + 1)) & 0x7F;
        const s = (op in brSet) ? brSet[op] : brClr[op];
        const base = (op in brSet) ? 0xF000 : 0xF400;
        return le16(base | (offset << 3) | s);
    }

    try {
        switch (op) {
            case 'nop':   return [0x00, 0x00];
            case 'ret':   return [0x08, 0x95];
            case 'reti':  return [0x18, 0x95];
            case 'sleep': return [0x88, 0x95];
            case 'break': return [0x98, 0x95];
            case 'wdr':   return [0xA8, 0x95];

            case 'lpm': {
                if (a.length >= 2 && a[1].includes('+')) return le16(0x9005 | (inst.rd << 4));
                if (a.length >= 1 && a[0]) return le16(0x9004 | (inst.rd << 4));
                return [0xC8, 0x95];
            }

            case 'ldi':  return le16(0xE000 | ((inst.imm & 0xF0) << 4) | (((inst.rd - 16) & 0x0F) << 4) | (inst.imm & 0x0F));
            case 'ser':  return le16(0xEF0F | (((inst.rd - 16) & 0x0F) << 4));
            case 'subi': return le16(0x5000 | ((inst.imm & 0xF0) << 4) | (((inst.rd - 16) & 0x0F) << 4) | (inst.imm & 0x0F));
            case 'sbci': return le16(0x4000 | ((inst.imm & 0xF0) << 4) | (((inst.rd - 16) & 0x0F) << 4) | (inst.imm & 0x0F));
            case 'cpi':  return le16(0x3000 | ((inst.imm & 0xF0) << 4) | (((inst.rd - 16) & 0x0F) << 4) | (inst.imm & 0x0F));
            case 'ori':
            case 'sbr':  return le16(0x6000 | ((inst.imm & 0xF0) << 4) | (((inst.rd - 16) & 0x0F) << 4) | (inst.imm & 0x0F));
            case 'andi': return le16(0x7000 | ((inst.imm & 0xF0) << 4) | (((inst.rd - 16) & 0x0F) << 4) | (inst.imm & 0x0F));
            case 'cbr': {
                const k = (~inst.imm) & 0xFF;
                return le16(0x7000 | ((k & 0xF0) << 4) | (((inst.rd - 16) & 0x0F) << 4) | (k & 0x0F));
            }

            case 'cpc':  return le16(0x0400 | ((inst.rr & 0x10) << 5) | (inst.rd << 4) | (inst.rr & 0x0F));
            case 'sbc':  return le16(0x0800 | ((inst.rr & 0x10) << 5) | (inst.rd << 4) | (inst.rr & 0x0F));
            case 'add':  return le16(0x0C00 | ((inst.rr & 0x10) << 5) | (inst.rd << 4) | (inst.rr & 0x0F));
            case 'cpse': return le16(0x1000 | ((inst.rr & 0x10) << 5) | (inst.rd << 4) | (inst.rr & 0x0F));
            case 'cp':   return le16(0x1400 | ((inst.rr & 0x10) << 5) | (inst.rd << 4) | (inst.rr & 0x0F));
            case 'sub':  return le16(0x1800 | ((inst.rr & 0x10) << 5) | (inst.rd << 4) | (inst.rr & 0x0F));
            case 'adc':  return le16(0x1C00 | ((inst.rr & 0x10) << 5) | (inst.rd << 4) | (inst.rr & 0x0F));
            case 'and':  return le16(0x2000 | ((inst.rr & 0x10) << 5) | (inst.rd << 4) | (inst.rr & 0x0F));
            case 'eor':  return le16(0x2400 | ((inst.rr & 0x10) << 5) | (inst.rd << 4) | (inst.rr & 0x0F));
            case 'or':   return le16(0x2800 | ((inst.rr & 0x10) << 5) | (inst.rd << 4) | (inst.rr & 0x0F));
            case 'mov':  return le16(0x2C00 | ((inst.rr & 0x10) << 5) | (inst.rd << 4) | (inst.rr & 0x0F));
            case 'mul':  return le16(0x9C00 | ((inst.rr & 0x10) << 5) | (inst.rd << 4) | (inst.rr & 0x0F));

            case 'clr':  return le16(0x2400 | ((inst.rd & 0x10) << 5) | (inst.rd << 4) | (inst.rd & 0x0F));
            case 'tst':  return le16(0x2000 | ((inst.rd & 0x10) << 5) | (inst.rd << 4) | (inst.rd & 0x0F));
            case 'lsl':  return le16(0x0C00 | ((inst.rd & 0x10) << 5) | (inst.rd << 4) | (inst.rd & 0x0F));
            case 'rol':  return le16(0x1C00 | ((inst.rd & 0x10) << 5) | (inst.rd << 4) | (inst.rd & 0x0F));

            case 'movw':  return le16(0x0100 | (((inst.rd >> 1) & 0x0F) << 4) | ((inst.rr >> 1) & 0x0F));
            case 'muls':  return le16(0x0200 | (((inst.rd - 16) & 0x0F) << 4) | ((inst.rr - 16) & 0x0F));
            case 'mulsu': return le16(0x0300 | (((inst.rd - 16) & 0x07) << 4) | ((inst.rr - 16) & 0x07));

            case 'adiw': {
                const d = ((inst.rd - 24) >> 1) & 0x03;
                const k = inst.imm & 0x3F;
                return le16(0x9600 | ((k & 0x30) << 2) | (d << 4) | (k & 0x0F));
            }
            case 'sbiw': {
                const d = ((inst.rd - 24) >> 1) & 0x03;
                const k = inst.imm & 0x3F;
                return le16(0x9700 | ((k & 0x30) << 2) | (d << 4) | (k & 0x0F));
            }

            case 'com':  return le16(0x9400 | (inst.rd << 4));
            case 'neg':  return le16(0x9401 | (inst.rd << 4));
            case 'swap': return le16(0x9402 | (inst.rd << 4));
            case 'inc':  return le16(0x9403 | (inst.rd << 4));
            case 'asr':  return le16(0x9405 | (inst.rd << 4));
            case 'lsr':  return le16(0x9406 | (inst.rd << 4));
            case 'ror':  return le16(0x9407 | (inst.rd << 4));
            case 'dec':  return le16(0x940A | (inst.rd << 4));
            case 'push': return le16(0x920F | (inst.rd << 4));
            case 'pop':  return le16(0x900F | (inst.rd << 4));

            case 'in': {
                const port = (inst.ioAddr - IO_OFFSET) & 0x3F;
                return le16(0xB000 | ((port & 0x30) << 5) | (inst.rd << 4) | (port & 0x0F));
            }
            case 'out': {
                const port = (inst.ioAddr - IO_OFFSET) & 0x3F;
                return le16(0xB800 | ((port & 0x30) << 5) | (inst.rr << 4) | (port & 0x0F));
            }

            case 'cbi':  return le16(0x9800 | (((inst.ioAddr - IO_OFFSET) & 0x1F) << 3) | (inst.bit & 0x07));
            case 'sbic': return le16(0x9900 | (((inst.ioAddr - IO_OFFSET) & 0x1F) << 3) | (inst.bit & 0x07));
            case 'sbi':  return le16(0x9A00 | (((inst.ioAddr - IO_OFFSET) & 0x1F) << 3) | (inst.bit & 0x07));
            case 'sbis': return le16(0x9B00 | (((inst.ioAddr - IO_OFFSET) & 0x1F) << 3) | (inst.bit & 0x07));

            case 'bld':  return le16(0xF800 | (inst.rd << 4) | (inst.bit & 0x07));
            case 'bst':  return le16(0xFA00 | (inst.rd << 4) | (inst.bit & 0x07));
            case 'sbrc': return le16(0xFC00 | (inst.rd << 4) | (inst.bit & 0x07));
            case 'sbrs': return le16(0xFE00 | (inst.rd << 4) | (inst.bit & 0x07));

            case 'ld': {
                const ptr = (a[1] || '').toLowerCase();
                let base = 0x8000;
                if (ptr === 'x') base = 0x900C;
                else if (ptr === 'x+') base = 0x900D;
                else if (ptr === '-x') base = 0x900E;
                else if (ptr === 'y') base = 0x8008;
                else if (ptr === 'y+') base = 0x9009;
                else if (ptr === '-y') base = 0x900A;
                else if (ptr === 'z') base = 0x8000;
                else if (ptr === 'z+') base = 0x9001;
                else if (ptr === '-z') base = 0x9002;
                return le16(base | (inst.rd << 4));
            }
            case 'st': {
                const ptr = (a[0] || '').toLowerCase();
                let base = 0x8200;
                if (ptr === 'x') base = 0x920C;
                else if (ptr === 'x+') base = 0x920D;
                else if (ptr === '-x') base = 0x920E;
                else if (ptr === 'y') base = 0x8208;
                else if (ptr === 'y+') base = 0x9209;
                else if (ptr === '-y') base = 0x920A;
                else if (ptr === 'z') base = 0x8200;
                else if (ptr === 'z+') base = 0x9201;
                else if (ptr === '-z') base = 0x9202;
                return le16(base | (inst.rr << 4));
            }

            case 'sts': {
                const code1 = 0x9200 | (inst.rr << 4);
                return [code1 & 0xFF, (code1 >> 8) & 0xFF, inst.dataAddr & 0xFF, (inst.dataAddr >> 8) & 0xFF];
            }
            case 'lds': {
                const code1 = 0x9000 | (inst.rd << 4);
                return [code1 & 0xFF, (code1 >> 8) & 0xFF, inst.dataAddr & 0xFF, (inst.dataAddr >> 8) & 0xFF];
            }
            case 'jmp': {
                const target = inst.targetPc !== -1 ? inst.targetPc : 0;
                return [0x0C, 0x94, target & 0xFF, (target >> 8) & 0xFF];
            }
            case 'call': {
                const target = inst.targetPc !== -1 ? inst.targetPc : 0;
                return [0x0E, 0x94, target & 0xFF, (target >> 8) & 0xFF];
            }
            case 'rjmp': {
                const target = inst.targetPc !== -1 ? inst.targetPc : 0;
                const offset = (target - (wordAddr + 1)) & 0x0FFF;
                return le16(0xC000 | offset);
            }
            case 'rcall': {
                const target = inst.targetPc !== -1 ? inst.targetPc : 0;
                const offset = (target - (wordAddr + 1)) & 0x0FFF;
                return le16(0xD000 | offset);
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
    for (let i = 0; i < cpu.flashBytes.length; i++) hexBuffer[i] = cpu.flashBytes[i];

    for (let i = 0; i < cpu.program.length; i++) {
        const inst = cpu.program[i];
        if (inst && inst.raw !== '.db' && inst.op !== '_word2') {
            const bytes = encodeAvrInstruction(inst, i);
            for (let b = 0; b < bytes.length; b++) hexBuffer[i * 2 + b] = bytes[b];
        }
    }

    const maxAddr = cpu.program.length * 2;
    let hexText = '';
    for (let addr = 0; addr < maxAddr; addr += 16) {
        const len = Math.min(16, maxAddr - addr);
        let sum = len + ((addr >> 8) & 0xFF) + (addr & 0xFF) + 0x00;
        let line = ':' + len.toString(16).padStart(2, '0').toUpperCase();
        line += addr.toString(16).padStart(4, '0').toUpperCase() + '00';

        for (let b = 0; b < len; b++) {
            const val = hexBuffer[addr + b] || 0;
            line += val.toString(16).padStart(2, '0').toUpperCase();
            sum += val;
        }

        const checksum = ((~sum + 1) & 0xFF).toString(16).padStart(2, '0').toUpperCase();
        hexText += line + checksum + '\n';
    }

    hexText += ':00000001FF\n';

    const blob = new Blob([hexText], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'firmware.hex';
    a.click();
}

/* ================= 13. ДОСТУП К ПАМЯТИ И EEPROM ================= */

function writeRAM(addr, val) {
    val &= 0xFF;
    if (addr < 0 || addr >= cpu.ram.length) return;

    if (addr === IO.PINB) { writeRAM(IO.PORTB, readRAM(IO.PORTB) ^ val); return; }
    if (addr === IO.PINC) { writeRAM(IO.PORTC, readRAM(IO.PORTC) ^ val); return; }
    if (addr === IO.PIND) { writeRAM(IO.PORTD, readRAM(IO.PORTD) ^ val); return; }

    if (addr === IO.EIFR || addr === IO.PCIFR) {
        cpu.ram[addr] &= ~val;
        return;
    }

    if (addr === IO.SREG) {
        cpu.ram[IO.SREG] = val;
        cpu.sreg.C = (val >> 0) & 1;
        cpu.sreg.Z = (val >> 1) & 1;
        cpu.sreg.N = (val >> 2) & 1;
        cpu.sreg.V = (val >> 3) & 1;
        cpu.sreg.S = (val >> 4) & 1;
        cpu.sreg.H = (val >> 5) & 1;
        cpu.sreg.T = (val >> 6) & 1;
        cpu.sreg.I = (val >> 7) & 1;
        return;
    }

    if (addr === IO.ADCSRA) {
        if ((val & (1 << 7)) && (val & (1 << 6))) {
            syncAnalogHardware();
            val &= ~(1 << 6);
            val |= (1 << 4);
        }
        cpu.ram[IO.ADCSRA] = val;
        return;
    }

    if (addr === IO.EECR) {
        cpu.ram[IO.EECR] = val;
        const eear = readRAM(IO.EEARL) | ((readRAM(IO.EEARH) & 0x03) << 8);
        if (val & (1 << 1)) {
            const dataByte = readRAM(IO.EEDR);
            if (eear < cpu.eeprom.length) {
                cpu.eeprom[eear] = dataByte;
                try { localStorage.setItem('avr_eeprom', JSON.stringify(Array.from(cpu.eeprom))); } catch(e){}
            }
            cpu.ram[IO.EECR] &= ~(1 << 1);
        }
        if (val & (1 << 0)) {
            if (eear < cpu.eeprom.length) cpu.ram[IO.EEDR] = cpu.eeprom[eear];
            cpu.ram[IO.EECR] &= ~(1 << 0);
        }
        return;
    }

    cpu.ram[addr] = val;
    if (addr >= 0 && addr < 32) cpu.r[addr] = val;

    if (addr === IO.SPL) cpu.sp = (cpu.sp & 0xFF00) | val;
    else if (addr === IO.SPH) cpu.sp = (cpu.sp & 0x00FF) | (val << 8);

    else if (addr === IO.UDR0) {
        cpu.uartLog += String.fromCharCode(val);
        cpu.ram[IO.UCSR0A] &= ~(1 << 5);
        cpu.ram[IO.UCSR0A] &= ~(1 << 6);
        cpu.uartTxBusyCycles = 4;
        appendUartTerminal(String.fromCharCode(val));
    }
}

function readRAM(addr) {
    if (addr >= 0 && addr < 32) return cpu.r[addr];

    if (addr === IO.SREG) {
        return (cpu.sreg.I << 7) | (cpu.sreg.T << 6) | (cpu.sreg.H << 5) | (cpu.sreg.S << 4) |
               (cpu.sreg.V << 3) | (cpu.sreg.N << 2) | (cpu.sreg.Z << 1) | cpu.sreg.C;
    }

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

function isTwoWordInstruction(inst) {
    if (!inst) return false;
    return ['jmp', 'call', 'lds', 'sts'].includes(inst.op.toLowerCase());
}

/* ================= 14. ФЛАГИ АЛУ ================= */

function setFlagsAdd(a, b, res) {
    const Rd3 = (a >> 3) & 1, Rr3 = (b >> 3) & 1, R3 = (res >> 3) & 1;
    const Rd7 = (a >> 7) & 1, Rr7 = (b >> 7) & 1, R7 = (res >> 7) & 1;

    cpu.sreg.H = ((Rd3 & Rr3) | (Rr3 & !R3) | (!R3 & Rd3)) ? 1 : 0;
    cpu.sreg.C = (res > 0xFF) ? 1 : 0;
    cpu.sreg.Z = ((res & 0xFF) === 0) ? 1 : 0;
    cpu.sreg.N = (res & 0x80) ? 1 : 0;
    cpu.sreg.V = ((Rd7 & Rr7 & !R7) | (!Rd7 & !Rr7 & R7)) ? 1 : 0;
    cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
}

function setFlagsSub(a, b, res, isSbc = false) {
    const Rd3 = (a >> 3) & 1, Rr3 = (b >> 3) & 1, R3 = (res >> 3) & 1;
    const Rd7 = (a >> 7) & 1, Rr7 = (b >> 7) & 1, R7 = (res >> 7) & 1;

    cpu.sreg.H = ((!Rd3 & Rr3) | (Rr3 & R3) | (R3 & !Rd3)) ? 1 : 0;
    cpu.sreg.C = ((!Rd7 & Rr7) | (Rr7 & R7) | (R7 & !Rd7)) ? 1 : 0;

    if (isSbc) cpu.sreg.Z = (((res & 0xFF) === 0) && cpu.sreg.Z) ? 1 : 0;
    else cpu.sreg.Z = ((res & 0xFF) === 0) ? 1 : 0;

    cpu.sreg.N = (res & 0x80) ? 1 : 0;
    cpu.sreg.V = ((Rd7 & !Rr7 & !R7) | (!Rd7 & Rr7 & R7)) ? 1 : 0;
    cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
}

function setFlagsLogic(val) {
    cpu.sreg.Z = ((val & 0xFF) === 0) ? 1 : 0;
    cpu.sreg.N = (val & 0x80) ? 1 : 0;
    cpu.sreg.V = 0;
    cpu.sreg.S = cpu.sreg.N;
}

/* ================= 15. ДИСПЕТЧЕР ПРЕРЫВАНИЙ ================= */

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

    pinb = (pinb & ~ddrb) | (portb & ddrb);
    pind = (pind & ~ddrd) | (portd & ddrd);
    pinc = (pinc & ~ddrc) | (portc & ddrc);

    cpu.ram[IO.PINB] = pinb;
    cpu.ram[IO.PIND] = pind;
    cpu.ram[IO.PINC] = pinc;
}

function checkInterrupts() {
    const curPind = readRAM(IO.PIND);
    const curPinb = readRAM(IO.PINB);
    const curPinc = readRAM(IO.PINC);
    const eicra = readRAM(IO.EICRA);
    let eifr = readRAM(IO.EIFR);
    let pcifr = readRAM(IO.PCIFR);

    const isc0 = eicra & 0x03;
    const pd2Now = (curPind >> 2) & 1;
    const pd2Prev = (cpu.prevPinD >> 2) & 1;

    if (isc0 === 0 && pd2Now === 0) eifr |= (1 << 0);
    else if (isc0 === 1 && pd2Now !== pd2Prev) eifr |= (1 << 0);
    else if (isc0 === 2 && pd2Prev === 1 && pd2Now === 0) eifr |= (1 << 0);
    else if (isc0 === 3 && pd2Prev === 0 && pd2Now === 1) eifr |= (1 << 0);

    const isc1 = (eicra >> 2) & 0x03;
    const pd3Now = (curPind >> 3) & 1;
    const pd3Prev = (cpu.prevPinD >> 3) & 1;

    if (isc1 === 0 && pd3Now === 0) eifr |= (1 << 1);
    else if (isc1 === 1 && pd3Now !== pd3Prev) eifr |= (1 << 1);
    else if (isc1 === 2 && pd3Prev === 1 && pd3Now === 0) eifr |= (1 << 1);
    else if (isc1 === 3 && pd3Prev === 0 && pd3Now === 1) eifr |= (1 << 1);

    cpu.ram[IO.EIFR] = eifr;

    const pcmsk0 = readRAM(IO.PCMSK0);
    const pcmsk1 = readRAM(IO.PCMSK1);
    const pcmsk2 = readRAM(IO.PCMSK2);
    if ((curPinb ^ cpu.prevPinB) & pcmsk0) pcifr |= (1 << 0);
    if ((curPinc ^ cpu.prevPinC) & pcmsk1) pcifr |= (1 << 1);
    if ((curPind ^ cpu.prevPinD) & pcmsk2) pcifr |= (1 << 2);
    cpu.ram[IO.PCIFR] = pcifr;

    cpu.prevPinB = curPinb;
    cpu.prevPinC = curPinc;
    cpu.prevPinD = curPind;

    if (cpu.sreg.I === 1) {
        const eimsk = readRAM(IO.EIMSK);
        const pcicr = readRAM(IO.PCICR);
        const ucsrb = readRAM(IO.UCSR0B);
        const ucsra = readRAM(IO.UCSR0A);
        const acsr = readRAM(IO.ACSR);
        const adcsra = readRAM(IO.ADCSRA);

        if ((eimsk & 0x01) && (eifr & 0x01)) {
            if (isc0 !== 0) cpu.ram[IO.EIFR] &= ~0x01;
            dispatchInterrupt(VECTORS.INT0, '__vector_int0');
            return;
        }
        if ((eimsk & 0x02) && (eifr & 0x02)) {
            if (isc1 !== 0) cpu.ram[IO.EIFR] &= ~0x02;
            dispatchInterrupt(VECTORS.INT1, '__vector_int1');
            return;
        }
        if ((pcicr & 0x01) && (pcifr & 0x01)) {
            cpu.ram[IO.PCIFR] &= ~0x01;
            dispatchInterrupt(VECTORS.PCINT0, '__vector_pcint0');
            return;
        }
        if ((pcicr & 0x02) && (pcifr & 0x02)) {
            cpu.ram[IO.PCIFR] &= ~0x02;
            dispatchInterrupt(VECTORS.PCINT1, '__vector_pcint1');
            return;
        }
        if ((pcicr & 0x04) && (pcifr & 0x04)) {
            cpu.ram[IO.PCIFR] &= ~0x04;
            dispatchInterrupt(VECTORS.PCINT2, '__vector_pcint2');
            return;
        }
        if ((acsr & (1 << 3)) && (acsr & (1 << 4))) {
            cpu.ram[IO.ACSR] &= ~(1 << 4);
            dispatchInterrupt(VECTORS.ANALOG_COMP, '__vector_analog_comp');
            return;
        }
        if ((adcsra & (1 << 3)) && (adcsra & (1 << 4))) {
            cpu.ram[IO.ADCSRA] &= ~(1 << 4);
            dispatchInterrupt(VECTORS.ADC, '__vector_adc');
            return;
        }
        if ((ucsrb & (1 << 7)) && (ucsra & (1 << 7))) {
            dispatchInterrupt(VECTORS.USART_RX, '__vector_usart_rx');
            return;
        }
        if ((ucsrb & (1 << 5)) && (ucsra & (1 << 5))) {
            dispatchInterrupt(VECTORS.USART_UDRE, '__vector_usart_udre');
            return;
        }
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

/* ================= 16. ШАГ ВПЕРЁД И ШАГ НАЗАД CPU ================= */

function saveCpuSnapshot() {
    cpuHistory.push({
        r: new Uint8Array(cpu.r),
        prevR: new Uint8Array(cpu.prevR),
        ram: new Uint8Array(cpu.ram),
        pc: cpu.pc,
        sp: cpu.sp,
        sreg: { ...cpu.sreg },
        cycles: cpu.cycles,
        uartLog: cpu.uartLog,
        uartTxBusyCycles: cpu.uartTxBusyCycles,
        rxBuffer: [...cpu.rxBuffer],
        prevPinB: cpu.prevPinB,
        prevPinC: cpu.prevPinC,
        prevPinD: cpu.prevPinD,
        potVal: cpu.potVal,
        btnStates: vButtons.map(b => b.pressed),
        analyzerLen: analyzer.samples.length,
        lcd: { line1: lcdState.line1, line2: lcdState.line2 }
    });
    if (cpuHistory.length > MAX_CPU_HISTORY) {
        cpuHistory.shift();
    }
}

function cpuStepBack() {
    if (cpuHistory.length === 0) return;
    haltExecution();

    const snap = cpuHistory.pop();
    cpu.r.set(snap.r);
    cpu.prevR.set(snap.prevR);
    cpu.ram.set(snap.ram);
    cpu.pc = snap.pc;
    cpu.sp = snap.sp;
    cpu.sreg = { ...snap.sreg };
    cpu.cycles = snap.cycles;
    cpu.uartLog = snap.uartLog;
    cpu.uartTxBusyCycles = snap.uartTxBusyCycles;
    cpu.rxBuffer = [...snap.rxBuffer];
    cpu.prevPinB = snap.prevPinB;
    cpu.prevPinC = snap.prevPinC;
    cpu.prevPinD = snap.prevPinD;
    cpu.potVal = snap.potVal;
    lcdState.line1 = snap.lcd.line1;
    lcdState.line2 = snap.lcd.line2;

    vButtons.forEach((btn, idx) => {
        if (idx < snap.btnStates.length) {
            btn.pressed = snap.btnStates[idx];
            document.getElementById('vbtn_' + btn.id)?.classList.toggle('latched', btn.pressed);
        }
    });

    const potRange = document.getElementById('potRange');
    if (potRange) potRange.value = cpu.potVal;
    const potBadge = document.getElementById('potVoltageBadge');
    if (potBadge) potBadge.textContent = (cpu.potVal / 1023 * 5.0).toFixed(2) + ' V (ADC: ' + cpu.potVal + ')';

    const term = document.getElementById('uartTerminal');
    if (term) term.textContent = cpu.uartLog || 'UART готов к работе...';

    if (analyzer.samples.length > snap.analyzerLen) {
        analyzer.samples.length = snap.analyzerLen;
    }
    lastPinSampleHash = -1;

    syncHardwareState();
    scheduleAnalyzerDraw();
    updateUI();
}

function cpuStep(silent = false) {
    if (cpu.pc < 0) cpu.pc = 0;
    if (cpu.error) { haltExecution(); if (!silent) updateUI(); return; }

    if (cpu.program.length === 0) parseProgram(document.getElementById('asmCode').value);
    if (cpu.program.length === 0 || cpu.error || cpu.pc >= cpu.program.length) {
        haltExecution(); if (!silent) updateUI(); return;
    }

    const inst = cpu.program[cpu.pc];
    if (!inst) { haltExecution(); if (!silent) updateUI(); return; }

    const op = inst.op;
    if (op === 'break') { haltExecution(); if (!silent) updateUI(); return; }

    saveCpuSnapshot();

    cpu.prevR.set(cpu.r);
    let nextPC = cpu.pc + (isTwoWordInstruction(inst) ? 2 : 1);

    if (cpu.uartTxBusyCycles > 0) {
        cpu.uartTxBusyCycles--;
        if (cpu.uartTxBusyCycles === 0) {
            cpu.ram[IO.UCSR0A] |= (1 << 5);
            cpu.ram[IO.UCSR0A] |= (1 << 6);
        }
    }

    switch (op) {
        case 'ldi': { cpu.r[inst.rd] = inst.imm; break; }
        case 'mov': { cpu.r[inst.rd] = cpu.r[inst.rr]; break; }
        case 'in':  { cpu.r[inst.rd] = readRAM(inst.ioAddr); break; }
        case 'out': { writeRAM(inst.ioAddr, cpu.r[inst.rr]); break; }
        case 'lds': { cpu.r[inst.rd] = readRAM(inst.dataAddr); break; }
        case 'sts': { writeRAM(inst.dataAddr, cpu.r[inst.rr]); break; }

        case 'ld': {
            let addr = getPointerAddr(inst.args[1].replace('+', '').replace('-', ''));
            if (inst.args[1].includes('-')) { addr--; setPointerAddr(inst.args[1].replace('-', ''), addr); }
            cpu.r[inst.rd] = readRAM(addr);
            if (inst.args[1].includes('+')) setPointerAddr(inst.args[1].replace('+', ''), addr + 1);
            break;
        }
        case 'st': {
            let addr = getPointerAddr(inst.args[0].replace('+', '').replace('-', ''));
            if (inst.args[0].includes('-')) { addr--; setPointerAddr(inst.args[0].replace('-', ''), addr); }
            writeRAM(addr, cpu.r[inst.rr]);
            if (inst.args[0].includes('+')) setPointerAddr(inst.args[0].replace('+', ''), addr + 1);
            break;
        }
        case 'push': { pushStack(cpu.r[inst.rd]); break; }
        case 'pop':  { cpu.r[inst.rd] = popStack(); break; }
        case 'clr':  { cpu.r[inst.rd] = 0; setFlagsLogic(0); break; }
        case 'ser':  { cpu.r[inst.rd] = 0xFF; break; }

        case 'lpm': {
            const isPostInc = inst.args.length >= 2 && inst.args[1].includes('+');
            const zAddr = getPointerAddr('z');
            cpu.r[inst.rd] = cpu.flashBytes[zAddr] || 0;
            if (isPostInc) setPointerAddr('z', zAddr + 1);
            break;
        }

        case 'mul': {
            const res = (cpu.r[inst.rd] * cpu.r[inst.rr]) & 0xFFFF;
            cpu.r[0] = res & 0xFF; cpu.r[1] = (res >> 8) & 0xFF;
            cpu.sreg.C = ((res >> 15) & 1); cpu.sreg.Z = (res === 0) ? 1 : 0;
            break;
        }
        case 'muls': {
            const a = (cpu.r[inst.rd] << 24) >> 24;
            const b = (cpu.r[inst.rr] << 24) >> 24;
            const res = a * b;
            cpu.r[0] = res & 0xFF; cpu.r[1] = (res >> 8) & 0xFF;
            cpu.sreg.C = ((res >> 15) & 1) ? 1 : 0;
            cpu.sreg.Z = ((res & 0xFFFF) === 0) ? 1 : 0;
            break;
        }
        case 'mulsu': {
            const a = (cpu.r[inst.rd] << 24) >> 24;
            const res = a * cpu.r[inst.rr];
            cpu.r[0] = res & 0xFF; cpu.r[1] = (res >> 8) & 0xFF;
            cpu.sreg.C = ((res >> 15) & 1) ? 1 : 0;
            cpu.sreg.Z = ((res & 0xFFFF) === 0) ? 1 : 0;
            break;
        }

        case 'bst': { cpu.sreg.T = (cpu.r[inst.rd] >> inst.bit) & 1; break; }
        case 'bld': {
            if (cpu.sreg.T) cpu.r[inst.rd] |= (1 << inst.bit);
            else cpu.r[inst.rd] &= ~(1 << inst.bit);
            break;
        }
        case 'sbi': { writeRAM(inst.ioAddr, readRAM(inst.ioAddr) | (1 << inst.bit)); break; }
        case 'cbi': { writeRAM(inst.ioAddr, readRAM(inst.ioAddr) & ~(1 << inst.bit)); break; }
        case 'sbis': {
            if ((readRAM(inst.ioAddr) & (1 << inst.bit)) !== 0) nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            break;
        }
        case 'sbic': {
            if ((readRAM(inst.ioAddr) & (1 << inst.bit)) === 0) nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            break;
        }

        case 'sbrs': {
            if ((cpu.r[inst.rd] & (1 << inst.bit)) !== 0) {
                nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            }
            break;
        }
        case 'sbrc': {
            if ((cpu.r[inst.rd] & (1 << inst.bit)) === 0) {
                nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            }
            break;
        }

        case 'add': {
            const res = cpu.r[inst.rd] + cpu.r[inst.rr];
            setFlagsAdd(cpu.r[inst.rd], cpu.r[inst.rr], res);
            cpu.r[inst.rd] = res & 0xFF; break;
        }
        case 'adc': {
            const res = cpu.r[inst.rd] + cpu.r[inst.rr] + cpu.sreg.C;
            setFlagsAdd(cpu.r[inst.rd], cpu.r[inst.rr], res);
            cpu.r[inst.rd] = res & 0xFF; break;
        }
        case 'sub': {
            const res = cpu.r[inst.rd] - cpu.r[inst.rr];
            setFlagsSub(cpu.r[inst.rd], cpu.r[inst.rr], res);
            cpu.r[inst.rd] = res & 0xFF; break;
        }
        case 'subi': {
            const res = cpu.r[inst.rd] - inst.imm;
            setFlagsSub(cpu.r[inst.rd], inst.imm, res);
            cpu.r[inst.rd] = res & 0xFF; break;
        }
        case 'sbc': {
            const res = cpu.r[inst.rd] - cpu.r[inst.rr] - cpu.sreg.C;
            setFlagsSub(cpu.r[inst.rd], cpu.r[inst.rr], res, true);
            cpu.r[inst.rd] = res & 0xFF; break;
        }
        case 'sbci': {
            const res = cpu.r[inst.rd] - inst.imm - cpu.sreg.C;
            setFlagsSub(cpu.r[inst.rd], inst.imm, res, true);
            cpu.r[inst.rd] = res & 0xFF; break;
        }
        case 'inc': {
            const prev = cpu.r[inst.rd];
            const res = (prev + 1) & 0xFF;
            cpu.r[inst.rd] = res;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = (prev === 0x7F) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'dec': {
            const prev = cpu.r[inst.rd];
            const res = (prev - 1) & 0xFF;
            cpu.r[inst.rd] = res;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = (prev === 0x80) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'neg': {
            const val = cpu.r[inst.rd];
            const res = (0 - val) & 0xFF;
            cpu.sreg.H = ((res & 0x0F) > 0) ? 1 : 0;
            cpu.sreg.C = (res !== 0) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = (val === 0x80) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
            cpu.r[inst.rd] = res; break;
        }
        case 'com': {
            const res = (~cpu.r[inst.rd]) & 0xFF;
            cpu.r[inst.rd] = res; cpu.sreg.C = 1;
            setFlagsLogic(res); break;
        }
        case 'and': { cpu.r[inst.rd] &= cpu.r[inst.rr]; setFlagsLogic(cpu.r[inst.rd]); break; }
        case 'andi': { cpu.r[inst.rd] &= inst.imm; setFlagsLogic(cpu.r[inst.rd]); break; }
        case 'or': { cpu.r[inst.rd] |= cpu.r[inst.rr]; setFlagsLogic(cpu.r[inst.rd]); break; }
        case 'ori': { cpu.r[inst.rd] |= inst.imm; setFlagsLogic(cpu.r[inst.rd]); break; }
        case 'sbr': { cpu.r[inst.rd] |= inst.imm; setFlagsLogic(cpu.r[inst.rd]); break; }
        case 'cbr': { cpu.r[inst.rd] &= (~inst.imm) & 0xFF; setFlagsLogic(cpu.r[inst.rd]); break; }
        case 'eor': { cpu.r[inst.rd] ^= cpu.r[inst.rr]; setFlagsLogic(cpu.r[inst.rd]); break; }
        case 'tst': { setFlagsLogic(cpu.r[inst.rd]); break; }

        case 'lsl': {
            const prev = cpu.r[inst.rd];
            const res = (prev << 1) & 0xFF;
            cpu.r[inst.rd] = res;
            cpu.sreg.C = (prev & 0x80) ? 1 : 0; cpu.sreg.H = (prev & 0x08) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0; cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C; cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'lsr': {
            const prev = cpu.r[inst.rd];
            const res = prev >> 1;
            cpu.r[inst.rd] = res;
            cpu.sreg.C = (prev & 0x01) ? 1 : 0; cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = 0; cpu.sreg.V = cpu.sreg.C; cpu.sreg.S = cpu.sreg.V; break;
        }
        case 'asr': {
            const prev = cpu.r[inst.rd];
            const res = (prev >> 1) | (prev & 0x80);
            cpu.r[inst.rd] = res;
            cpu.sreg.C = (prev & 0x01) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
            break;
        }
        case 'rol': {
            const prev = cpu.r[inst.rd];
            const oldC = cpu.sreg.C;
            const res = ((prev << 1) | oldC) & 0xFF;
            cpu.r[inst.rd] = res;
            cpu.sreg.C = (prev & 0x80) ? 1 : 0;
            cpu.sreg.H = (prev & 0x08) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
            break;
        }
        case 'ror': {
            const prev = cpu.r[inst.rd];
            const oldC = cpu.sreg.C;
            const res = (prev >> 1) | (oldC << 7);
            cpu.r[inst.rd] = res;
            cpu.sreg.C = (prev & 0x01) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
            break;
        }
        case 'swap': {
            const val = cpu.r[inst.rd];
            cpu.r[inst.rd] = ((val & 0x0F) << 4) | ((val & 0xF0) >> 4);
            break;
        }
        case 'movw': {
            cpu.r[inst.rd] = cpu.r[inst.rr];
            cpu.r[inst.rd + 1] = cpu.r[inst.rr + 1];
            break;
        }
        case 'cpc': {
            const res = cpu.r[inst.rd] - cpu.r[inst.rr] - cpu.sreg.C;
            setFlagsSub(cpu.r[inst.rd], cpu.r[inst.rr], res, true);
            break;
        }
        case 'adiw': {
            const rLow = inst.rd;
            const k = inst.imm;
            const curVal = cpu.r[rLow] | (cpu.r[rLow + 1] << 8);
            const res = curVal + k;
            cpu.r[rLow] = res & 0xFF;
            cpu.r[rLow + 1] = (res >> 8) & 0xFF;
            cpu.sreg.Z = ((res & 0xFFFF) === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x8000) ? 1 : 0;
            cpu.sreg.V = (!((curVal >> 15) & 1) && ((res >> 15) & 1)) ? 1 : 0;
            cpu.sreg.C = (!((res >> 15) & 1) && ((curVal >> 15) & 1)) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
            break;
        }
        case 'sbiw': {
            const rLow = inst.rd;
            const k = inst.imm;
            const curVal = cpu.r[rLow] | (cpu.r[rLow + 1] << 8);
            const res = curVal - k;
            cpu.r[rLow] = res & 0xFF;
            cpu.r[rLow + 1] = (res >> 8) & 0xFF;
            cpu.sreg.Z = ((res & 0xFFFF) === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x8000) ? 1 : 0;
            cpu.sreg.V = (((curVal >> 15) & 1) && !((res >> 15) & 1)) ? 1 : 0;
            cpu.sreg.C = (((res >> 15) & 1) && !((curVal >> 15) & 1)) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
            break;
        }
        case 'cp': { setFlagsSub(cpu.r[inst.rd], cpu.r[inst.rr], cpu.r[inst.rd] - cpu.r[inst.rr]); break; }
        case 'cpi': { setFlagsSub(cpu.r[inst.rd], inst.imm, cpu.r[inst.rd] - inst.imm); break; }
        case 'cpse': {
            if (cpu.r[inst.rd] === cpu.r[inst.rr]) nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            break;
        }

        case 'jmp':
        case 'rjmp': {
            if (inst.targetPc !== -1) nextPC = inst.targetPc;
            else {
                const target = resolveLabel(inst.args[0], inst.lineNum);
                if (target !== null) nextPC = target;
            }
            break;
        }
        case 'call':
        case 'rcall': {
            const target = (inst.targetPc !== -1) ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum);
            if (target !== null) { pushStack(nextPC & 0xFF); pushStack((nextPC >> 8) & 0xFF); nextPC = target; }
            break;
        }
        case 'ret': { const high = popStack(); const low = popStack(); nextPC = (high << 8) | low; break; }
        case 'reti': { const high = popStack(); const low = popStack(); nextPC = (high << 8) | low; cpu.sreg.I = 1; break; }

        case 'breq': { if (cpu.sreg.Z === 1) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brne': { if (cpu.sreg.Z === 0) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brcs':
        case 'brlo': { if (cpu.sreg.C === 1) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brcc':
        case 'brsh': { if (cpu.sreg.C === 0) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brmi': { if (cpu.sreg.N === 1) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brpl': { if (cpu.sreg.N === 0) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brts': { if (cpu.sreg.T === 1) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brtc': { if (cpu.sreg.T === 0) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brge': { if ((cpu.sreg.N ^ cpu.sreg.V) === 0) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brlt': { if ((cpu.sreg.N ^ cpu.sreg.V) === 1) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brvs': { if (cpu.sreg.V === 1) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brvc': { if (cpu.sreg.V === 0) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brhs': { if (cpu.sreg.H === 1) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brhc': { if (cpu.sreg.H === 0) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brls': { if ((cpu.sreg.C | cpu.sreg.Z) === 1) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }
        case 'brhi': { if ((cpu.sreg.C | cpu.sreg.Z) === 0) nextPC = (inst.targetPc !== -1 ? inst.targetPc : resolveLabel(inst.args[0], inst.lineNum)) ?? nextPC; break; }

        case 'sec': { cpu.sreg.C = 1; break; }
        case 'clc': { cpu.sreg.C = 0; break; }
        case 'sez': { cpu.sreg.Z = 1; break; }
        case 'clz': { cpu.sreg.Z = 0; break; }
        case 'sen': { cpu.sreg.N = 1; break; }
        case 'cln': { cpu.sreg.N = 0; break; }
        case 'sev': { cpu.sreg.V = 1; break; }
        case 'clv': { cpu.sreg.V = 0; break; }
        case 'ses': { cpu.sreg.S = 1; break; }
        case 'cls': { cpu.sreg.S = 0; break; }
        case 'seh': { cpu.sreg.H = 1; break; }
        case 'clh': { cpu.sreg.H = 0; break; }
        case 'set': { cpu.sreg.T = 1; break; }
        case 'clt': { cpu.sreg.T = 0; break; }
        case 'sei': { cpu.sreg.I = 1; break; }
        case 'cli': { cpu.sreg.I = 0; break; }
        case 'sleep':
        case 'wdr':
        case '_word2':
        case 'nop':
            break;
    }

    cpu.pc = nextPC;
    cpu.cycles += CYCLES[op] || 1;

    applyHardwarePins();
    checkInterrupts();

    if (!silent) {
        syncHardwareState();
        recordAnalyzerSample(true);
        updateUI();
    }

    if (cpu.running && cpu.pc < cpu.program.length) {
        if (cpu.breakpoints.has(cpu.program[cpu.pc].lineNum)) {
            haltExecution();
            syncHardwareState();
            updateUI();
        }
    }
}

/* ================= 17. СИНХРОНИЗАЦИЯ ПЛАТЫ ================= */

function toggleVButton(id) {
    const btn = vButtons.find(b => b.id === id);
    if (!btn) return;

    if (btn.type === 'btn_mom') {
        btn.pressed = true;
        document.getElementById('vbtn_' + id)?.classList.add('latched');
        setTimeout(() => {
            btn.pressed = false;
            document.getElementById('vbtn_' + id)?.classList.remove('latched');
            syncHardwareState();
            checkInterrupts();
            recordAnalyzerSample(true);
            updateUI();
        }, 150);
    } else {
        btn.pressed = !btn.pressed;
        document.getElementById('vbtn_' + id)?.classList.toggle('latched', btn.pressed);
    }

    syncHardwareState();
    checkInterrupts();
    recordAnalyzerSample(true);
    updateUI();
}

function syncHardwareState() {
    applyHardwarePins();

    writeRAM(IO.SPL, cpu.sp & 0xFF);
    writeRAM(IO.SPH, (cpu.sp >> 8) & 0xFF);

    let sregByte = 0;
    const flags = ['C','Z','N','V','S','H','T','I'];
    for (let i = 0; i < 8; i++) {
        if (cpu.sreg[flags[i]]) sregByte |= (1 << i);
    }
    cpu.ram[IO.SREG] = sregByte;

    cpu.ram.set(cpu.r.subarray(0, 32), 0);

    syncAnalogHardware();
    updateLcdHardware();
}

function selectLedPort(portLetter) {
    cpu.selectedPort = portLetter;
    document.querySelectorAll('#cardLedBar .port-btn').forEach(btn => btn.classList.remove('active'));
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

    customIoComponents.forEach(c => {
        if (c.type === 'led') {
            const pVal = readRAM(IO['PORT' + c.port]);
            const ledEl = document.getElementById('led_' + c.id);
            if (ledEl) {
                ledEl.className = 'led-light ' + ((pVal & (1 << c.pin)) ? 'active-led-green' : '');
            }
        }
    });

    renderExtraPins();
    renderLcdScreen();
}

/* ================= 18. ТЕКСТОВЫЙ ДИСПЛЕЙ LCD 1602 ================= */

const lcdState = {
    line1: "AVR Studio 1602 ",
    line2: "Ready to work!  "
};

function updateLcdHardware() {
    if (cpu.uartLog.length > 0) {
        const clean = cpu.uartLog.replace(/[\r\n]+/g, ' ');
        lcdState.line1 = (clean.substring(0, 16)).padEnd(16, ' ');
        lcdState.line2 = (clean.substring(16, 32)).padEnd(16, ' ');
    }
}

function renderLcdScreen() {
    const l1 = document.getElementById('lcdLine1');
    const l2 = document.getElementById('lcdLine2');
    if (l1 && l2) {
        l1.textContent = lcdState.line1;
        l2.textContent = lcdState.line2;
    }
}

function clearLcd() {
    lcdState.line1 = "                ";
    lcdState.line2 = "                ";
    renderLcdScreen();
}

/* ================= 19. UART И WEB SERIAL ================= */

function appendUartTerminal(char) {
    const term = document.getElementById('uartTerminal');
    if (term) {
        term.textContent = cpu.uartLog || "UART готов к работе...";
        term.scrollTop = term.scrollHeight;
    }
}

function clearUart() {
    cpu.uartLog = "";
    const term = document.getElementById('uartTerminal');
    if (term) term.textContent = "UART очищен.";
    clearLcd();
}

function sendUartInput() {
    const inp = document.getElementById('serialInput');
    if (!inp || !inp.value) return;
    const text = inp.value;
    inp.value = '';

    for (let i = 0; i < text.length; i++) cpu.rxBuffer.push(text.charCodeAt(i));
    cpu.ram[IO.UCSR0A] |= (1 << 7);
    checkInterrupts();
    updateUI();
}

window._serialPort = null;

async function connectRealWebSerial() {
    const btn = document.getElementById('btnWebSerial');
    if (!('serial' in navigator)) {
        alert('Web Serial API не поддерживается данным браузером. Используйте Chrome, Edge или Opera.');
        return;
    }

    try {
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        window._serialPort = port;

        await port.setSignals({ dataTerminalReady: false });
        await new Promise(r => setTimeout(r, 50));
        await port.setSignals({ dataTerminalReady: true });
        await new Promise(r => setTimeout(r, 50));
        await port.setSignals({ dataTerminalReady: false });

        if (btn) {
            btn.classList.add('connected');
            btn.textContent = '🟢 COM Подключен';
        }

        const reader = port.readable.getReader();
        (async () => {
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) {
                        for (let byte of value) cpu.rxBuffer.push(byte);
                        cpu.ram[IO.UCSR0A] |= (1 << 7);
                        checkInterrupts();
                        updateUI();
                    }
                }
            } catch (e) {
                console.warn('Web Serial закрыт:', e);
            } finally {
                reader.releaseLock();
            }
        })();

    } catch (err) {
        alert('Ошибка подключения COM-порта: ' + err.message);
        if (btn) {
            btn.classList.remove('connected');
            btn.textContent = '🌐 COM';
        }
    }
}

/* ================= 20. RUNLOOP, СКОРОСТЬ И МЕНЮ ФАЙЛОВ ================= */

function haltExecution() {
    cpu.running = false;
    clearTimeout(cpu.timer);
    document.getElementById('btnRun')?.classList.remove('running');
    const rIcon = document.getElementById('runIcon');
    const rText = document.getElementById('runText');
    if (rIcon) rIcon.textContent = '▶';
    if (rText) rText.textContent = 'Пуск';
}

function toggleRun() {
    if (cpu.error) return;
    if (cpu.pc >= cpu.program.length) cpu.pc = 0;

    cpu.running = !cpu.running;
    const btn = document.getElementById('btnRun');
    if (cpu.running) {
        btn?.classList.add('running');
        const rIcon = document.getElementById('runIcon');
        const rText = document.getElementById('runText');
        if (rIcon) rIcon.textContent = '⏸';
        if (rText) rText.textContent = 'Пауза';
        runLoop();
    } else {
        haltExecution();
    }
}

let lastUiRenderTime = 0;

function runLoop() {
    if (!cpu.running) return;

    let delay = 16;
    let batchSize = 1;

    if (cpu.speed <= 50) {
        delay = Math.max(16, Math.floor(1000 / cpu.speed));
        batchSize = 1;
    } else {
        delay = 16;
        batchSize = Math.min(500, Math.max(1, Math.round(cpu.speed / 25)));
    }

    for (let i = 0; i < batchSize; i++) {
        cpuStep(true);
        if (!cpu.running || cpu.error) {
            haltExecution();
            break;
        }
    }

    syncHardwareState();
    recordAnalyzerSample(true);

    const now = performance.now();
    if (now - lastUiRenderTime >= 30 || !cpu.running) {
        lastUiRenderTime = now;
        updateUI();
    }

    if (cpu.running) cpu.timer = setTimeout(runLoop, delay);
}

function cpuReset() {
    haltExecution();
    cpuHistory = [];
    cpu.r.fill(0);
    cpu.prevR.fill(0);
    cpu.ram.fill(0);
    cpu.pc = 0;
    cpu.sp = 0x08FF;
    cpu.cycles = 0;
    cpu.sreg = { C:0, Z:0, N:0, V:0, S:0, H:0, T:0, I:0 };
    cpu.rxBuffer = [];
    cpu.uartLog = "";
    cpu.uartTxBusyCycles = 0;

    cpu.prevPinB = 0xFF;
    cpu.prevPinC = 0xFF;
    cpu.prevPinD = 0xFF;

    cpu.ram[IO.UCSR0A] = (1 << 5);

    vButtons.forEach(btn => {
        btn.pressed = false;
        document.getElementById('vbtn_' + btn.id)?.classList.remove('latched');
    });

    parseProgram(document.getElementById('asmCode').value);
    syncHardwareState();
    clearAnalyzer();
    clearLcd();
    updateUI();
}

function updateSpeed(val) {
    const num = Math.min(10000, Math.max(1, parseInt(val, 10) || 40));
    cpu.speed = num;
    const sInp = document.getElementById('speedInput');
    if (sInp) sInp.value = num;
}

function updateSpeedManual(val) {
    if (val === '') return;
    const parsed = parseInt(val, 10);
    if (isNaN(parsed)) return;
    const num = Math.min(10000, Math.max(1, parsed));
    cpu.speed = num;
    const sRange = document.getElementById('speedRange');
    if (sRange) sRange.value = Math.min(400, num);
}

function normalizeSpeedInput(inp) {
    const num = Math.min(10000, Math.max(1, parseInt(inp.value, 10) || 40));
    inp.value = num;
    cpu.speed = num;
    const sRange = document.getElementById('speedRange');
    if (sRange) sRange.value = Math.min(400, num);
}

function handleFileAction(selectEl) {
    if (!selectEl) return;
    const action = selectEl.value;
    selectEl.selectedIndex = 0;
    if (action === 'open') {
        document.getElementById('fileInput')?.click();
    } else if (action === 'save') {
        saveCodeToFile();
    } else if (action === 'hex') {
        exportIntelHex();
    }
}

/* ================= 21. ДАМПЫ ПАМЯТИ ================= */

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
    if (!memBox || !activePanels.cpu) return;

    let output = '';
    if (cpu.memView === 'ram') {
        for (let addr = 0x0100; addr <= 0x01F8; addr += 8) {
            let bytes = [];
            for (let b = 0; b < 8; b++) {
                let val = readRAM(addr + b);
                bytes.push(cpu.memFormat === 'dec' ? val.toString(10).padStart(3, '0') : val.toString(16).padStart(2, '0').toUpperCase());
            }
            output += '0x' + addr.toString(16).toUpperCase() + ':  ' + bytes.join('  ') + '\n';
        }
    } else if (cpu.memView === 'stack') {
        for (let addr = 0x08C0; addr <= 0x08F8; addr += 8) {
            let bytes = [];
            for (let b = 0; b < 8; b++) {
                const isSP = ((addr + b) === cpu.sp);
                let val = readRAM(addr + b);
                let valStr = cpu.memFormat === 'dec' ? val.toString(10).padStart(3, '0') : val.toString(16).padStart(2, '0').toUpperCase();
                bytes.push(isSP ? ('[' + valStr + ']') : (' ' + valStr + ' '));
            }
            output += '0x' + addr.toString(16).toUpperCase() + ': ' + bytes.join(' ') + '\n';
        }
    } else if (cpu.memView === 'flash') {
        for (let addr = 0x0000; addr <= 0x00A0; addr += 8) {
            let bytes = [];
            for (let b = 0; b < 8; b++) {
                let val = cpu.flashBytes[addr + b] || 0;
                bytes.push(cpu.memFormat === 'dec' ? val.toString(10).padStart(3, '0') : val.toString(16).padStart(2, '0').toUpperCase());
            }
            output += '0x' + addr.toString(16).padStart(4, '0').toUpperCase() + ':  ' + bytes.join('  ') + '\n';
        }
    } else if (cpu.memView === 'eeprom') {
        for (let addr = 0x0000; addr <= 0x0078; addr += 8) {
            let bytes = [];
            for (let b = 0; b < 8; b++) {
                let val = cpu.eeprom[addr + b] || 0;
                bytes.push(cpu.memFormat === 'dec' ? val.toString(10).padStart(3, '0') : val.toString(16).padStart(2, '0').toUpperCase());
            }
            output += '0x' + addr.toString(16).padStart(4, '0').toUpperCase() + ':  ' + bytes.join('  ') + '\n';
        }
    }

    memBox.textContent = output;
}

/* ================= 22. ОБНОВЛЕНИЕ UI ================= */

function initRegistersDom() {
    const rGrid = document.getElementById('registersGrid');
    if (!rGrid) return;
    let html = '';
    for (let i = 0; i < 32; i++) {
        html += `<div class="reg-cell" id="regCell_${i}">` +
                `<span class="reg-name">R${i}</span>` +
                `<span class="reg-val-hex" id="regHex_${i}">0x00</span>` +
                `<span class="reg-val-dec" id="regDec_${i}">(0)</span></div>`;
    }
    rGrid.innerHTML = html;
}

function updateUI() {
    const cycleElem = document.getElementById('cycleCounter');
    if (cycleElem) cycleElem.textContent = 'Такты: ' + cpu.cycles;

    const btnBack = document.getElementById('btnStepBack');
    if (btnBack) btnBack.disabled = (cpuHistory.length === 0);

    const statusElem = document.getElementById('compilerStatus');
    if (statusElem) {
        if (cpu.error) {
            statusElem.textContent = '❌ ' + cpu.error;
            statusElem.parentElement.classList.add('has-error-text');
        } else {
            statusElem.textContent = 'Строка: ' + (cpu.program[cpu.pc]?.lineNum || 'END');
            statusElem.parentElement.classList.remove('has-error-text');
        }
    }

    if (activePanels.cpu) {
        const valPcEl = document.getElementById('valPC');
        const valSpEl = document.getElementById('valSP');
        const valXEl = document.getElementById('valX');
        const valYEl = document.getElementById('valY');
        const valZEl = document.getElementById('valZ');

        if (valPcEl) valPcEl.textContent = '0x' + cpu.pc.toString(16).padStart(4, '0').toUpperCase();
        if (valSpEl) valSpEl.textContent = '0x' + cpu.sp.toString(16).padStart(4, '0').toUpperCase();
        if (valXEl) valXEl.textContent = '0x' + getPointerAddr('x').toString(16).padStart(4, '0').toUpperCase();
        if (valYEl) valYEl.textContent = '0x' + getPointerAddr('y').toString(16).padStart(4, '0').toUpperCase();
        if (valZEl) valZEl.textContent = '0x' + getPointerAddr('z').toString(16).padStart(4, '0').toUpperCase();

        const fGrid = document.getElementById('flagsGrid');
        if (fGrid) {
            fGrid.innerHTML = ['I','T','H','S','V','N','Z','C'].map(f => 
                '<div class="flag-cell ' + (cpu.sreg[f] ? 'flag-on' : '') + '"><span>' + f + '</span><b>' + cpu.sreg[f] + '</b></div>'
            ).join('');
        }

        for (let i = 0; i < 32; i++) {
            if (cpu.r[i] !== cpu.prevR[i] || cpu.cycles === 0) {
                const hexEl = document.getElementById(`regHex_${i}`);
                const decEl = document.getElementById(`regDec_${i}`);
                const cellEl = document.getElementById(`regCell_${i}`);
                if (hexEl && decEl && cellEl) {
                    hexEl.textContent = '0x' + cpu.r[i].toString(16).padStart(2, '0').toUpperCase();
                    decEl.textContent = '(' + cpu.r[i] + ')';
                    cellEl.classList.toggle('changed', cpu.r[i] !== cpu.prevR[i]);
                }
            }
        }

        renderMemoryDumps();
    }

    if (activePanels.board) renderHardware();
    if (activePanels.tools) renderToolsTab();

    updateGutterPcArrow();
}

/* ================= 23. ИНСТРУМЕНТЫ: УМНЫЙ WATCH И ИНСПЕКТОР ================= */

function rebuildAsmInspector() {
    const box = document.getElementById('asmInspectorCode');
    if (!box) return;

    if (currentLang !== 'c') {
        box.innerHTML = '<div style="color:var(--text-muted); padding:10px;">Инспектор доступен в режиме Си (C).<br>Переключите язык редактора на C.</div>';
        inspectorNeedsRebuild = false;
        return;
    }

    let out = '';
    for (let i = 0; i < cpu.program.length; i++) {
        const inst = cpu.program[i];
        if (!inst || inst.op === '_word2') continue;
        const lineText = inst.raw || (inst.op + ' ' + (inst.args ? inst.args.join(', ') : ''));
        const highlighted = highlightCode(lineText);

        out += `<div class="inspector-row" id="inspRow_${i}">` +
               `<span class="inspector-pc-arrow" id="inspArrow_${i}"></span>` +
               `<span class="inspector-addr">${i.toString(16).padStart(4, '0').toUpperCase()}:</span>` +
               `<span class="inspector-code-text">${highlighted}</span>` +
               `</div>`;
    }
    box.innerHTML = out || '<div style="color:var(--text-muted); padding:10px;">Код пуст...</div>';
    inspectorNeedsRebuild = false;
    lastInspectorPc = -1;
}

function updateAsmInspectorCursor() {
    if (currentLang !== 'c' || !activePanels.tools) return;
    if (inspectorNeedsRebuild) {
        rebuildAsmInspector();
    }
    if (lastInspectorPc === cpu.pc) return;

    if (lastInspectorPc !== -1) {
        const prevRow = document.getElementById(`inspRow_${lastInspectorPc}`);
        const prevArrow = document.getElementById(`inspArrow_${lastInspectorPc}`);
        if (prevRow) prevRow.classList.remove('is-current-pc');
        if (prevArrow) prevArrow.textContent = '';
    }

    const curRow = document.getElementById(`inspRow_${cpu.pc}`);
    const curArrow = document.getElementById(`inspArrow_${cpu.pc}`);
    if (curRow) {
        curRow.classList.add('is-current-pc');
        curRow.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
    if (curArrow) curArrow.textContent = '▶';
    lastInspectorPc = cpu.pc;
}

function renderToolsTab() {
    if (inspectorNeedsRebuild) rebuildAsmInspector();
    updateAsmInspectorCursor();
    renderWatchTable();
}

function renderWatchTable() {
    const tbody = document.getElementById('watchTableBody');
    const countBadge = document.getElementById('watchVarsCount');
    if (!tbody || !activePanels.tools) return;

    let html = '';

    if (cpu.symbols && cpu.symbols.length > 0) {
        if (countBadge) countBadge.textContent = 'Переменных: ' + cpu.symbols.length;
        cpu.symbols.forEach(sym => {
            let val = 0;
            let is16 = false;
            if (sym.locType === 'reg') {
                if (sym.location.includes(':')) {
                    const [loReg, hiReg] = sym.location.split(':');
                    val = cpu.r[parseReg(loReg)] | (cpu.r[parseReg(hiReg)] << 8);
                    is16 = true;
                } else {
                    val = cpu.r[parseReg(sym.location)];
                }
            } else if (sym.locType === 'sram') {
                val = readRAM(parseInt(sym.location, 16) || 0x0100);
            }
            const sVal = is16 ? ((val & 0x8000) ? (val - 65536) : val) : ((val & 0x80) ? (val - 256) : val);
            const hexPad = is16 ? 4 : 2;
            const binPad = is16 ? 16 : 8;

            html += '<tr>';
            html += '<td><b>' + sym.name + '</b></td>';
            html += '<td><span class="watch-type-badge">' + sym.type + '</span></td>';
            html += '<td>' + sVal + ' (DEC)</td>';
            html += '<td>0x' + val.toString(16).padStart(hexPad, '0').toUpperCase() + '</td>';
            html += '<td>0b' + val.toString(2).padStart(binPad, '0') + '</td>';
            html += '<td><span class="watch-loc-badge">' + sym.location + '</span></td>';
            html += '</tr>';
        });
    } else {
        if (countBadge) countBadge.textContent = 'Регистры: R16..R24';
        for (let i = 16; i <= 24; i++) {
            const val = cpu.r[i];
            const sVal = (val & 0x80) ? (val - 256) : val;
            html += '<tr>';
            html += '<td><b>R' + i + '</b></td>';
            html += '<td><span class="watch-type-badge">reg</span></td>';
            html += '<td>' + sVal + ' (DEC)</td>';
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

function saveCodeToFile() {
    const code = document.getElementById('asmCode').value;
    const ext = currentLang === 'c' ? '.c' : '.asm';
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'program' + ext;
    a.click();
}

function decodeSmartText(buffer) {
    const bytes = new Uint8Array(buffer);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) {
        try { return new TextDecoder('windows-1251').decode(bytes); }
        catch (e2) { return new TextDecoder('utf-8').decode(bytes); }
    }
}

function loadCodeFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        let text = decodeSmartText(e.target.result);
        if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const isC = /\.(c|h)$/i.test(file.name);
        switchLanguageTab(isC ? 'c' : 'asm');
        const ta = document.getElementById('asmCode');
        ta.value = text;
        if (isC) cachedUserCCode = text;
        updateSyntax();
        cpuReset();
        event.target.value = '';
    };
    reader.readAsArrayBuffer(file);
}

/* ================= 24. ПОДСВЕТКА И ГУТТЕР ================= */

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
                .replace(/\b(unsigned\s+char|uint8_t|int8_t|uint16_t|int16_t|uint32_t|int|char|void)\b/g, '<span class="syn-type">$1</span>')
                .replace(/\b(while|for|if|else|return|break|ISR)\b/g, '<span class="syn-kw">$1</span>')
                .replace(/(#define|#include)/g, '<span class="syn-dir">$1</span>')
                .replace(/\b(DDR[BCD]|PORT[BCD]|PIN[BCD]|ACSR|ADMUX|ADCSRA|ADCH|ADCL|UDR0|EICRA|EIMSK|PCICR|PCMSK[0-2]|UCSR0[ABC]|UBRR0[LH]|_delay_ms)\b/g, '<span class="syn-op">$1</span>')
                .replace(/\b(\$[0-9a-fA-F]+|0x[0-9a-fA-F]+|0b[01]+|-?\d+)\b/g, '<span class="syn-num">$1</span>');

            return p + (comment ? '<span class="syn-com">' + escapeHtml(comment) + '</span>' : '');
        }).join('\n');
    }

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

    txtArea.readOnly = false;
    if (lang === 'c') {
        document.getElementById('editorTitle').textContent = '⚡ Редактор (C)';
        if (cachedUserCCode) txtArea.value = cachedUserCCode;
    } else {
        document.getElementById('editorTitle').textContent = '📝 Редактор (.asm)';
    }

    updateSyntax();
    cpuReset();
}

function toggleBreakpoint(lineNum) {
    if (cpu.breakpoints.has(lineNum)) cpu.breakpoints.delete(lineNum);
    else cpu.breakpoints.add(lineNum);
    renderGutter();
}

function setPcToLine(targetLine) {
    if (cpu.program.length === 0) parseProgram(document.getElementById('asmCode').value);
    if (cpu.program.length === 0) return;

    haltExecution();
    let targetIdx = -1;
    for (let i = 0; i < cpu.program.length; i++) {
        if (cpu.program[i]?.lineNum >= targetLine) { targetIdx = i; break; }
    }
    if (targetIdx === -1) targetIdx = cpu.program.length;
    cpu.pc = targetIdx;
    updateUI();
}

let lastActivePcLine = -1;

function updateGutterPcArrow() {
    const curLineNum = cpu.program[cpu.pc]?.lineNum || -1;
    if (curLineNum === lastActivePcLine) return;

    if (lastActivePcLine !== -1) {
        const prevRow = document.getElementById(`gutterRow_${lastActivePcLine}`);
        const prevArrow = document.getElementById(`gutterArrow_${lastActivePcLine}`);
        if (prevRow) prevRow.classList.remove('is-pc');
        if (prevArrow) prevArrow.textContent = '';
    }

    if (curLineNum !== -1) {
        const curRow = document.getElementById(`gutterRow_${curLineNum}`);
        const curArrow = document.getElementById(`gutterArrow_${curLineNum}`);
        if (curRow) curRow.classList.add('is-pc');
        if (curArrow) curArrow.textContent = '▶';
    }
    lastActivePcLine = curLineNum;
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
        const hasBp = cpu.breakpoints.has(i);
        const hasErr = cpu.syntaxErrors.has(i);
        const errTitle = hasErr ? ('Ошибка: ' + cpu.syntaxErrors.get(i)) : 'Клик: точка останова | Двойной клик: PC сюда';

        html += `<div class="gutter-row ${hasBp ? 'has-bp' : ''} ${hasErr ? 'has-error' : ''} ${isCurrentPC ? 'is-pc' : ''}" id="gutterRow_${i}"` +
                ` onclick="toggleBreakpoint(${i})" ondblclick="setPcToLine(${i})" title="${errTitle}">` +
                `<span class="bp-marker"></span>` +
                `<span class="pc-arrow" id="gutterArrow_${i}">${isCurrentPC ? '▶' : ''}</span>` +
                `<span class="gutter-num">${i}</span></div>`;
    }
    gutter.innerHTML = html;
    lastActivePcLine = curLineNum;
}

function clearEditor() {
    document.getElementById('asmCode').value = '';
    document.getElementById('hintBanner').style.display = 'none';
    cpu.breakpoints.clear();
    cpu.syntaxErrors.clear();
    cachedUserCCode = '';
    updateSyntax();
    cpuReset();
}

/* ================= 25. ШАБЛОНЫ ПРОГРАММ ================= */

const PROGRAMS = {
    tpl_asm: {
        hint: "Базовый шаблон <b>AVR Assembler</b>: мигание встроенным светодиодом <b>L (PB5)</b>.",
        lang: "asm",
        code: `; Шаблон программы на AVR Assembler (ATmega328P)
.include "m328pdef.inc"

.org 0x0000
    rjmp start

start:
    ldi r16, 0x20       ; PB5 (светодиод L) на выход
    out DDRB, r16

loop:
    sbi PORTB, 5        ; Включить светодиод L
    cbi PORTB, 5        ; Выключить светодиод L
    rjmp loop`
    },

    tpl_c: {
        hint: "Базовый шаблон <b>C (avr-gcc)</b>: переключение встроенного светодиода <b>L (PB5)</b>.",
        lang: "c",
        code: `// Шаблон программы на Си (avr-gcc, ATmega328P)
#define F_CPU 16000000UL
#include <avr/io.h>

int main(void)
{
    DDRB |= (1 << PB5);      // PB5 (светодиод L) на выход

    while (1)
    {
        PORTB ^= (1 << PB5); // Переключить светодиод L
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

/* ================= 26. ИНИЦИАЛИЗАЦИЯ И СТАРТ ================= */

document.addEventListener('DOMContentLoaded', () => {
    const txtArea = document.getElementById('asmCode');
    const highlighting = document.getElementById('highlighting');
    const ghostOverlay = document.getElementById('ghostOverlay');
    const gutter = document.getElementById('lineGutter');

    function syncEditorScroll() {
        highlighting.scrollTop = txtArea.scrollTop;
        highlighting.scrollLeft = txtArea.scrollLeft;
        if (ghostOverlay) {
            ghostOverlay.scrollTop = txtArea.scrollTop;
            ghostOverlay.scrollLeft = txtArea.scrollLeft;
        }
        gutter.scrollTop = txtArea.scrollTop;
    }

    let inputDebounce = null;
    function scheduleCompileAfterEdit() {
        updateSyntax();
        updateGhostAutocomplete();
        requestAnimationFrame(syncEditorScroll);
        clearTimeout(inputDebounce);
        inputDebounce = setTimeout(() => cpuReset(), 150);
    }

    txtArea.addEventListener('input', () => {
        clearTimeout(inputDebounce);
        inputDebounce = setTimeout(() => {
            const val = txtArea.value;
            if (val.includes('#include') || val.includes('int main') || val.includes('ISR(')) {
                if (currentLang !== 'c') {
                    currentLang = 'c';
                    document.getElementById('btnLangAsm')?.classList.remove('active');
                    document.getElementById('btnLangC')?.classList.add('active');
                    document.getElementById('editorTitle').textContent = '⚡ Редактор (C)';
                }
            } else if (val.includes('.include') || val.includes('.org') || val.includes('.cseg')) {
                if (currentLang !== 'asm') {
                    currentLang = 'asm';
                    document.getElementById('btnLangAsm')?.classList.add('active');
                    document.getElementById('btnLangC')?.classList.remove('active');
                    document.getElementById('editorTitle').textContent = '📝 Редактор (.asm)';
                }
            }

            updateSyntax();
            updateGhostAutocomplete();
            cpuReset();
        }, 120);
    });

    txtArea.addEventListener('scroll', syncEditorScroll);

    txtArea.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            if (currentGhostSuggestion) {
                applyGhostCompletion();
            } else {
                const start = txtArea.selectionStart;
                const end = txtArea.selectionEnd;
                txtArea.value = txtArea.value.substring(0, start) + '    ' + txtArea.value.substring(end);
                txtArea.selectionStart = txtArea.selectionEnd = start + 4;
                scheduleCompileAfterEdit();
            }
            return;
        }

        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            const start = txtArea.selectionStart;
            const end = txtArea.selectionEnd;
            const val = txtArea.value;

            const lineStart = val.lastIndexOf('\n', start - 1) + 1;
            const lineBefore = val.substring(lineStart, start);
            const baseIndent = (lineBefore.match(/^([ \t]*)/) || ['', ''])[1];
            const indentUnit = baseIndent.includes('\t') ? '\t' : '    ';
            const trimmedBefore = lineBefore.trimEnd();
            const opensBrace = trimmedBefore.endsWith('{');
            const charAfter = val[end] || '';

            let insertText = '\n' + baseIndent + (opensBrace ? indentUnit : '');
            let nextCursorPos = start + 1 + baseIndent.length + (opensBrace ? indentUnit.length : 0);

            if (opensBrace && charAfter === '}') {
                insertText += '\n' + baseIndent;
            }

            txtArea.value = val.substring(0, start) + insertText + val.substring(end);
            txtArea.selectionStart = txtArea.selectionEnd = nextCursorPos;
            scheduleCompileAfterEdit();
            return;
        }

        if (e.key === '}' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const start = txtArea.selectionStart;
            const end = txtArea.selectionEnd;
            if (start === end) {
                const val = txtArea.value;
                const lineStart = val.lastIndexOf('\n', start - 1) + 1;
                const lineBefore = val.substring(lineStart, start);
                if (/^[ \t]+$/.test(lineBefore)) {
                    e.preventDefault();
                    let dedented = lineBefore;
                    if (dedented.endsWith('\t')) dedented = dedented.slice(0, -1);
                    else if (dedented.endsWith('    ')) dedented = dedented.slice(0, -4);
                    else dedented = '';

                    txtArea.value = val.substring(0, lineStart) + dedented + '}' + val.substring(end);
                    txtArea.selectionStart = txtArea.selectionEnd = lineStart + dedented.length + 1;
                    scheduleCompileAfterEdit();
                }
            }
        }
    });

    txtArea.addEventListener('keyup', (e) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
            updateGhostAutocomplete();
        }
    });

    txtArea.addEventListener('click', () => updateGhostAutocomplete());

    txtArea.addEventListener('blur', () => {
        currentGhostSuggestion = '';
        if (ghostOverlay) ghostOverlay.innerHTML = '';
    });

    window.addEventListener('resize', () => {
        syncPanelResizers();
        resizeAnalyzerCanvas();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'F5') { e.preventDefault(); toggleRun(); }
        if (e.key === 'F11') {
            e.preventDefault();
            if (e.shiftKey) cpuStepBack();
            else cpuStep();
        }
        if (e.key === 'F9') {
            e.preventDefault();
            toggleBreakpoint(txtArea.value.substring(0, txtArea.selectionStart).split('\n').length);
        }
    });

    if (localStorage.getItem('avr_theme') === 'light') {
        document.body.classList.add('theme-light');
        const txt = document.getElementById('btnThemeText');
        if (txt) txt.textContent = 'Темная';
    }

    initRegistersDom();
    initDragAndDrop();

    if (window.innerWidth <= 900) {
        togglePanel('editor');
    } else {
        PANEL_LIST.forEach(name => {
            document.getElementById('panel_' + name)?.classList.toggle('panel-hidden', !activePanels[name]);
            document.getElementById('tabBtn_' + name)?.classList.toggle('active', activePanels[name]);
        });
    }
    syncPanelResizers();

    applyAppZoom();
    renderChannelSelector();
    loadSelectedExample();
    syncAnalogHardware();

    setTimeout(resizeAnalyzerCanvas, 100);
});