/* =========================================================
   ЧАСТЬ 1: ЯДРО ПРОЦЕССОРА, АЛУ, ПАМЯТЬ И ОПТИМИЗИРОВАННЫЙ ОСЦИЛЛОГРАФ
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
    ADCL:   0x78, ADCH:   0x79, // Данные АЦП (Тема 7)
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
const PANEL_LIST = ['editor', 'board', 'analyzer', 'cpu', 'tools']; // Добавлена вкладка tools

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

/* ================= 2. ЛОГИЧЕСКИЙ АНАЛИЗАТОР (ОПТИМИЗИРОВАН ДЛЯ 2 ЯДЕР) ================= */

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

let lastAnalyzerDraw = 0;

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
    if (!activePanels.analyzer) return; // Не тратим ресурсы, если скрыта

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
    for (let i = 0; i < ALL_CHANNELS.length; i++) {
        const ch = ALL_CHANNELS[i];
        if (selectedChannelIds.has(ch.id)) {
            sample.vals[ch.id] = getPinVal(ch.port, ch.pin);
        }
    }

    analyzer.samples.push(sample);
    if (analyzer.samples.length > analyzer.maxSamples + 100) {
        analyzer.samples.splice(0, 100); // Очистка пачкой вместо медленного shift()
    }
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

function drawLogicAnalyzer(force = false) {
    if (!activePanels.analyzer) return;

    // Лимит 30 FPS для разгрузки видеокарты ноутбука
    const now = performance.now();
    if (!force && cpu.running && (now - lastAnalyzerDraw < 33)) return;
    lastAnalyzerDraw = now;

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

/* ================= 3. ДОСТУП К ПАМЯТИ И EEPROM ================= */

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
            if (cpu.rxBuffer.length === 0) cpu.ram[IO.UCSR0A] &= ~(1 << 7);
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

/* ================= 4. ФЛАГИ АЛУ ================= */

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

/* ================= 5. ДИСПЕТЧЕР ПРЕРЫВАНИЙ ================= */

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

/* ================= 6. ВЫПОЛНЕНИЕ КОМАНД (MUL, LPM, ADIW, SREG) ================= */

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

// === КОНЕЦ ЧАСТИ 1. ПРОДОЛЖЕНИЕ В ЧАСТИ 2 ===
/* =========================================================
   ЧАСТЬ 2: ИНТЕРФЕЙС, LCD 1602, ИНСТРУМЕНТЫ, ДАМПЫ И ПРОГРАММЫ
   ========================================================= */

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
    updateLcdHardware();
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
    renderLcdScreen();
}

/* ================= 14. ВИРТУАЛЬНЫЙ ТЕКСТОВЫЙ ДИСПЛЕЙ LCD 1602 ================= */

const lcdState = {
    line1: "AVR Studio 1602 ",
    line2: "Ready to work!  ",
    enabled: true
};

function updateLcdHardware() {
    // Если в программе выводят в UDR0 или специальный буфер, обновляем строку
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

/* ================= 15. UART И WEB SERIAL API ================= */

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

    for (let i = 0; i < text.length; i++) {
        cpu.rxBuffer.push(text.charCodeAt(i));
    }

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

/* ================= 16. ИСПОЛНЯЕМЫЙ ЦИКЛ RUNLOOP ================= */

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
    clearLcd();
    updateUI();
}

function updateSpeed(val) {
    cpu.speed = parseInt(val, 10);
    document.getElementById('speedVal').textContent = cpu.speed + ' оп/с';
}

/* ================= 17. ДАМПЫ ПАМЯТИ: SRAM, СТЕК, FLASH И EEPROM ================= */

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

    if (activePanels.board) {
        renderHardware();
    }

    if (activePanels.tools) {
        renderToolsTab();
    }

    drawLogicAnalyzer();
    renderGutter();
}

/* ================= 18. ВКЛАДКА «ИНСТРУМЕНТЫ»: ИНСПЕКТОР, КОНВЕРТЕР, WATCH ================= */

function renderToolsTab() {
    renderAsmInspector();
    renderWatchTable();
}

// 1. Инспектор Си -> Ассемблер со стрелкой PC
function renderAsmInspector() {
    const box = document.getElementById('asmInspectorCode');
    if (!box) return;

    if (currentLang !== 'c') {
        box.textContent = "Инспектор доступен при работе в режиме Си (C).\nПереключите режим редактора на C, чтобы видеть генерацию инструкций.";
        return;
    }

    let out = '';
    for (let i = 0; i < cpu.program.length; i++) {
        const isCurrent = (i === cpu.pc);
        const prefix = isCurrent ? '▶ ' : '  ';
        const line = cpu.program[i].raw || (cpu.program[i].op + ' ' + cpu.program[i].args.join(', '));
        out += prefix + (i.toString(16).padStart(4, '0').toUpperCase()) + ': ' + line + '\n';
    }
    box.textContent = out || "Код пуст...";
}

// 2. Наблюдатель за переменными (Watch)
function renderWatchTable() {
    const tbody = document.getElementById('watchTableBody');
    if (!tbody) return;

    let html = '';
    // Отображаем переменные из регистров R17..R25
    for (let i = 17; i <= 24; i++) {
        const val = cpu.r[i];
        const sVal = (val & 0x80) ? (val - 256) : val; // знаковое
        html += '<tr>';
        html += '<td><b>R' + i + '</b></td>';
        html += '<td>' + sVal + ' (DEC)</td>';
        html += '<td>0x' + val.toString(16).padStart(2, '0').toUpperCase() + '</td>';
        html += '<td>0b' + val.toString(2).padStart(8, '0') + '</td>';
        html += '</tr>';
    }
    tbody.innerHTML = html;
}

// 3. Быстрый конвертер систем счисления
function onConverterInput(source) {
    const decInp = document.getElementById('convDec');
    const hexInp = document.getElementById('convHex');
    const binInp = document.getElementById('convBin');
    if (!decInp || !hexInp || !binInp) return;

    let val = 0;
    if (source === 'dec') val = parseInt(decInp.value, 10) || 0;
    if (source === 'hex') val = parseInt(hexInp.value, 16) || 0;
    if (source === 'bin') val = parseInt(binInp.value, 2) || 0;

    val &= 0xFFFF; // 16-бит макс
    if (source !== 'dec') decInp.value = val;
    if (source !== 'hex') hexInp.value = '0x' + val.toString(16).toUpperCase();
    if (source !== 'bin') binInp.value = '0b' + val.toString(2);
}

// 4. Сохранение и загрузка файлов
function saveCodeToFile() {
    const code = document.getElementById('asmCode').value;
    const ext = currentLang === 'c' ? '.c' : '.asm';
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
        if (file.name.endsWith('.c')) setEditorLang('c');
        else setEditorLang('asm');
        updateSyntax();
        cpuReset();
    };
    reader.readAsText(file);
}

/* ================= 19. ПОДСВЕТКА И ГУТТЕР ================= */

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

/* ================= 20. БАЗА ПРОГРАММ ================= */

const PROGRAMS = {
    c_interrupt_int0: {
        hint: "Нажатие кнопки K1 (PD2, INT0) вызывает прерывание по спаду, инвертируя светодиоды RX и TX.",
        lang: "c",
        code: `// Внешнее прерывание INT0 по спаду (нажатие K1 на PD2)
#include <avr/io.h>
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

/* ================= 21. ИНИЦИАЛИЗАЦИЯ ================= */

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
