/* =========================================================
   ЯДРО ЭМУЛЯТОРА AVR ATmega328P + SALEAE LOGIC (ПОЛНЫЙ КОД)
   ========================================================= */

const IO = {
    PINB:   0x23, DDRB:   0x24, PORTB:  0x25,
    PINC:   0x26, DDRC:   0x27, PORTC:  0x28,
    PIND:   0x29, DDRD:   0x2A, PORTD:  0x2B,
    EECR:   0x3F, EEDR:   0x40, EEARL:  0x41, EEARH: 0x42, // EEPROM
    TCCR0A: 0x44, TCCR0B: 0x45, TCNT0:  0x46, OCR0A: 0x47, OCR0B: 0x48, // Таймер/ШИМ
    PCIFR:  0x3B, EIFR:   0x3C, EIMSK:  0x3D,
    SPL:    0x5D, SPH:    0x5E, SREG:   0x5F,
    ACSR:   0x50, // Компаратор (Тема 7)
    PCICR:  0x68, EICRA:  0x69,
    PCMSK0: 0x6B, PCMSK1: 0x6C, PCMSK2: 0x6D,
    ADCL:   0x78, ADCH:   0x79, // АЦП (Тема 7)
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
    ANALOG_COMP: 0x0028,
    ADC:         0x002A,
    USART_RX:    0x0024,
    USART_UDRE:  0x0026,
    USART_TX:    0x0028
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

let currentLang = 'asm';
let currentFontSize = 14;
const PANEL_LIST = ['editor', 'board', 'analyzer', 'cpu'];

const activePanels = {
    editor: true,
    board: true,
    analyzer: true,
    cpu: true
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
    breakpoints: new Set(),
    syntaxErrors: new Map(),
    rxBuffer: [],
    uartLog: "",
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

/* ================= 1. НАВИГАЦИЯ ================= */

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
    document.getElementById('viewUartConsole').style.display = isUart ? 'block' : 'none';
    document.getElementById('viewExtraPins').style.display = isUart ? 'none' : 'block';
    if (!isUart) renderExtraPins();
}

/* ================= 2. ДЕБАГГЕР: АНАЛИЗ ОШИБОК И СКОБОК ================= */

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

    if (lang === 'c') {
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            const cIdx = line.indexOf('//');
            if (cIdx !== -1) line = line.substring(0, cIdx);
            line = line.trim();
            if (!line || line.startsWith('#') || line.startsWith('ISR') || line.includes('main(')) continue;
            if (line.endsWith('{') || line.endsWith('}') || line.startsWith('{') || line.startsWith('}') || line.startsWith('if') || line.startsWith('else') || line.startsWith('while')) continue;

            if (!line.endsWith(';')) {
                cpu.syntaxErrors.set(i + 1, "Пропущена точка с запятой ';' в конце строки");
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

/* ================= 3. АВТОДОПОЛНЕНИЕ GHOST TEXT ================= */

const COMMON_REGISTERS = [
    'PORTB', 'PORTC', 'PORTD', 'DDRB', 'DDRC', 'DDRD', 'PINB', 'PINC', 'PIND',
    'ACSR', 'ADMUX', 'ADCSRA', 'ADCSRB', 'ADCH', 'ADCL', 'DIDR0', 'DIDR1',
    'UDR0', 'UCSR0A', 'UCSR0B', 'UCSR0C', 'UBRR0L', 'UBRR0H',
    'EICRA', 'EIMSK', 'EIFR', 'PCICR', 'PCIFR', 'PCMSK0', 'PCMSK1', 'PCMSK2',
    'SREG', 'SPL', 'SPH'
];

const DICT_C = [
    '#define F_CPU 16000000UL',
    '#include <avr/io.h>',
    '#include <util/delay.h>',
    '#include <avr/interrupt.h>',
    'int main(void)',
    'void',
    'unsigned char',
    'uint8_t',
    'uint16_t',
    'uint32_t',
    'int',
    'char',
    'volatile',
    'while (1)',
    'while',
    'if',
    'else',
    'for',
    'return',
    'break',
    '_delay_ms(50);',
    'sei();',
    'cli();',
    'ISR(INT0_vect)', 'ISR(INT1_vect)', 'ISR(PCINT0_vect)', 'ISR(PCINT2_vect)',
    'ISR(ANALOG_COMP_vect)', 'ISR(ADC_vect)', 'ISR(USART_RX_vect)', 'ISR(USART_UDRE_vect)', 'ISR(USART_TX_vect)',
    'ISC00', 'ISC01', 'ISC10', 'ISC11', 'INT0', 'INT1', 'PCIE0', 'PCIE1', 'PCIE2',
    'ADEN', 'ADSC', 'ADIE', 'ADLAR', 'REFS0', 'REFS1', 'ACD', 'ACBG', 'ACO', 'ACI', 'ACIE',
    'TXEN0', 'RXEN0', 'UDRIE0', 'TXCIE0', 'RXCIE0', 'UCSZ00', 'UCSZ01',
    'PB0', 'PB1', 'PB2', 'PB3', 'PB4', 'PB5',
    'PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7',
    'PC0', 'PC1', 'PC2', 'PC3', 'PC4', 'PC5',
    ...COMMON_REGISTERS
];

const DICT_ASM = [
    '.include "m328pdef.inc"',
    '.org 0x0000', '.org 0x0002', '.org 0x0004', '.org 0x0006', '.org 0x000A',
    '.org 0x0024', '.org 0x0026', '.org 0x0028', '.org 0x002A',
    '.equ CLK = 16000000',
    '.equ BAUD = 9600',
    '.def temp = r16',
    '.cseg',
    '.db',
    'ldi', 'mov', 'add', 'adc', 'sub', 'subi', 'sbc', 'sbci', 'adiw', 'sbiw',
    'and', 'andi', 'or', 'ori', 'eor', 'com', 'neg', 'inc', 'dec', 'tst', 'clr', 'ser',
    'lsl', 'lsr', 'asr', 'rol', 'ror',
    'rjmp', 'jmp', 'call', 'ret', 'reti',
    'breq', 'brne', 'brcs', 'brcc', 'brlo', 'brsh', 'brmi', 'brpl', 'brge', 'brlt',
    'brhs', 'brhc', 'brts', 'brtc', 'brvs', 'brvc',
    'cp', 'cpc', 'cpi', 'cpse', 'sbrs', 'sbrc',
    'bst', 'bld', 'sbi', 'cbi', 'sbis', 'sbic', 'lpm', 'mul', 'muls',
    'in', 'out', 'push', 'pop', 'lds', 'sts', 'ld', 'st',
    'sec', 'clc', 'sez', 'clz', 'sen', 'cln', 'sev', 'clv', 'ses', 'cls', 'seh', 'clh', 'set', 'clt',
    'sei', 'cli', 'nop', 'break',
    'RAMEND', 'high(RAMEND)', 'low(RAMEND)',
    'xl', 'xh', 'yl', 'yh', 'zl', 'zh',
    'r16', 'r17', 'r18', 'r19', 'r20', 'r21', 'r22', 'r23', 'r24', 'r25', 'r26', 'r27', 'r28', 'r29', 'r30', 'r31',
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

    const statusElem = document.getElementById('compilerStatus');
    if (statusElem && cpu.error) {
        statusElem.title = cpu.error + ' (Нажмите, чтобы прочитать полностью)';
        statusElem.style.cursor = 'pointer';
        statusElem.onclick = () => alert('⚠️ Ошибка дебаггера:\n\n' + cpu.error);
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

/* ================= 4. ТЕМА 7: КОМПАРАТОР И АЦП ================= */

function updatePotentiometer(rawVal) {
    cpu.potVal = parseInt(rawVal, 10);
    const volts = (cpu.potVal / 1023 * 5.0).toFixed(2);
    const badge = document.getElementById('potVoltageBadge');
    if (badge) badge.textContent = volts + ' V (ADC: ' + cpu.potVal + ')';

    syncAnalogHardware();
    recordAnalyzerSample();
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

/* ================= 5. МОДАЛЬНЫЙ КОНФИГУРАТОР I/O ================= */

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

    if (type.startsWith('btn')) {
        vButtons.push(comp);
    }

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

/* ================= 6. ЛОГИЧЕСКИЙ АНАЛИЗАТОР ================= */

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

let selectedChannelIds = new Set(['PD2', 'PD3', 'PD0', 'PD1', 'PB5', 'PB0']);

const analyzer = {
    zoom: 1.0,
    maxSamples: 1500,
    samples: []
};

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
    const pind = readRAM(IO.PIND), ddrd = readRAM(IO.DDRD), portd = readRAM(IO.PORTD);
    const pinb = readRAM(IO.PINB), ddrb = readRAM(IO.DDRB), portb = readRAM(IO.PORTB);
    const pinc = readRAM(IO.PINC), ddrc = readRAM(IO.DDRC), portc = readRAM(IO.PORTC);

    function getPinVal(portLetter, pin) {
        if (portLetter === 'D') return (ddrd & (1 << pin)) ? ((portd >> pin) & 1) : ((pind >> pin) & 1);
        if (portLetter === 'B') return (ddrb & (1 << pin)) ? ((portb >> pin) & 1) : ((pinb >> pin) & 1);
        if (portLetter === 'C') return (ddrc & (1 << pin)) ? ((portc >> pin) & 1) : ((pinc >> pin) & 1);
        return 0;
    }

    const sample = { cycle: cpu.cycles, vals: {} };
    ALL_CHANNELS.forEach(ch => {
        sample.vals[ch.id] = getPinVal(ch.port, ch.pin);
    });

    analyzer.samples.push(sample);
    if (analyzer.samples.length > analyzer.maxSamples) analyzer.samples.shift();
}

function resizeAnalyzerCanvas() {
    const canvas = document.getElementById('logicCanvas');
    const wrapper = document.getElementById('canvasWrapper');
    if (!canvas || !wrapper) return;

    const activeChannels = ALL_CHANNELS.filter(c => selectedChannelIds.has(c.id));
    const trackHeight = 32;
    const requiredH = Math.max(wrapper.clientHeight - 4, activeChannels.length * trackHeight + 20);
    const requiredW = Math.max(wrapper.clientWidth - 4, 600);

    canvas.width = requiredW;
    canvas.height = requiredH;
    canvas.style.width = requiredW + 'px';
    canvas.style.height = requiredH + 'px';

    drawLogicAnalyzer();
}

function drawLogicAnalyzer() {
    const canvas = document.getElementById('logicCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#040508';
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

        ctx.strokeStyle = '#151c28';
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

/* ================= 7. ТРАНСЛЯТОР MICRO-C ================= */

const AVR_CONSTS = {
    ISC00: 0, ISC01: 1, ISC10: 2, ISC11: 3,
    INT0: 0, INT1: 1, PCIE0: 0, PCIE1: 1, PCIE2: 2,
    PCINT0: 0, PCINT1: 1, PCINT2: 2, PCINT3: 3, PCINT4: 4, PCINT5: 5, PCINT6: 6, PCINT7: 7,
    PCINT8: 0, PCINT9: 1, PCINT10: 2, PCINT11: 3, PCINT12: 4, PCINT13: 5, PCINT14: 6,
    PCINT16: 0, PCINT17: 1, PCINT18: 2, PCINT19: 3, PCINT20: 4, PCINT21: 5, PCINT22: 6, PCINT23: 7,
    ACD: 7, ACBG: 6, ACO: 5, ACI: 4, ACIE: 3, ACIC: 2, ACIS1: 1, ACIS0: 0,
    REFS1: 7, REFS0: 6, ADLAR: 5, MUX3: 3, MUX2: 2, MUX1: 1, MUX0: 0,
    ADEN: 7, ADSC: 6, ADATE: 5, ADIF: 4, ADIE: 3, ADPS2: 2, ADPS1: 1, ADPS0: 0,
    TXEN0: 3, RXEN0: 4, UDRIE0: 5, TXCIE0: 6, RXCIE0: 7,
    UCSZ00: 1, UCSZ01: 2, UCSZ02: 2,
    PORTD0: 0, PORTD1: 1, PORTD2: 2, PORTD3: 3, PORTD4: 4, PORTD5: 5, PORTD6: 6, PORTD7: 7,
    PORTB0: 0, PORTB1: 1, PORTB2: 2, PORTB3: 3, PORTB4: 4, PORTB5: 5, PORTB6: 6, PORTB7: 7,
    PORTC0: 0, PORTC1: 1, PORTC2: 2, PORTC3: 3, PORTC4: 4, PORTC5: 5, PORTC6: 6, PORTC7: 7,
    PIND0: 0, PIND1: 1, PIND2: 2, PIND3: 3, PIND4: 4, PIND5: 5, PIND6: 6, PIND7: 7,
    PINB0: 0, PINB1: 1, PINB2: 2, PINB3: 3, PINB4: 4, PINB5: 5, PINB6: 6, PINB7: 7,
    PINC0: 0, PINC1: 1, PINC2: 2, PINC3: 3, PINC4: 4, PINC5: 5, PINC6: 6, PINC7: 7,
    DDD0: 0, DDD1: 1, DDD2: 2, DDD3: 3, DDD4: 4, DDD5: 5, DDD6: 6, DDD7: 7,
    DDB0: 0, DDB1: 1, DDB2: 2, DDB3: 3, DDB4: 4, DDB5: 5, DDB6: 6, DDB7: 7,
    DDC0: 0, DDC1: 1, DDC2: 2, DDC3: 3, DDC4: 4, DDC5: 5, DDC6: 6, DDC7: 7,
    PD0: 0, PD1: 1, PD2: 2, PD3: 3, PD4: 4, PD5: 5, PD6: 6, PD7: 7,
    PB0: 0, PB1: 1, PB2: 2, PB3: 3, PB4: 4, PB5: 5, PB6: 6, PB7: 7,
    PC0: 0, PC1: 1, PC2: 2, PC3: 3, PC4: 4, PC5: 5, PC6: 6, PC7: 7
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

// ИСПРАВЛЕНО: поддержка отрицательных чисел (-2 -> 0xFE = 254)
function scaleThreshold(val) {
    if (val === null || val === undefined) return 0;
    if (val >= 10000) return Math.max(5, Math.round(val / 20000));
    return (val < 0) ? (val & 0xFF) : Math.min(255, val);
}

function compileCToAsm(cCode) {
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

    function checkNextLineIsElse(startIdx) {
        for (let j = startIdx + 1; j < rawLines.length; j++) {
            let l = rawLines[j];
            if (!l) continue;
            return l.startsWith('else');
        }
        return false;
    }

    function extractPinAndBit(expr) {
        const portMatch = expr.match(/(PIN[BCD])/i);
        if (!portMatch) return null;
        const port = portMatch[1].toUpperCase();

        let bit = 0;
        const shiftMatch = expr.match(/1\s*<<\s*([a-zA-Z0-9_]+)/i);
        if (shiftMatch) {
            bit = evaluateCExpression(applyDefines(shiftMatch[1]), defines) || 0;
        } else {
            const hexMatch = expr.match(/&\s*(0x[0-9a-fA-F]+|\d+)/i);
            if (hexMatch) {
                const mask = evaluateCExpression(hexMatch[1], defines) || 1;
                bit = Math.max(0, Math.round(Math.log2(mask)));
            }
        }
        return { port, bit };
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
            else if (vName.includes('PCINT0')) lbl = '__vector_pcint0';
            else if (vName.includes('PCINT1')) lbl = '__vector_pcint1';
            else if (vName.includes('PCINT2')) lbl = '__vector_pcint2';
            else if (vName.includes('ANALOG_COMP')) lbl = '__vector_analog_comp';
            else if (vName.includes('ADC')) lbl = '__vector_adc';
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

        const delayMatch = line.match(/_delay_ms\s*\(\s*([0-9]+)\s*\);/);
        if (delayMatch) {
            const lblDelay = '__delay_loop_' + (labelCounter++);
            asmList.push({ asm: 'ldi r24, 2', lineNum });
            asmList.push({ asm: lblDelay + ':', lineNum });
            asmList.push({ asm: 'dec r24', lineNum });
            asmList.push({ asm: 'brne ' + lblDelay, lineNum });
            continue;
        }

        if (line.startsWith('while') && line.includes('PIN')) {
            const pinInfo = extractPinAndBit(line);
            if (pinInfo) {
                const lblWait = '__wait_release_' + (labelCounter++);
                asmList.push({ asm: lblWait + ':', lineNum });
                asmList.push({ asm: 'in r16, ' + pinInfo.port, lineNum });
                asmList.push({ asm: 'sbrs r16, ' + pinInfo.bit, lineNum });
                asmList.push({ asm: 'rjmp ' + lblWait, lineNum });
                continue;
            }
        }

        if (line === '}' || line.startsWith('}')) {
            if (controlStack.length > 0) {
                const top = controlStack[controlStack.length - 1];

                if (top.type === 'if') {
                    if (checkNextLineIsElse(i) || line.includes('else')) {
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

        const multiDeclMatch = line.match(/\b(unsigned\s+char|uint8_t|int8_t|uint16_t|int16_t|uint32_t|int|char)\s+([^;]+);/);
        if (multiDeclMatch) {
            const rawVars = multiDeclMatch[2].split(',');
            for (let vItem of rawVars) {
                const vParts = vItem.trim().split('=');
                const vName = vParts[0].trim();
                const initVal = vParts[1] ? vParts[1].trim() : "0";
                const reg = 'r' + (regCounter++);
                varMap[vName] = { reg };
                let constVal = evaluateCExpression(applyDefines(initVal), defines);
                if (constVal !== null) {
                    constVal = scaleThreshold(constVal);
                    const inst = { asm: 'ldi ' + reg + ', ' + (constVal & 0xFF), lineNum };
                    if (!insideMain) globalInits.push(inst);
                    else asmList.push(inst);
                }
            }
            continue;
        }

        const portOrMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|DDRC|PORTC|PCICR|EICRA|EIMSK|ACSR|ADMUX|ADCSRA|UCSR0B|UCSR0C)\s*\|\=\s*([^;]+);/);
        if (portOrMatch) {
            const portName = portOrMatch[1];
            const mask = evaluateCExpression(applyDefines(portOrMatch[2]), defines) & 0xFF;
            asmList.push({ asm: 'in r16, ' + portName, lineNum });
            asmList.push({ asm: 'ori r16, ' + mask, lineNum });
            asmList.push({ asm: 'out ' + portName + ', r16', lineNum });
            continue;
        }

        const portAndNotMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|DDRC|PORTC|ACSR|ADMUX|ADCSRA|UCSR0B|UCSR0C)\s*&\=\s*~\s*\(?\s*([^;]+)\)?;/);
        if (portAndNotMatch) {
            const portName = portAndNotMatch[1];
            const mask = evaluateCExpression(applyDefines(portAndNotMatch[2].replace(/\)+$/, '')), defines) & 0xFF;
            const invMask = (~mask) & 0xFF;
            asmList.push({ asm: 'in r16, ' + portName, lineNum });
            asmList.push({ asm: 'andi r16, ' + invMask, lineNum });
            asmList.push({ asm: 'out ' + portName + ', r16', lineNum });
            continue;
        }

        const portXorMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD)\s*\^\=\s*([^;]+);/);
        if (portXorMatch) {
            const portName = portXorMatch[1];
            const mask = evaluateCExpression(applyDefines(portXorMatch[2]), defines) & 0xFF;
            asmList.push({ asm: 'in r16, ' + portName, lineNum });
            asmList.push({ asm: 'ldi r17, ' + mask, lineNum });
            asmList.push({ asm: 'eor r16, r17', lineNum });
            asmList.push({ asm: 'out ' + portName + ', r16', lineNum });
            continue;
        }

        const assignAnyMatch = line.match(/\b([a-zA-Z0-9_]+)\s*=\s*([^;]+);/);
        if (assignAnyMatch) {
            const dst = assignAnyMatch[1].trim();
            const src = assignAnyMatch[2].trim();

            if (varMap[dst] && (src === 'PINB' || src === 'PIND' || src === 'PINC' || src === 'UDR0' || src === 'ADCH' || src === 'ADCL')) {
                asmList.push({ asm: 'in ' + varMap[dst].reg + ', ' + src, lineNum });
                continue;
            }

            if (['PORTB','PORTC','PORTD','DDRB','DDRC','DDRD','EICRA','EIMSK','PCICR','PCICR0','PCMSK0','PCMSK2','ACSR','ADMUX','ADCSRA','UBRR0','UDR0'].includes(dst)) {
                let pName = (dst === 'PCICR0') ? 'PCICR' : dst;
                let cVal = evaluateCExpression(applyDefines(src), defines);
                if (cVal !== null) {
                    asmList.push({ asm: 'ldi r16, ' + (cVal & 0xFF), lineNum });
                    asmList.push({ asm: 'out ' + pName + ', r16', lineNum });
                } else if (varMap[src]) {
                    asmList.push({ asm: 'out ' + pName + ', ' + varMap[src].reg, lineNum });
                }
                continue;
            }

            if (varMap[dst]) {
                let cVal = evaluateCExpression(applyDefines(src), defines);
                if (cVal !== null) {
                    asmList.push({ asm: 'ldi ' + varMap[dst].reg + ', ' + (cVal & 0xFF), lineNum });
                } else if (varMap[src]) {
                    asmList.push({ asm: 'mov ' + varMap[dst].reg + ', ' + varMap[src].reg, lineNum });
                }
                continue;
            }
        }

        const incMatch = line.match(/\b([a-zA-Z0-9_]+)\+\+;/);
        if (incMatch && varMap[incMatch[1]]) {
            asmList.push({ asm: 'inc ' + varMap[incMatch[1]].reg, lineNum });
            continue;
        }

        const decMatch = line.match(/\b([a-zA-Z0-9_]+)--;/);
        if (decMatch && varMap[decMatch[1]]) {
            asmList.push({ asm: 'dec ' + varMap[decMatch[1]].reg, lineNum });
            continue;
        }

        if (line.startsWith('while') && line.includes('1')) {
            const startLbl = '__while_start_' + (labelCounter++);
            asmList.push({ asm: startLbl + ':', lineNum });
            controlStack.push({ type: 'while', startLbl });
            continue;
        }

        if (line.startsWith('if') && line.includes('PIN')) {
            const pinInfo = extractPinAndBit(line);
            if (pinInfo) {
                const lblFalse = '__lbl_false_' + (labelCounter++);
                const lblEnd = '__lbl_end_' + (labelCounter++);

                asmList.push({ asm: 'in r16, ' + pinInfo.port, lineNum });
                asmList.push({ asm: 'sbrc r16, ' + pinInfo.bit, lineNum });
                asmList.push({ asm: 'rjmp ' + lblFalse, lineNum });
                controlStack.push({ type: 'if', lblFalse, lblEnd });
                continue;
            }
        }

        const bitMaskMatch = line.match(/if\s*\(\s*([a-zA-Z0-9_]+)\s*&\s*([^)]+)\)/);
        if (bitMaskMatch && varMap[bitMaskMatch[1]]) {
            const vName = bitMaskMatch[1];
            const mask = evaluateCExpression(applyDefines(bitMaskMatch[2]), defines) || 0;
            const lblFalse = '__lbl_false_' + (labelCounter++);
            const lblEnd = '__lbl_end_' + (labelCounter++);

            asmList.push({ asm: 'mov r16, ' + varMap[vName].reg, lineNum });
            asmList.push({ asm: 'andi r16, ' + (mask & 0xFF), lineNum });
            asmList.push({ asm: 'breq ' + lblFalse, lineNum });
            controlStack.push({ type: 'if', lblFalse, lblEnd });
            continue;
        }

        const ifCmpMatch = line.match(/if\s*\(\s*([a-zA-Z0-9_]+)\s*(==|!=|>=|>|<=|<)\s*([^)]+)\)/);
        if (ifCmpMatch) {
            const vName = ifCmpMatch[1];
            const op = ifCmpMatch[2];
            let rawCmp = applyDefines(ifCmpMatch[3]);
            let cmpVal = evaluateCExpression(rawCmp, defines);

            if (cmpVal !== null) {
                let compReg = 'r16';
                if (varMap[vName]) compReg = varMap[vName].reg;
                else if (vName === 'UDR0') {
                    asmList.push({ asm: 'in r16, UDR0', lineNum });
                    compReg = 'r16';
                }

                cmpVal = scaleThreshold(cmpVal);
                const lblFalse = '__lbl_false_' + (labelCounter++);
                const lblEnd = '__lbl_end_' + (labelCounter++);

                asmList.push({ asm: 'cpi ' + compReg + ', ' + (cmpVal & 0xFF), lineNum });
                if (op === '==')      asmList.push({ asm: 'brne ' + lblFalse, lineNum });
                else if (op === '!=') asmList.push({ asm: 'breq ' + lblFalse, lineNum });
                else if (op === '>=') asmList.push({ asm: 'brge ' + lblFalse, lineNum });
                else if (op === '<')  asmList.push({ asm: 'brlt ' + lblFalse, lineNum });
                else if (op === '>')  asmList.push({ asm: 'brgt ' + lblFalse, lineNum });
                else if (op === '<=') asmList.push({ asm: 'brle ' + lblFalse, lineNum });

                controlStack.push({ type: 'if', lblFalse, lblEnd });
                continue;
            }
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

/* ================= 8. ПАРСЕР АССЕМБЛЕРА ================= */

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
    if (expr.toLowerCase().includes('high(ramend)')) return 0x08;
    if (expr.toLowerCase().includes('low(ramend)')) return 0xFF;

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

    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const sIdx = line.indexOf(';');
        if (sIdx !== -1) line = line.substring(0, sIdx);
        line = line.trim();
        if (line.toLowerCase().startsWith('.equ')) {
            const eqMatch = line.match(/\.equ\s+([a-zA-Z0-9_]+)\s*=\s*(.+)/i);
            if (eqMatch) {
                cpu.equConstants[eqMatch[1].trim()] = evaluateAsmExpression(eqMatch[2].trim());
            }
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
                } else if (itm === "'\\n'" || itm === "'\\r'") {
                    cpu.flashBytes[bytePtr++] = 10;
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

/* ================= 9. ДОСТУП К ПАМЯТИ И EEPROM ================= */

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

    // Запись / Чтение энергонезависимой памяти EEPROM
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
            if (eear < cpu.eeprom.length) {
                cpu.ram[IO.EEDR] = cpu.eeprom[eear];
            }
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
        cpu.ram[IO.UCSR0A] |= (1 << 5) | (1 << 6);
        appendUartTerminal(String.fromCharCode(val));
    }
}

function readRAM(addr) {
    if (addr >= 0 && addr < 32) return cpu.r[addr];

    if (addr === IO.UDR0) {
        if (cpu.rxBuffer.length > 0) {
            const b = cpu.rxBuffer.shift();
            if (cpu.rxBuffer.length === 0) {
                cpu.ram[IO.UCSR0A] &= ~(1 << 7);
            }
            return b;
        }
        cpu.ram[IO.UCSR0A] &= ~(1 << 7);
        return 0;
    }

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

function isTwoWordInstruction(inst) {
    if (!inst) return false;
    return ['jmp', 'call', 'lds', 'sts'].includes(inst.op.toLowerCase());
}

/* ================= 10. ФЛАГИ АЛУ ================= */

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
    
    if (isSbc) {
        cpu.sreg.Z = (((res & 0xFF) === 0) && cpu.sreg.Z) ? 1 : 0;
    } else {
        cpu.sreg.Z = ((res & 0xFF) === 0) ? 1 : 0;
    }
    
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

/* ================= 11. ДИСПЕТЧЕР ПРЕРЫВАНИЙ ================= */

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

    // INT0
    const isc0 = eicra & 0x03;
    const pd2Now = (curPind >> 2) & 1;
    const pd2Prev = (cpu.prevPinD >> 2) & 1;

    if (isc0 === 0 && pd2Now === 0) eifr |= (1 << 0);
    else if (isc0 === 1 && pd2Now !== pd2Prev) eifr |= (1 << 0);
    else if (isc0 === 2 && pd2Prev === 1 && pd2Now === 0) eifr |= (1 << 0);
    else if (isc0 === 3 && pd2Prev === 0 && pd2Now === 1) eifr |= (1 << 0);

    // INT1
    const isc1 = (eicra >> 2) & 0x03;
    const pd3Now = (curPind >> 3) & 1;
    const pd3Prev = (cpu.prevPinD >> 3) & 1;

    if (isc1 === 0 && pd3Now === 0) eifr |= (1 << 1);
    else if (isc1 === 1 && pd3Now !== pd3Prev) eifr |= (1 << 1);
    else if (isc1 === 2 && pd3Prev === 1 && pd3Now === 0) eifr |= (1 << 1);
    else if (isc1 === 3 && pd3Prev === 0 && pd3Now === 1) eifr |= (1 << 1);

    cpu.ram[IO.EIFR] = eifr;

    // PCINT
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

/* ================= 12. ШАГ ПРОЦЕССОРА ================= */

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

    if (op === 'break') { haltExecution(); if (!silent) updateUI(); return; }

    switch (op) {
        case 'ldi': { cpu.r[parseReg(a[0])] = parseVal(a[1]) & 0xFF; break; }
        case 'mov': { cpu.r[parseReg(a[0])] = cpu.r[parseReg(a[1])]; break; }
        case 'in':  { cpu.r[parseReg(a[0])] = readRAM(resolveIoRamAddr(a[1])); break; }
        case 'out': { writeRAM(resolveIoRamAddr(a[0]), cpu.r[parseReg(a[1])]); break; }
        case 'lds': { cpu.r[parseReg(a[0])] = readRAM(resolveDataRamAddr(a[1])); break; }
        case 'sts': { writeRAM(resolveDataRamAddr(a[0]), cpu.r[parseReg(a[1])]); break; }
        case 'ld': {
            let addr = getPointerAddr(a[1].replace('+', '').replace('-', ''));
            if (a[1].includes('-')) { addr--; setPointerAddr(a[1].replace('-', ''), addr); }
            cpu.r[parseReg(a[0])] = readRAM(addr);
            if (a[1].includes('+')) setPointerAddr(a[1].replace('+', ''), addr + 1);
            break;
        }
        case 'st': {
            let addr = getPointerAddr(a[0].replace('+', '').replace('-', ''));
            if (a[0].includes('-')) { addr--; setPointerAddr(a[0].replace('-', ''), addr); }
            writeRAM(addr, cpu.r[parseReg(a[1])]);
            if (a[0].includes('+')) setPointerAddr(a[0].replace('+', ''), addr + 1);
            break;
        }
        case 'push': { pushStack(cpu.r[parseReg(a[0])]); break; }
        case 'pop':  { cpu.r[parseReg(a[0])] = popStack(); break; }
        case 'clr':  { cpu.r[parseReg(a[0])] = 0; setFlagsLogic(0); break; }
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

        // Аппаратное умножение (MUL / MULS)
        case 'mul': {
            const r1 = parseReg(a[0]), r2 = parseReg(a[1]);
            const res = (cpu.r[r1] * cpu.r[r2]) & 0xFFFF;
            cpu.r[0] = res & 0xFF;
            cpu.r[1] = (res >> 8) & 0xFF;
            cpu.sreg.C = ((res >> 15) & 1);
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            break;
        }
        case 'muls': {
            const r1 = parseReg(a[0]), r2 = parseReg(a[1]);
            const s1 = (cpu.r[r1] & 0x80) ? (cpu.r[r1] - 256) : cpu.r[r1];
            const s2 = (cpu.r[r2] & 0x80) ? (cpu.r[r2] - 256) : cpu.r[r2];
            const res = (s1 * s2) & 0xFFFF;
            cpu.r[0] = res & 0xFF;
            cpu.r[1] = (res >> 8) & 0xFF;
            cpu.sreg.C = ((res >> 15) & 1);
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            break;
        }

        case 'bst': {
            const reg = parseReg(a[0]);
            const bit = parseVal(a[1]);
            cpu.sreg.T = (cpu.r[reg] >> bit) & 1;
            break;
        }
        case 'bld': {
            const reg = parseReg(a[0]);
            const bit = parseVal(a[1]);
            if (cpu.sreg.T) cpu.r[reg] |= (1 << bit);
            else cpu.r[reg] &= ~(1 << bit);
            break;
        }
        case 'sbi': {
            const addr = resolveIoRamAddr(a[0]);
            const bit = parseVal(a[1]);
            writeRAM(addr, readRAM(addr) | (1 << bit));
            break;
        }
        case 'cbi': {
            const addr = resolveIoRamAddr(a[0]);
            const bit = parseVal(a[1]);
            writeRAM(addr, readRAM(addr) & ~(1 << bit));
            break;
        }
        case 'sbis': {
            const addr = resolveIoRamAddr(a[0]);
            const bit = parseVal(a[1]);
            if ((readRAM(addr) & (1 << bit)) !== 0) {
                nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            }
            break;
        }
        case 'sbic': {
            const addr = resolveIoRamAddr(a[0]);
            const bit = parseVal(a[1]);
            if ((readRAM(addr) & (1 << bit)) === 0) {
                nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            }
            break;
        }

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
            const r1 = parseReg(a[0]), k = parseVal(a[1]) & 0xFF;
            const res = cpu.r[r1] - k;
            setFlagsSub(cpu.r[r1], k, res);
            cpu.r[r1] = res & 0xFF; break;
        }
        case 'sbc': {
            const r1 = parseReg(a[0]), r2 = parseReg(a[1]);
            const res = cpu.r[r1] - cpu.r[r2] - cpu.sreg.C;
            setFlagsSub(cpu.r[r1], cpu.r[r2], res, true);
            cpu.r[r1] = res & 0xFF; break;
        }
        case 'sbci': {
            const r1 = parseReg(a[0]), k = parseVal(a[1]) & 0xFF;
            const res = cpu.r[r1] - k - cpu.sreg.C;
            setFlagsSub(cpu.r[r1], k, res, true);
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
            cpu.sreg.H = ((res & 0x0F) > 0) ? 1 : 0;
            cpu.sreg.C = (res !== 0) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = (val === 0x80) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
            cpu.r[reg] = res; break;
        }
        case 'com': {
            const reg = parseReg(a[0]);
            const res = (~cpu.r[reg]) & 0xFF;
            cpu.r[reg] = res;
            cpu.sreg.C = 1;
            setFlagsLogic(res); break;
        }
        case 'and': {
            const r1 = parseReg(a[0]);
            cpu.r[r1] &= cpu.r[parseReg(a[1])];
            setFlagsLogic(cpu.r[r1]); break;
        }
        case 'andi': {
            const r1 = parseReg(a[0]);
            cpu.r[r1] &= (parseVal(a[1]) & 0xFF);
            setFlagsLogic(cpu.r[r1]); break;
        }
        case 'or': {
            const r1 = parseReg(a[0]);
            cpu.r[r1] |= cpu.r[parseReg(a[1])];
            setFlagsLogic(cpu.r[r1]); break;
        }
        case 'ori': {
            const r1 = parseReg(a[0]);
            cpu.r[r1] |= (parseVal(a[1]) & 0xFF);
            setFlagsLogic(cpu.r[r1]); break;
        }
        case 'eor': {
            const r1 = parseReg(a[0]);
            cpu.r[r1] ^= cpu.r[parseReg(a[1])];
            setFlagsLogic(cpu.r[r1]); break;
        }
        case 'tst': { setFlagsLogic(cpu.r[parseReg(a[0])]); break; }
        case 'lsl': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const res = (prev << 1) & 0xFF;
            cpu.r[reg] = res;
            cpu.sreg.C = (prev & 0x80) ? 1 : 0;
            cpu.sreg.H = (prev & 0x08) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'lsr': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const res = prev >> 1;
            cpu.r[reg] = res;
            cpu.sreg.C = (prev & 0x01) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = 0;
            cpu.sreg.V = cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.V; break;
        }
        case 'asr': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const res = (prev >> 1) | (prev & 0x80);
            cpu.r[reg] = res;
            cpu.sreg.C = (prev & 0x01) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'rol': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const oldC = cpu.sreg.C;
            const res = ((prev << 1) | oldC) & 0xFF;
            cpu.r[reg] = res;
            cpu.sreg.C = (prev & 0x80) ? 1 : 0;
            cpu.sreg.H = (prev & 0x08) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'ror': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const oldC = cpu.sreg.C;
            const res = (prev >> 1) | (oldC << 7);
            cpu.r[reg] = res;
            cpu.sreg.C = (prev & 0x01) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }

        case 'adiw': {
            const rLow = parseReg(a[0]);
            const k = parseVal(a[1]) & 0x3F;
            const curVal = cpu.r[rLow] | (cpu.r[rLow + 1] << 8);
            const res = curVal + k;
            cpu.r[rLow] = res & 0xFF;
            cpu.r[rLow + 1] = (res >> 8) & 0xFF;
            cpu.sreg.Z = ((res & 0xFFFF) === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x8000) ? 1 : 0;
            cpu.sreg.V = (!((curVal >> 15) & 1) && ((res >> 15) & 1)) ? 1 : 0;
            cpu.sreg.C = (!((res >> 15) & 1) && ((curVal >> 15) & 1)) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'sbiw': {
            const rLow = parseReg(a[0]);
            const k = parseVal(a[1]) & 0x3F;
            const curVal = cpu.r[rLow] | (cpu.r[rLow + 1] << 8);
            const res = curVal - k;
            cpu.r[rLow] = res & 0xFF;
            cpu.r[rLow + 1] = (res >> 8) & 0xFF;
            cpu.sreg.Z = ((res & 0xFFFF) === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x8000) ? 1 : 0;
            cpu.sreg.V = (((curVal >> 15) & 1) && !((res >> 15) & 1)) ? 1 : 0;
            cpu.sreg.C = (((res >> 15) & 1) && !((curVal >> 15) & 1)) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }

        case 'cp': {
            setFlagsSub(cpu.r[parseReg(a[0])], cpu.r[parseReg(a[1])], cpu.r[parseReg(a[0])] - cpu.r[parseReg(a[1])]);
            break;
        }
        case 'cpi': {
            const k = parseVal(a[1]) & 0xFF;
            setFlagsSub(cpu.r[parseReg(a[0])], k, cpu.r[parseReg(a[0])] - k);
            break;
        }
        case 'cpse': {
            if (cpu.r[parseReg(a[0])] === cpu.r[parseReg(a[1])]) {
                nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            }
            break;
        }
        case 'sbrs': {
            if ((cpu.r[parseReg(a[0])] & (1 << parseVal(a[1]))) !== 0) {
                nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            }
            break;
        }
        case 'sbrc': {
            if ((cpu.r[parseReg(a[0])] & (1 << parseVal(a[1]))) === 0) {
                nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            }
            break;
        }

        case 'jmp':
        case 'rjmp': {
            const target = resolveLabel(a[0], inst.lineNum);
            if (target !== null) nextPC = target;
            break;
        }
        case 'call': {
            const target = resolveLabel(a[0], inst.lineNum);
            if (target !== null) {
                pushStack(nextPC & 0xFF);
                pushStack((nextPC >> 8) & 0xFF);
                nextPC = target;
            }
            break;
        }
        case 'ret': {
            const high = popStack();
            const low = popStack();
            nextPC = (high << 8) | low; break;
        }
        case 'reti': {
            const high = popStack();
            const low = popStack();
            nextPC = (high << 8) | low;
            cpu.sreg.I = 1; break;
        }

        case 'breq': { if (cpu.sreg.Z === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brne': { if (cpu.sreg.Z === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brcs':
        case 'brlo': { if (cpu.sreg.C === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brcc':
        case 'brsh': { if (cpu.sreg.C === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brmi': { if (cpu.sreg.N === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brpl': { if (cpu.sreg.N === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brge': { if (cpu.sreg.S === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brlt': { if (cpu.sreg.S === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brhs': { if (cpu.sreg.H === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brhc': { if (cpu.sreg.H === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brts': { if (cpu.sreg.T === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brtc': { if (cpu.sreg.T === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brvs': { if (cpu.sreg.V === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brvc': { if (cpu.sreg.V === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }

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

        case 'nop': { break; }
    }

    cpu.pc = nextPC;
    cpu.cycles += CYCLES[op] || 1;

    syncHardwareState();
    checkInterrupts();
    recordAnalyzerSample();

    if (!silent) updateUI();

    if (cpu.running && cpu.pc < cpu.program.length) {
        if (cpu.breakpoints.has(cpu.program[cpu.pc].lineNum)) {
            haltExecution();
            updateUI();
        }
    }
}

/* ================= 13. СИНХРОНИЗАЦИЯ ПЕРИФЕРИИ ================= */

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
            recordAnalyzerSample();
            updateUI();
        }, 150);
    } else {
        btn.pressed = !btn.pressed;
        document.getElementById('vbtn_' + id)?.classList.toggle('latched', btn.pressed);
    }

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

    syncAnalogHardware();
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
}

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
}

function sendUartInput() {
    const inp = document.getElementById('serialInput');
    if (!inp || !inp.value) return;
    const text = inp.value;
    inp.value = '';

    for (let i = 0; i < text.length; i++) {
        cpu.rxBuffer.push(text.charCodeAt(i));
    }

    cpu.ram[IO.UCSR0A] |= (1 << 7);
    checkInterrupts();
    updateUI();
}

/* ================= 14. WEB SERIAL API ================= */

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
                        for (let byte of value) {
                            cpu.rxBuffer.push(byte);
                        }
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

/* ================= 15. RUNLOOP ================= */

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

    let delay = 16;
    let batchSize = 1;

    if (cpu.speed <= 50) {
        delay = Math.max(16, Math.floor(1000 / cpu.speed));
        batchSize = 1;
    } else {
        delay = 16;
        batchSize = Math.max(1, Math.round(cpu.speed / 25));
    }

    for (let i = 0; i < batchSize; i++) {
        cpuStep(true);
        if (!cpu.running || cpu.error) {
            haltExecution();
            break;
        }
    }

    updateUI();

    if (cpu.running) {
        cpu.timer = setTimeout(runLoop, delay);
    }
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
    cpu.uartLog = "";

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
    updateUI();
}

function updateSpeed(val) {
    cpu.speed = parseInt(val, 10);
    document.getElementById('speedVal').textContent = cpu.speed + ' оп/с';
}

/* ================= 16. ДАМПЫ ПАМЯТИ: SRAM, СТЕК, FLASH И EEPROM ================= */

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
        for (let addr = 0x0100; addr <= 0x0178; addr += 8) {
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
    renderHardware();
    drawLogicAnalyzer();
    renderGutter();
}

/* ================= 17. ПОДСВЕТКА И ГУТТЕР ================= */

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

function setEditorLang(lang) {
    currentLang = lang;
    document.getElementById('btnLangAsm').classList.toggle('active', lang === 'asm');
    document.getElementById('btnLangC').classList.toggle('active', lang === 'c');
    document.getElementById('editorTitle').textContent = lang === 'c' ? '⚡ Редактор (C)' : '📝 Редактор (.asm)';
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
        if (cpu.program[i]?.lineNum >= targetLine) {
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
    const gutter = document.getElementById('lineGutter');
    if (!gutter) return;

    const lines = code.split('\n');
    let html = '';
    for (let i = 1; i <= lines.length; i++) {
        const isCurrentPC = (i === curLineNum);
        const hasBp = cpu.breakpoints.has(i);
        const hasErr = cpu.syntaxErrors.has(i);
        const errTitle = hasErr ? ('Ошибка: ' + cpu.syntaxErrors.get(i)) : 'Клик: точка останова | Двойной клик: PC сюда';

        html += '<div class="gutter-row ' + (hasBp ? 'has-bp' : '') + ' ' + (hasErr ? 'has-error' : '') + ' ' + (isCurrentPC ? 'is-pc' : '') + '"' +
                ' onclick="toggleBreakpoint(' + i + ')"' +
                ' ondblclick="setPcToLine(' + i + ')"' +
                ' title="' + errTitle + '">' +
                '<span class="bp-marker"></span>' +
                '<span class="pc-arrow">▶</span>' +
                '<span class="gutter-num">' + i + '</span>' +
                '</div>';
    }
    gutter.innerHTML = html;
}

function clearEditor() {
    document.getElementById('asmCode').value = '';
    document.getElementById('hintBanner').style.display = 'none';
    cpu.breakpoints.clear();
    cpu.syntaxErrors.clear();
    updateSyntax();
    cpuReset();
}

/* ================= 18. БАЗА ПРОГРАММ ================= */

const PROGRAMS = {
    c_interrupt_int0: {
        hint: "Нажатие кнопки K1 (PD2, INT0) вызывает прерывание по спаду, инвертируя светодиоды RX и TX.",
        lang: "c",
        code: `// Внешнее прерывание INT0 по спаду (нажатие K1 на PD2)
#include <avr/io.h>
#include <avr/interrupt.h>

ISR(INT0_vect)
{
    // Инвертируем состояние линий PD0 (RX) и PD1 (TX) при прерывании
    PORTD ^= (1 << PORTD0) | (1 << PORTD1);
}

int main(void)
{
    EICRA = (1 << ISC01);
    EIMSK = (1 << INT0);

    DDRD |= (1 << DDD0) | (1 << DDD1);
    DDRD &= ~(1 << DDD2);
    PORTD |= (1 << PORTD2); 

    sei();

    while (1) { }
}`
    },

    c_blink_counter: {
        hint: "Мигание светодиодом PB5 через счетчик до 800 000 с вложенными ветками if-else.",
        lang: "c",
        code: `// Мигание встроенным светодиодом на плате (PB5) через счетчик
#define F_CPU 16000000UL
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
        hint: "Кнопки K1 (PD2), K2 (PD3), K3 (PD4) переключают светодиоды PD0 (RX), PD1 (TX) и PB5 (L).",
        lang: "c",
        code: `// Управление светодиодами кнопками-триггерами
#define F_CPU 16000000UL
#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    DDRD |= (1 << DDD0) | (1 << DDD1);
    DDRB |= (1 << DDB5);

    PORTD &= ~((1 << PORTD0) | (1 << PORTD1));
    PORTB &= ~(1 << PORTB5);

    DDRD &= ~((1 << DDD2) | (1 << DDD3) | (1 << DDD4));
    PORTD |= (1 << PORTD2) | (1 << PORTD3) | (1 << PORTD4);

    while (1)
    {
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

    c_example3: {
        hint: "Опрос кнопки K4 (PB0) и включение светодиода L (PB5) при нажатии.",
        lang: "c",
        code: `// Опрос кнопки PB0 (с подтяжкой) и включение светодиода L (PB5)
#include <avr/io.h>

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
    },

    test_all: {
        hint: "Комплексный тест: проверка команд, регистров и всех флагов SREG (I, T, H, S, V, N, Z, C).",
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

    led_running: {
        hint: "Бегущий огонёк по светодиодам Порта D.",
        lang: "asm",
        code: `; Бегущий огонёк по выводам PD0..PD7
.include "m328pdef.inc"

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
        hint: "Вывод символов текста в виртуальный порт UDR0 (монитор UART).",
        lang: "asm",
        code: `; Отправка текстовых символов в терминал UART
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

/* ================= 19. ИНИЦИАЛИЗАЦИЯ ================= */

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
        if (e.key === 'F9') {
            e.preventDefault();
            toggleBreakpoint(txtArea.value.substring(0, txtArea.selectionStart).split('\n').length);
        }
    });

    if (window.innerWidth <= 900) {
        togglePanel('editor');
    } else {
        PANEL_LIST.forEach(p => {
            const el = document.getElementById('panel_' + p);
            const btn = document.getElementById('tabBtn_' + p);
            if (el) el.classList.remove('panel-hidden');
            if (btn) btn.classList.add('active');
        });
    }

    renderChannelSelector();
    loadSelectedExample();
    syncAnalogHardware();
    setTimeout(resizeAnalyzerCanvas, 100);
});
