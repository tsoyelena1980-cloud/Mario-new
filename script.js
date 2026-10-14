'use strict';

/* =========================================================
   PIXEL QUEST — 2D Platformer
   Vanilla JS + Canvas. Single-file game engine.
   ========================================================= */

// ---------- Utility ----------
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp  = (a, b, t) => a + (b - a) * t;
const rand  = (a, b) => a + Math.random() * (b - a);

// ---------- Save system ----------
const SAVE_KEY = 'pixelquest_save_v1';

const defaultSave = () => ({
    best: 0,
    records: [],
    maxLevel: 1,
    sound: true,
    hasProgress: false
});

function loadSave() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return defaultSave();
        const data = JSON.parse(raw);
        const base = defaultSave();
        if (!data || typeof data !== 'object') return base;
        return {
            best:      typeof data.best === 'number' ? data.best : 0,
            records:   Array.isArray(data.records) ? data.records.filter(r =>
                          r && typeof r.name === 'string' &&
                          typeof r.score === 'number') : [],
            maxLevel:  typeof data.maxLevel === 'number' ? clamp(data.maxLevel, 1, 3) : 1,
            sound:     typeof data.sound === 'boolean' ? data.sound : true,
            hasProgress: !!data.hasProgress
        };
    } catch (e) {
        console.warn('Save load failed, using defaults', e);
        return defaultSave();
    }
}

function persistSave(save) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
    catch (e) { console.warn('Save failed', e); }
}

let SAVE = loadSave();

// ---------- Audio (Web Audio API) ----------
const Audio = (() => {
    let ctx = null;

    function ensureCtx() {
        if (!ctx) {
            try {
                ctx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) { ctx = null; }
        }
        if (ctx && ctx.state === 'suspended') ctx.resume();
    }

    function tone(freq, dur, type = 'square', vol = 0.15, slide = 0) {
        if (!SAVE.sound) return;
        ensureCtx();
        if (!ctx) return;
        try {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = type;
            const now = ctx.currentTime;
            o.frequency.setValueAtTime(freq, now);
            if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), now + dur);
            g.gain.setValueAtTime(vol, now);
            g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            o.connect(g); g.connect(ctx.destination);
            o.start(now); o.stop(now + dur + 0.02);
        } catch (e) {}
    }

    return {
        unlock() { ensureCtx(); },
        jump()   { tone(420, 0.12, 'square', 0.12, 320); },
        coin()   { tone(880, 0.07, 'square', 0.12); setTimeout(() => tone(1320, 0.09, 'square', 0.12), 60); },
        hurt()   { tone(220, 0.25, 'sawtooth', 0.18, -120); },
        stomp()  { tone(180, 0.10, 'square', 0.15, -60); },
        power()  { tone(660, 0.08, 'triangle', 0.15); setTimeout(() => tone(880, 0.08, 'triangle', 0.15), 70); setTimeout(() => tone(1180, 0.12, 'triangle', 0.15), 150); },
        level()  { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.14, 'triangle', 0.15), i * 110)); },
        lose()   { [400, 340, 280, 200].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'sawtooth', 0.16), i * 150)); },
        click()  { tone(600, 0.05, 'square', 0.1); }
    };
})();

// ---------- Input ----------
const Input = {
    keys: {},
    pressed: {},
    touch: { left: false, right: false, jump: false, run: false },

    init() {
        window.addEventListener('keydown', (e) => {
            const k = e.key.toLowerCase();
            if (['arrowleft','arrowright','arrowup','arrowdown',' ','space'].includes(k) ||
                ['a','d','w','s','p','r'].includes(k)) {
                e.preventDefault();
            }
            if (!this.keys[k]) this.pressed[k] = true;
            this.keys[k] = true;
            Audio.unlock();
        });
        window.addEventListener('keyup', (e) => {
            const k = e.key.toLowerCase();
            this.keys[k] = false;
        });
        window.addEventListener('blur', () => {
            this.keys = {};
            this.touch = { left: false, right: false, jump: false, run: false };
        });
    },

    left()  { return !!(this.keys['arrowleft'] || this.keys['a'] || this.touch.left); },
    right() { return !!(this.keys['arrowright'] || this.keys['d'] || this.touch.right); },
    run()   { return !!(this.keys['shift'] || this.touch.run); },
    jump()  { return !!(this.keys[' '] || this.keys['w'] || this.keys['arrowup'] || this.touch.jump); },
    jumpPressed() {
        return !!(this.pressed[' '] || this.pressed['w'] || this.pressed['arrowup'] || this.pressed['__jump_touch']);
    },
    clearPressed() { this.pressed = {}; },

    initTouch() {
        document.querySelectorAll('.touch-btn').forEach(btn => {
            const key = btn.dataset.key;
            const on  = (e) => {
                e.preventDefault();
                Audio.unlock();
                if (key === 'jump') { if (!this.touch.jump) this.pressed['__jump_touch'] = true; this.touch.jump = true; }
                else this.touch[key] = true;
            };
            const off = (e) => { e.preventDefault(); if (key === 'jump') this.touch.jump = false; else this.touch[key] = false; };
            btn.addEventListener('touchstart', on, { passive: false });
            btn.addEventListener('touchend', off, { passive: false });
            btn.addEventListener('touchcancel', off, { passive: false });
            btn.addEventListener('mousedown', on);
            btn.addEventListener('mouseup', off);
            btn.addEventListener('mouseleave', off);
        });
    }
};

// ---------- Canvas setup ----------
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let VIEW_W = 960, VIEW_H = 540;
let DPR = 1;

function resizeCanvas() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth  || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    canvas.width  = Math.floor(w * DPR);
    canvas.height = Math.floor(h * DPR);
    VIEW_W = w;
    VIEW_H = h;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resizeCanvas);

// ---------- Level generators ----------
const TS = 40;              // tile size
const TILE_ROWS = 12;       // 12 * 40 = 480 tall
const GROUND_ROW = 11;      // bottom row index
const GROUND_TOP = 10;      // second-to-bottom (ground top)

function makeGrid(width) {
    const g = [];
    for (let y = 0; y < TILE_ROWS; y++) g.push(new Array(width).fill('.'));
    return g;
}

function buildLevel1() {
    const W = 220;
    const g = makeGrid(W);
    for (let x = 0; x < W; x++) {
        if (x > 20 && x < 24) continue;
        if (x > 60 && x < 65) continue;
        if (x > 110 && x < 113) continue;
        g[GROUND_TOP][x] = 'G';
        g[GROUND_ROW][x] = 'G';
    }
    const add = (x, y, t) => { if (x >= 0 && x < W && y >= 0 && y < TILE_ROWS) g[y][x] = t; };
    [[8,7],[12,7],[16,7],[30,7],[34,7],[38,7],[80,7],[84,7],[88,7]].forEach(p => add(p[0], p[1], '?'));
    [[9,7],[11,7],[13,7],[31,7],[33,7],[35,7],[37,7],[81,7],[83,7],[85,7],[87,7]].forEach(p => add(p[0], p[1], 'B'));
    [[20,7],[22,7],[24,7],[26,7],[40,6],[42,6],[44,6]].forEach(p => add(p[0], p[1], 'P'));
    [[50,7],[52,7],[54,7],[56,7]].forEach(p => add(p[0], p[1], 'P'));
    [[70,6],[72,6],[74,6],[76,6]].forEach(p => add(p[0], p[1], 'P'));
    [[90,7],[92,7],[94,7]].forEach(p => add(p[0], p[1], 'P'));
    [[100,6],[102,6],[104,6],[106,6]].forEach(p => add(p[0], p[1], 'P'));
    [[115,7],[117,7],[119,7],[121,7]].forEach(p => add(p[0], p[1], 'P'));
    [[130,6],[132,6],[134,6]].forEach(p => add(p[0], p[1], 'P'));
    [[140,7],[142,7],[144,7],[146,7]].forEach(p => add(p[0], p[1], 'P'));
    [[160,6],[162,6],[164,6],[166,6]].forEach(p => add(p[0], p[1], 'P'));
    [[175,7],[177,7],[179,7]].forEach(p => add(p[0], p[1], 'P'));
    [[190,6],[192,6],[194,6],[196,6]].forEach(p => add(p[0], p[1], 'P'));
    [[28,10],[28,9],[28,8]].forEach(p => add(p[0], p[1], '|'));
    [[46,10],[46,9],[46,8],[46,7]].forEach(p => add(p[0], p[1], '|'));
    [[66,10],[66,9]].forEach(p => add(p[0], p[1], '|'));
    [[96,10],[96,9],[96,8]].forEach(p => add(p[0], p[1], '|'));
    [[126,10],[126,9]].forEach(p => add(p[0], p[1], '|'));
    [[150,10],[150,9],[150,8]].forEach(p => add(p[0], p[1], '|'));
    [[170,10],[170,9]].forEach(p => add(p[0], p[1], '|'));
    return g;
}

function buildLevel2() {
    const W = 240;
    const g = makeGrid(W);
    for (let x = 0; x < W; x++) {
        const skip = (x > 15 && x < 19) || (x > 38 && x < 43) || (x > 65 && x < 70) ||
                     (x > 95 && x < 101) || (x > 130 && x < 136) || (x > 165 && x < 171) ||
                     (x > 200 && x < 206);
        if (!skip) { g[GROUND_TOP][x] = 'G'; g[GROUND_ROW][x] = 'G'; }
    }
    const add = (x, y, t) => { if (x >= 0 && x < W && y >= 0 && y < TILE_ROWS) g[y][x] = t; };
    for (let i = 6; i < 12; i++) add(i, 7, i % 2 ? 'B' : '?');
    for (let i = 20; i < 26; i++) add(i, 6, i % 2 ? 'B' : '?');
    for (let i = 30; i < 36; i++) add(i, 7, i % 2 ? '?' : 'B');
    for (let i = 45; i < 51; i++) add(i, 5, i % 2 ? 'B' : '?');
    for (let i = 75; i < 81; i++) add(i, 7, i % 2 ? 'B' : '?');
    for (let i = 105; i < 111; i++) add(i, 6, i % 2 ? '?' : 'B');
    for (let i = 140; i < 146; i++) add(i, 7, i % 2 ? 'B' : '?');
    for (let i = 175; i < 181; i++) add(i, 6, i % 2 ? '?' : 'B');
    for (let x = 16; x <= 19; x++) add(x, 8, 'P');
    for (let x = 39; x <= 42; x++) add(x, 8, 'P');
    for (let x = 66; x <= 69; x++) add(x, 7, 'P');
    for (let x = 96; x <= 100; x++) add(x, 6, 'P');
    for (let x = 131; x <= 135; x++) add(x, 7, 'P');
    for (let x = 166; x <= 170; x++) add(x, 6, 'P');
    for (let x = 201; x <= 205; x++) add(x, 7, 'P');
    [30,31,32,80,81,82,150,151,152,190,191,192].forEach(x => add(x, GROUND_ROW, 'S'));
    for (let i = 0; i < 5; i++) for (let j = 0; j <= i; j++) add(55+i, GROUND_ROW-j, 'G');
    for (let i = 0; i < 5; i++) for (let j = 0; j <= i; j++) add(120+i, GROUND_ROW-j, 'G');
    for (let i = 0; i < 5; i++) for (let j = 0; j <= i; j++) add(185+i, GROUND_ROW-j, 'G');
    return g;
}

function buildLevel3() {
    const W = 260;
    const g = makeGrid(W);
    for (let x = 0; x < W; x++) {
        const skip = (x > 10 && x < 15) || (x > 30 && x < 36) || (x > 50 && x < 57) ||
                     (x > 72 && x < 79) || (x > 95 && x < 102) || (x > 118 && x < 125) ||
                     (x > 140 && x < 148) || (x > 165 && x < 173) || (x > 190 && x < 198) ||
                     (x > 215 && x < 223);
        if (!skip) { g[GROUND_TOP][x] = 'G'; g[GROUND_ROW][x] = 'G'; }
    }
    const add = (x, y, t) => { if (x >= 0 && x < W && y >= 0 && y < TILE_ROWS) g[y][x] = t; };
    const isle = (x0, y, w) => { for (let x = x0; x < x0 + w; x++) add(x, y, 'P'); };
    isle(12, 8, 4); isle(32, 7, 5); isle(52, 8, 6); isle(74, 6, 6);
    isle(97, 8, 6); isle(120, 7, 6); isle(142, 8, 7); isle(167, 6, 7);
    isle(192, 8, 7); isle(217, 7, 7);
    const positions = [[15,5],[35,4],[55,5],[78,3],[100,5],[123,4],[145,5],[170,3],[195,5],[220,4]];
    positions.forEach(p => { for (let c = 0; c < 3; c++) add(p[0]+c, p[1], '?'); });
    for (let i = 0; i < 6; i++) for (let j = 0; j <= i; j++) add(40+i, GROUND_ROW-j, 'G');
    for (let i = 0; i < 6; i++) for (let j = 0; j <= i; j++) add(105+i, GROUND_ROW-j, 'G');
    for (let i = 0; i < 6; i++) for (let j = 0; j <= i; j++) add(180+i, GROUND_ROW-j, 'G');
    return g;
}

const LEVELS = [
    {
        name: 'Зелёные холмы',
        width: 220,
        theme: 'day',
        time: 300,
        spawn: { x: 60, y: 300 },
        goal: { x: 218 * TS, y: GROUND_TOP * TS },
        data: buildLevel1(),
        enemies: [
            { type: 'walker', x: 500, y: 360, minX: 400, maxX: 700 },
            { type: 'walker', x: 900, y: 360, minX: 800, maxX: 1100 },
            { type: 'jumper', x: 1500, y: 360, minX: 1400, maxX: 1750 },
            { type: 'walker', x: 2200, y: 360, minX: 2100, maxX: 2500 },
            { type: 'walker', x: 3200, y: 360, minX: 3100, maxX: 3450 },
            { type: 'jumper', x: 4200, y: 360, minX: 4100, maxX: 4400 },
            { type: 'walker', x: 5200, y: 360, minX: 5050, maxX: 5400 }
        ],
        coins: [
            { x: 350, y: 340 }, { x: 400, y: 300 }, { x: 450, y: 260 },
            { x: 750, y: 300 }, { x: 800, y: 300 }, { x: 850, y: 300 },
            { x: 1200, y: 260 }, { x: 1250, y: 260 },
            { x: 1800, y: 310 }, { x: 1850, y: 280 }, { x: 1900, y: 250 },
            { x: 2600, y: 340 }, { x: 2650, y: 310 },
            { x: 3300, y: 260 }, { x: 3350, y: 230 }, { x: 3400, y: 200 },
            { x: 4500, y: 300 }, { x: 4550, y: 270 },
            { x: 5600, y: 340 }, { x: 5650, y: 310 }, { x: 5700, y: 280 }
        ],
        powerups: [
            { type: 'speed', x: 1300, y: 200 },
            { type: 'shield', x: 3800, y: 300 },
            { type: 'life', x: 6000, y: 340 }
        ]
    },
    {
        name: 'Пещеры',
        width: 240,
        theme: 'cave',
        time: 320,
        spawn: { x: 60, y: 300 },
        goal: { x: 238 * TS, y: GROUND_TOP * TS },
        data: buildLevel2(),
        enemies: [
            { type: 'walker', x: 550, y: 360, minX: 450, maxX: 750 },
            { type: 'jumper', x: 950, y: 360, minX: 850, maxX: 1200 },
            { type: 'walker', x: 1600, y: 360, minX: 1500, maxX: 1850 },
            { type: 'jumper', x: 2200, y: 360, minX: 2100, maxX: 2450 },
            { type: 'walker', x: 2900, y: 360, minX: 2800, maxX: 3200 },
            { type: 'jumper', x: 3600, y: 360, minX: 3500, maxX: 3900 },
            { type: 'walker', x: 4400, y: 360, minX: 4300, maxX: 4700 },
            { type: 'jumper', x: 5200, y: 360, minX: 5100, maxX: 5500 },
            { type: 'walker', x: 6200, y: 360, minX: 6100, maxX: 6500 },
            { type: 'jumper', x: 7200, y: 360, minX: 7100, maxX: 7500 }
        ],
        coins: [
            { x: 300, y: 280 }, { x: 400, y: 260 }, { x: 500, y: 240 },
            { x: 700, y: 220 }, { x: 800, y: 200 },
            { x: 1100, y: 260 }, { x: 1200, y: 230 }, { x: 1300, y: 200 },
            { x: 1700, y: 280 }, { x: 1800, y: 260 },
            { x: 2500, y: 240 }, { x: 2600, y: 210 }, { x: 2700, y: 180 },
            { x: 3400, y: 260 }, { x: 3500, y: 230 },
            { x: 4200, y: 260 }, { x: 4300, y: 230 }, { x: 4400, y: 200 },
            { x: 5500, y: 280 }, { x: 5600, y: 250 },
            { x: 6600, y: 260 }, { x: 6700, y: 230 },
            { x: 7600, y: 280 }, { x: 7700, y: 250 }, { x: 7800, y: 220 }
        ],
        powerups: [
            { type: 'speed', x: 1900, y: 200 },
            { type: 'shield', x: 4800, y: 260 },
            { type: 'life', x: 7000, y: 320 }
        ]
    },
    {
        name: 'Небесный путь',
        width: 260,
        theme: 'sunset',
        time: 340,
        spawn: { x: 60, y: 300 },
        goal: { x: 258 * TS, y: GROUND_TOP * TS },
        data: buildLevel3(),
        enemies: [
            { type: 'walker', x: 400, y: 360, minX: 300, maxX: 600 },
            { type: 'jumper', x: 700, y: 360, minX: 650, maxX: 900 },
            { type: 'walker', x: 1400, y: 360, minX: 1300, maxX: 1600 },
            { type: 'jumper', x: 2100, y: 360, minX: 2000, maxX: 2300 },
            { type: 'walker', x: 2800, y: 360, minX: 2700, maxX: 3050 },
            { type: 'jumper', x: 3500, y: 360, minX: 3400, maxX: 3750 },
            { type: 'walker', x: 4200, y: 360, minX: 4100, maxX: 4500 },
            { type: 'jumper', x: 5000, y: 360, minX: 4900, maxX: 5250 },
            { type: 'walker', x: 5800, y: 360, minX: 5700, maxX: 6100 },
            { type: 'jumper', x: 6600, y: 360, minX: 6500, maxX: 6900 },
            { type: 'walker', x: 7500, y: 360, minX: 7400, maxX: 7800 },
            { type: 'jumper', x: 8400, y: 360, minX: 8300, maxX: 8700 }
        ],
        coins: [
            { x: 250, y: 300 }, { x: 350, y: 270 }, { x: 450, y: 240 },
            { x: 800, y: 220 }, { x: 900, y: 200 },
            { x: 1500, y: 240 }, { x: 1600, y: 210 },
            { x: 2200, y: 260 }, { x: 2300, y: 230 },
            { x: 3000, y: 240 }, { x: 3100, y: 210 },
            { x: 3700, y: 220 }, { x: 3800, y: 190 },
            { x: 4400, y: 260 }, { x: 4500, y: 230 }, { x: 4600, y: 200 },
            { x: 5200, y: 280 }, { x: 5300, y: 250 },
            { x: 6000, y: 220 }, { x: 6100, y: 190 },
            { x: 6800, y: 260 }, { x: 6900, y: 230 },
            { x: 7700, y: 280 }, { x: 7800, y: 250 }, { x: 7900, y: 220 },
            { x: 8700, y: 240 }, { x: 8800, y: 210 }, { x: 8900, y: 180 }
        ],
        powerups: [
            { type: 'speed', x: 2600, y: 200 },
            { type: 'shield', x: 5400, y: 240 },
            { type: 'life', x: 8200, y: 320 }
        ]
    }
];

// ---------- Camera ----------
class Camera {
    constructor() { this.x = 0; }
    follow(player, levelWidth, viewW) {
        const targetX = clamp(player.x + player.w / 2 - viewW * 0.38, 0, Math.max(0, levelWidth - viewW));
        this.x = lerp(this.x, targetX, 0.14);
        if (Math.abs(this.x - targetX) < 0.5) this.x = targetX;
    }
}

// ---------- Solid check ----------
const SOLID_TYPES = { G: 1, B: 1, '?': 1, P: 1, '|': 1, '!': 1, S: 1, U: 1 };
function isSolidTile(level, tx, ty) {
    if (!level || !level.data) return false;
    if (ty < 0 || ty >= level.data.length) return false;
    const row = level.data[ty];
    if (!row) return false;
    if (tx < 0 || tx >= row.length) return false;
    return !!SOLID_TYPES[row[tx]];
}

// ---------- AABB collision helper for entities ----------
function tileCollideX(ent, level, dt) {
    ent.x += ent.vx * dt;
    const x0 = Math.floor(ent.x / TS);
    const x1 = Math.floor((ent.x + ent.w - 1) / TS);
    const y0 = Math.floor(ent.y / TS);
    const y1 = Math.floor((ent.y + ent.h - 1) / TS);
    for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
            if (!isSolidTile(level, tx, ty)) continue;
            if (ent.vx > 0) {
                ent.x = tx * TS - ent.w;
                ent.vx = 0;
                return true;
            } else if (ent.vx < 0) {
                ent.x = (tx + 1) * TS;
                ent.vx = 0;
                return true;
            }
        }
    }
    return false;
}

function tileCollideY(ent, level, dt) {
    ent.y += ent.vy * dt;
    ent.onGround = false;
    const x0 = Math.floor(ent.x / TS);
    const x1 = Math.floor((ent.x + ent.w - 1) / TS);
    const y0 = Math.floor(ent.y / TS);
    const y1 = Math.floor((ent.y + ent.h - 1) / TS);
    for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
            if (!isSolidTile(level, tx, ty)) continue;
            if (ent.vy > 0) {
                ent.y = ty * TS - ent.h;
                ent.vy = 0;
                ent.onGround = true;
                return 'floor';
            } else if (ent.vy < 0) {
                ent.y = (ty + 1) * TS;
                ent.vy = 0;
                return 'ceiling';
            }
        }
    }
    return null;
}

// ---------- Player ----------
class Player {
    constructor(x, y) {
        this.startX = x;
        this.startY = y;
        this.w = 28;
        this.h = 40;
        this.reset(x, y);
        this.invuln = 0;
        this.speedBoost = 0;
        this.shield = 0;
        this.animTime = 0;
        this.facing = 1;
    }
    reset(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.onGround = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.jumpCutoff = false;
    }

    update(dt, level) {
        const left = Input.left();
        const right = Input.right();
        const running = Input.run();
        const maxSpeed = running ? 340 : 220;
        const accel = this.onGround ? 1800 : 1100;
        const friction = this.onGround ? 2400 : 300;

        if (left && !right) { this.vx -= accel * dt; this.facing = -1; }
        else if (right && !left) { this.vx += accel * dt; this.facing = 1; }
        else {
            if (this.vx > 0) this.vx = Math.max(0, this.vx - friction * dt);
            else if (this.vx < 0) this.vx = Math.min(0, this.vx - friction * dt);
        }
        const speedMul = this.speedBoost > 0 ? 1.6 : 1;
        const limit = maxSpeed * speedMul;
        this.vx = clamp(this.vx, -limit, limit);

        // jump buffer
        if (Input.jumpPressed()) this.jumpBuffer = 0.12;
        else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

        // coyote
        if (this.onGround) this.coyote = 0.10;
        else this.coyote = Math.max(0, this.coyote - dt);

        // jump
        if (this.jumpBuffer > 0 && this.coyote > 0) {
            this.vy = -560;
            this.onGround = false;
            this.coyote = 0;
            this.jumpBuffer = 0;
            this.jumpCutoff = false;
            Audio.jump();
        }

        if (this.vy < 0 && !Input.jump()) this.jumpCutoff = true;
        if (this.jumpCutoff && this.vy < -100) this.vy += 2200 * dt;

        // gravity
        const gravity = this.vy < 0 ? 1700 : 2100;
        this.vy += gravity * dt;
        this.vy = Math.min(this.vy, 1200);

        // integrate
        tileCollideX(this, level, dt);
        const yHit = tileCollideY(this, level, dt);
        if (yHit === 'floor' && this.vy === 0) {
            // spawn dust on hard landings
        }

        // world bounds
        if (this.x < 0) { this.x = 0; this.vx = 0; }
        const maxX = level.data[0].length * TS - this.w;
        if (this.x > maxX) { this.x = maxX; this.vx = 0; }

        if (this.y > 700) this.hurt(null);

        if (this.invuln > 0) this.invuln -= dt;
        if (this.speedBoost > 0) this.speedBoost -= dt;
        if (this.shield > 0) this.shield -= dt;
        this.animTime += dt;
    }

    hurt() {
        if (this.invuln > 0 || this.shield > 0) return false;
        this.invuln = 1.4;
        Audio.hurt();
        if (Game.lives > 0) {
            Game.lives--;
            if (Game.lives <= 0) {
                Game.gameOver();
                return true;
            } else {
                if (Game.checkpoint) {
                    this.reset(Game.checkpoint.x, Game.checkpoint.y);
                } else {
                    this.reset(this.startX, this.startY);
                }
                return true;
            }
        }
        return false;
    }

    draw(ctx) {
        if (this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0) return;
        drawPlayerSprite(ctx, this.x, this.y, this.w, this.h, {
            facing: this.facing,
            onGround: this.onGround,
            vx: this.vx,
            vy: this.vy,
            animTime: this.animTime,
            shield: this.shield > 0,
            speed: this.speedBoost > 0
        });
    }
}

// ---------- Enemy ----------
class Enemy {
    constructor(cfg) {
        this.type = cfg.type || 'walker';
        this.x = cfg.x; this.y = cfg.y;
        this.w = 32; this.h = 32;
        this.vx = this.type === 'jumper' ? -80 : -60;
        this.vy = 0;
        this.minX = cfg.minX;
        this.maxX = cfg.maxX;
        this.onGround = false;
        this.alive = true;
        this.animTime = 0;
        this.jumpCooldown = rand(0.5, 2);
    }

    update(dt, level) {
        if (!this.alive) return;
        this.animTime += dt;

        if (this.type === 'jumper') {
            this.jumpCooldown -= dt;
            if (this.onGround && this.jumpCooldown <= 0) {
                this.vy = -450;
                this.jumpCooldown = rand(1.2, 2.4);
            }
        } else {
            const dx = (Game.player.x + Game.player.w/2) - (this.x + this.w/2);
            if (Math.abs(dx) < 220 && Math.abs(Game.player.y - this.y) < 60) {
                this.vx = dx > 0 ? 90 : -90;
            } else {
                if (Math.abs(this.vx) < 50) this.vx = this.vx < 0 ? -60 : 60;
            }
        }

        this.vy += 1800 * dt;
        if (this.vy > 900) this.vy = 900;

        // horizontal
        let nx = this.x + this.vx * dt;
        if (nx < this.minX) { nx = this.minX; this.vx = Math.abs(this.vx); }
        if (nx + this.w > this.maxX) { nx = this.maxX - this.w; this.vx = -Math.abs(this.vx); }

        const oldX = this.x;
        this.x = nx;
        if (tileCollideX(this, level, 0)) {
            this.vx *= -1;
            this.x = oldX;
        } else {
            this.x = nx;
        }

        tileCollideY(this, level, dt);

        if (this.y > 700) this.alive = false;

        // edge detection for walkers
        if (this.type === 'walker' && this.onGround && this.vx !== 0) {
            const aheadX = this.vx > 0 ? this.x + this.w + 4 : this.x - 4;
            const belowY = this.y + this.h + 4;
            const tx = Math.floor(aheadX / TS);
            const ty = Math.floor(belowY / TS);
            if (!isSolidTile(level, tx, ty)) this.vx *= -1;
        }
    }

    draw(ctx) {
        if (!this.alive) return;
        drawEnemySprite(ctx, this.x, this.y, this.w, this.h, this);
    }
}

// ---------- Particles ----------
const particles = [];
function spawnDust(x, y, n = 4) {
    for (let i = 0; i < n; i++) {
        particles.push({
            x, y,
            vx: rand(-80, 80), vy: rand(-140, -40),
            life: rand(0.3, 0.6), maxLife: 0.6,
            color: '#c8b898', size: rand(2, 4), gravity: 500
        });
    }
}
function spawnBrickDebris(x, y, color) {
    for (let i = 0; i < 8; i++) {
        particles.push({
            x: x + rand(0, 32), y: y + rand(0, 32),
            vx: rand(-180, 180), vy: rand(-320, -80),
            life: rand(0.6, 1.0), maxLife: 1.0,
            color, size: rand(3, 6), gravity: 900
        });
    }
}
function spawnCoinSparkle(x, y) {
    for (let i = 0; i < 6; i++) {
        particles.push({
            x, y,
            vx: rand(-120, 120), vy: rand(-200, -60),
            life: rand(0.3, 0.5), maxLife: 0.5,
            color: '#ffd93d', size: rand(2, 4), gravity: 400
        });
    }
}
function spawnEnemyPoof(x, y) {
    for (let i = 0; i < 10; i++) {
        particles.push({
            x, y,
            vx: rand(-180, 180), vy: rand(-260, -40),
            life: rand(0.4, 0.7), maxLife: 0.7,
            color: i % 2 ? '#ffffff' : '#ff8a3a', size: rand(3, 6), gravity: 500
        });
    }
}
function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}
function drawParticles(ctx) {
    for (const p of particles) {
        const a = clamp(p.life / p.maxLife, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
}

// ---------- Collectibles ----------
class Coin {
    constructor(x, y) {
        this.x = x; this.y = y;
        this.w = 24; this.h = 24;
        this.collected = false;
        this.t = rand(0, Math.PI * 2);
        this.baseY = y;
    }
    update(dt) { this.t += dt * 4; this.y = this.baseY + Math.sin(this.t) * 3; }
    draw(ctx) { drawCoin(ctx, this.x, this.y, this.w, this.h, this.t); }
}

class PowerUp {
    constructor(type, x, y) {
        this.type = type; this.x = x; this.y = y;
        this.w = 28; this.h = 28;
        this.collected = false;
        this.t = rand(0, Math.PI * 2);
        this.baseY = y;
    }
    update(dt) { this.t += dt * 3; this.y = this.baseY + Math.sin(this.t) * 4; }
    draw(ctx) { drawPowerUp(ctx, this.x, this.y, this.w, this.h, this.type, this.t); }
}

// ---------- Question blocks ----------
function hitQuestionBlock(level, tx, ty, powerups) {
    const key = tx + ',' + ty;
    if (!level.hitBlocks) level.hitBlocks = {};
    if (level.hitBlocks[key]) return;
    level.hitBlocks[key] = true;

    if (Math.random() < 0.75) {
        Game.addCoin();
        spawnCoinSparkle(tx * TS + 20, ty * TS + 20);
        Audio.coin();
    } else {
        const type = ['speed','shield','life'][Math.floor(Math.random()*3)];
        powerups.push(new PowerUp(type, tx * TS + 6, ty * TS - 32));
    }
    level.data[ty][tx] = 'U';
    spawnBrickDebris(tx * TS, ty * TS, '#ffb43a');
}

// ---------- Rendering ----------
function drawSky(ctx, theme, w, h) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (theme === 'day')    { grad.addColorStop(0, '#5fb8ff'); grad.addColorStop(0.6, '#a8e0ff'); grad.addColorStop(1, '#ddf3ff'); }
    if (theme === 'cave')   { grad.addColorStop(0, '#1a0f3a'); grad.addColorStop(0.6, '#3a2a6a'); grad.addColorStop(1, '#5a3a8a'); }
    if (theme === 'sunset') { grad.addColorStop(0, '#ff7e9c'); grad.addColorStop(0.5, '#ffb48a'); grad.addColorStop(1, '#ffd9a0'); }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
}

function drawParallax(ctx, camX, theme, w, h) {
    if (theme === 'day') {
        ctx.fillStyle = '#fff6c8';
        ctx.beginPath(); ctx.arc(w * 0.78, h * 0.18, 46, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,246,200,0.25)';
        ctx.beginPath(); ctx.arc(w * 0.78, h * 0.18, 72, 0, Math.PI * 2); ctx.fill();
    } else if (theme === 'sunset') {
        ctx.fillStyle = '#ffdf88';
        ctx.beginPath(); ctx.arc(w * 0.7, h * 0.55, 90, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,180,120,0.3)';
        ctx.beginPath(); ctx.arc(w * 0.7, h * 0.55, 130, 0, Math.PI * 2); ctx.fill();
    } else if (theme === 'cave') {
        ctx.fillStyle = '#2a1b4a';
        for (let i = 0; i < 20; i++) {
            const x = (i * 137 - camX * 0.2) % (w + 200) - 100;
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x + 20, 0); ctx.lineTo(x + 10, 60 + (i % 3) * 20);
            ctx.closePath(); ctx.fill();
        }
    }

    ctx.fillStyle = theme === 'cave' ? '#221440' : (theme === 'sunset' ? '#b8556e' : '#4a8fc8');
    const offset1 = -(camX * 0.15) % 400;
    for (let i = -1; i < w / 400 + 2; i++) {
        const bx = offset1 + i * 400;
        ctx.beginPath();
        ctx.moveTo(bx, h); ctx.lineTo(bx + 200, h * 0.5); ctx.lineTo(bx + 400, h);
        ctx.closePath(); ctx.fill();
    }

    ctx.fillStyle = theme === 'cave' ? '#3a2a6a' : (theme === 'sunset' ? '#8a3a5a' : '#68b06a');
    const offset2 = -(camX * 0.35) % 300;
    for (let i = -1; i < w / 300 + 2; i++) {
        const bx = offset2 + i * 300;
        ctx.beginPath();
        ctx.moveTo(bx, h); ctx.quadraticCurveTo(bx + 150, h * 0.62, bx + 300, h);
        ctx.closePath(); ctx.fill();
    }

    const offset3 = -(camX * 0.55) % 260;
    for (let i = -1; i < w / 260 + 2; i++) {
        const bx = offset3 + i * 260;
        drawBush(ctx, bx + 40, h * 0.82, 1);
        drawBush(ctx, bx + 180, h * 0.84, 1.2);
    }
}

function drawBush(ctx, x, y, scale) {
    ctx.fillStyle = '#2f7a3a';
    ctx.beginPath();
    ctx.arc(x, y, 30 * scale, Math.PI, 0);
    ctx.arc(x + 30 * scale, y, 26 * scale, Math.PI, 0);
    ctx.arc(x - 30 * scale, y, 26 * scale, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#3fa04a';
    ctx.beginPath();
    ctx.arc(x - 8, y - 6, 20 * scale, 0, Math.PI * 2);
    ctx.arc(x + 14, y - 4, 16 * scale, 0, Math.PI * 2);
    ctx.fill();
}

function drawTile(ctx, tx, ty, type, level) {
    const x = tx * TS, y = ty * TS;
    if (type === 'G') {
        ctx.fillStyle = '#7a4a20';
        ctx.fillRect(x, y, TS, TS);
        ctx.fillStyle = '#5a3416';
        ctx.fillRect(x + 4, y + 8, 4, 4);
        ctx.fillRect(x + 20, y + 18, 5, 5);
        ctx.fillRect(x + 12, y + 28, 4, 4);
        if (!isSolidTile(level, tx, ty - 1) || level.data[ty-1][tx] !== 'G') {
            ctx.fillStyle = '#4caf50';
            ctx.fillRect(x, y, TS, 8);
            ctx.fillStyle = '#6fdc70';
            ctx.fillRect(x, y, TS, 4);
            ctx.fillStyle = '#3e8e40';
            for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 10 + 2, y - 4, 2, 5);
        }
    } else if (type === 'B') {
        ctx.fillStyle = '#b8492a';
        ctx.fillRect(x, y, TS, TS);
        ctx.fillStyle = '#8a2a10';
        ctx.fillRect(x, y, TS, 3);
        ctx.fillRect(x, y + TS/2 - 1, TS, 3);
        ctx.fillRect(x + TS/2 - 1, y, 3, TS/2);
        ctx.fillRect(x + TS/4 - 1, y + TS/2, 3, TS/2);
        ctx.fillRect(x + 3*TS/4 - 1, y + TS/2, 3, TS/2);
        ctx.fillStyle = '#e8704a';
        ctx.fillRect(x + 2, y + 4, 6, 2);
    } else if (type === '?') {
        const t = Date.now() / 400;
        const pulse = 0.5 + Math.sin(t) * 0.1;
        ctx.fillStyle = '#d88a10';
        ctx.fillRect(x, y, TS, TS);
        ctx.fillStyle = '#f0b030';
        ctx.fillRect(x, y, TS, TS - 4);
        ctx.fillStyle = '#a05a00';
        ctx.fillRect(x, y + TS - 4, TS, 4);
        ctx.fillRect(x + 4, y + 4, 3, 3);
        ctx.fillRect(x + TS - 7, y + 4, 3, 3);
        ctx.fillRect(x + 4, y + TS - 9, 3, 3);
        ctx.fillRect(x + TS - 7, y + TS - 9, 3, 3);
        ctx.fillStyle = '#fff8d0';
        ctx.globalAlpha = 0.6 + pulse * 0.4;
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', x + TS/2, y + TS/2 + 1);
        ctx.globalAlpha = 1;
    } else if (type === 'U') {
        ctx.fillStyle = '#8a6a3a';
        ctx.fillRect(x, y, TS, TS);
        ctx.strokeStyle = '#5a3a1a';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, TS - 2, TS - 2);
        ctx.fillStyle = '#6a4a2a';
        ctx.fillRect(x + 8, y + 8, TS - 16, TS - 16);
    } else if (type === 'P') {
        ctx.fillStyle = '#9b5a2a';
        ctx.fillRect(x, y, TS, TS);
        ctx.fillStyle = '#c87a3a';
        ctx.fillRect(x, y, TS, 6);
        ctx.fillStyle = '#7a3a10';
        ctx.fillRect(x, y + TS - 4, TS, 4);
        ctx.fillStyle = '#b06a30';
        for (let i = 0; i < 2; i++) ctx.fillRect(x + 8 + i * 16, y + 16, 8, 8);
    } else if (type === '|' || type === '!') {
        const above = level.data[ty-1] && level.data[ty-1][tx];
        const isTop = above !== '|' && above !== '!';
        ctx.fillStyle = '#2a9a2a';
        ctx.fillRect(x, y, TS, TS);
        ctx.fillStyle = '#1a6a1a';
        ctx.fillRect(x + TS - 8, y, 8, TS);
        ctx.fillStyle = '#5adb5a';
        ctx.fillRect(x, y, 6, TS);
        if (isTop) {
            ctx.fillStyle = '#2a9a2a';
            ctx.fillRect(x - 4, y, TS + 8, 12);
            ctx.fillStyle = '#1a6a1a';
            ctx.fillRect(x - 4, y + 10, TS + 8, 4);
            ctx.fillStyle = '#5adb5a';
            ctx.fillRect(x - 4, y, 4, 12);
        }
    } else if (type === 'S') {
        ctx.fillStyle = '#a0a0a0';
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(x + i * 10, y + TS);
            ctx.lineTo(x + i * 10 + 5, y + 8);
            ctx.lineTo(x + i * 10 + 10, y + TS);
            ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = '#606060';
        ctx.fillRect(x, y + TS - 4, TS, 4);
    }
}

function drawCoin(ctx, x, y, w, h, t) {
    const cx = x + w/2, cy = y + h/2;
    const sx = Math.abs(Math.cos(t)) * 0.9 + 0.1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sx, 1);
    ctx.fillStyle = '#ffd93d';
    ctx.beginPath(); ctx.arc(0, 0, w/2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffb000';
    ctx.beginPath(); ctx.arc(0, 0, w/2 - 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff8d0';
    ctx.fillRect(-2, -6, 4, 12);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,200,0.6)';
    ctx.fillRect(cx - 2, cy - h/2 - 2, 4, 4);
}

function drawPowerUp(ctx, x, y, w, h, type, t) {
    const cx = x + w/2, cy = y + h/2;
    const colors = { speed: '#4af0ff', shield: '#a07aff', life: '#ff5a7a' };
    const c = colors[type] || '#ffffff';
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(t) * 0.2);
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(0, 0, w * 0.85, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = c;
    ctx.fillRect(-w/2, -h/2, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(-w/2, -h/2, w, 4);
    ctx.fillStyle = '#0a0a1a';
    if (type === 'speed') {
        ctx.beginPath();
        ctx.moveTo(-3, -8); ctx.lineTo(4, -2); ctx.lineTo(0, -2);
        ctx.lineTo(3, 8); ctx.lineTo(-4, 1); ctx.lineTo(0, 1);
        ctx.closePath(); ctx.fill();
    } else if (type === 'shield') {
        ctx.beginPath();
        ctx.moveTo(0, -8); ctx.lineTo(7, -4); ctx.lineTo(7, 3);
        ctx.quadraticCurveTo(7, 8, 0, 9);
        ctx.quadraticCurveTo(-7, 8, -7, 3); ctx.lineTo(-7, -4);
        ctx.closePath(); ctx.fill();
    } else if (type === 'life') {
        ctx.fillRect(-6, -6, 4, 12);
        ctx.fillRect(2, -6, 4, 12);
        ctx.fillRect(-2, -2, 4, 4);
    }
    ctx.restore();
}

function drawPlayerSprite(ctx, x, y, w, h, state) {
    const { facing, onGround, vx, animTime, shield, speed } = state;
    let legA = 0, legB = 0, armA = 0, armB = 0;
    if (onGround && Math.abs(vx) > 10) {
        const phase = animTime * 10;
        legA = Math.sin(phase) * 6;
        legB = -legA;
        armA = Math.sin(phase + Math.PI) * 5;
        armB = -armA;
    } else if (!onGround) {
        legA = 4; legB = -4;
        armA = -8; armB = 4;
    } else {
        const b = Math.sin(animTime * 3) * 0.6;
        armA = b; armB = -b;
    }

    ctx.save();
    ctx.translate(x + w/2, y + h);

    if (onGround) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(0, 2, w * 0.6, 4, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    if (facing === -1) ctx.scale(-1, 1);

    if (shield) {
        const t = Date.now() / 200;
        ctx.strokeStyle = `rgba(160,122,255,${0.5 + Math.sin(t)*0.3})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, -h/2, w * 0.85, h * 0.7, 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    if (speed && Math.abs(vx) > 100) {
        ctx.strokeStyle = 'rgba(74,240,255,0.6)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(-w/2 - 8 - i*4, -h/2 + i*8);
            ctx.lineTo(-w/2 - 20 - i*4, -h/2 + i*8);
            ctx.stroke();
        }
    }

    // legs
    ctx.fillStyle = '#1a3a8a';
    ctx.fillRect(-8, -12, 6, 12 + legA);
    ctx.fillRect(2, -12, 6, 12 + legB);
    ctx.fillStyle = '#7a2a10';
    ctx.fillRect(-10, -12 + legA, 10, 4);
    ctx.fillRect(0, -12 + legB, 10, 4);

    // body
    ctx.fillStyle = '#e84040';
    ctx.fillRect(-9, -28, 18, 16);
    ctx.fillStyle = '#2a5ac8';
    ctx.fillRect(-9, -22, 18, 10);
    ctx.fillRect(-7, -30, 4, 10);
    ctx.fillRect(3, -30, 4, 10);

    // arms
    ctx.fillStyle = '#e84040';
    ctx.fillRect(-12, -26 + armA, 4, 10);
    ctx.fillRect(8, -26 + armB, 4, 10);
    ctx.fillStyle = '#f5e6d0';
    ctx.fillRect(-13, -18 + armA, 5, 5);
    ctx.fillRect(8, -18 + armB, 5, 5);

    // head
    ctx.fillStyle = '#f5c8a0';
    ctx.fillRect(-9, -42, 18, 14);
    ctx.fillStyle = '#d02020';
    ctx.fillRect(-10, -46, 20, 6);
    ctx.fillRect(-12, -42, 6, 3);
    ctx.fillRect(6, -42, 8, 4);
    ctx.fillStyle = '#a01010';
    ctx.fillRect(-10, -41, 20, 2);
    ctx.fillStyle = '#1a1a2a';
    ctx.fillRect(2, -38, 3, 4);
    ctx.fillRect(-5, -38, 3, 4);
    ctx.fillStyle = '#3a2a10';
    ctx.fillRect(-4, -31, 10, 3);

    ctx.restore();
}

function drawEnemySprite(ctx, x, y, w, h, enemy) {
    const t = enemy.animTime;
    const isJumper = enemy.type === 'jumper';
    const bob = Math.sin(t * 8) * 1.5;
    const legPhase = Math.sin(t * 12) * 4;

    ctx.save();
    ctx.translate(x + w/2, y + h);

    if (enemy.onGround) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(0, 2, w * 0.5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    if (isJumper) {
        ctx.fillStyle = '#6a3ac8';
        ctx.beginPath(); ctx.arc(0, -h/2 + bob, w * 0.55, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#a07aff';
        ctx.beginPath(); ctx.arc(-3, -h/2 + bob - 2, w * 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(-5, -h/2 - 2 + bob, 5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(5, -h/2 - 2 + bob, 5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#1a1a2a';
        ctx.beginPath(); ctx.arc(-5, -h/2 - 2 + bob, 2.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(5, -h/2 - 2 + bob, 2.5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#3a1a7a';
        ctx.fillRect(-8, -6, 6, 6 + legPhase);
        ctx.fillRect(2, -6, 6, 6 - legPhase);
        ctx.fillStyle = '#3a1a7a';
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(-w*0.4 + i * 8, -h/2 - 2 + bob);
            ctx.lineTo(-w*0.4 + i * 8 + 4, -h/2 - 12 + bob);
            ctx.lineTo(-w*0.4 + i * 8 + 8, -h/2 - 2 + bob);
            ctx.closePath(); ctx.fill();
        }
    } else {
        ctx.fillStyle = '#b8452a';
        ctx.beginPath(); ctx.ellipse(0, -h/2 + bob, w * 0.55, h * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e8704a';
        ctx.beginPath(); ctx.ellipse(-2, -h/2 - 2 + bob, w * 0.4, h * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(-6, -h/2 - 4 + bob, 4, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(6, -h/2 - 4 + bob, 4, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#1a1a2a';
        ctx.beginPath(); ctx.arc(-6, -h/2 - 4 + bob, 2, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(6, -h/2 - 4 + bob, 2, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#7a2a10';
        ctx.fillRect(-9, -6, 7, 6 + legPhase);
        ctx.fillRect(2, -6, 7, 6 - legPhase);
        ctx.strokeStyle = '#7a2a10';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-4, -h/2 - 4 + bob); ctx.lineTo(-8, -h/2 - 12 + bob); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(4, -h/2 - 4 + bob); ctx.lineTo(8, -h/2 - 12 + bob); ctx.stroke();
    }

    ctx.restore();
}

function drawFlag(ctx, x, y) {
    ctx.fillStyle = '#c0c0d0';
    ctx.fillRect(x, y - 200, 6, 240);
    ctx.fillStyle = '#ffd93d';
    ctx.beginPath(); ctx.arc(x + 3, y - 204, 10, 0, Math.PI * 2); ctx.fill();
    const t = Date.now() / 200;
    ctx.fillStyle = '#e84040';
    ctx.beginPath();
    ctx.moveTo(x + 6, y - 196);
    for (let i = 0; i <= 10; i++) {
        ctx.lineTo(x + 6 + i * 5, y - 196 + Math.sin(t + i * 0.5) * 3 + i * 0.5);
    }
    for (let i = 10; i >= 0; i--) {
        ctx.lineTo(x + 6 + i * 5, y - 156 + Math.sin(t + i * 0.5) * 3 + i * 0.5);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd93d';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('★', x + 30, y - 168);
}

// ---------- Game ----------
const Game = {
    state: 'menu',
    levelIndex: 0,
    level: null,
    camera: new Camera(),
    player: null,
    enemies: [],
    coins: [],
    powerups: [],
    timeLeft: 0,
    score: 0,
    coinsCollected: 0,
    lives: 3,
    checkpoint: null,
    totalTime: 0,
    playerName: '',
    savedThisRun: false,
    lastTime: 0,
    levelPixelWidth: 0,

    init() {
        resizeCanvas();
        Input.init();
        Input.initTouch();

        document.getElementById('btn-play').onclick     = () => { Audio.unlock(); Audio.click(); this.startNewGame(1); };
        document.getElementById('btn-continue').onclick = () => { Audio.unlock(); Audio.click(); this.startNewGame(SAVE.maxLevel); };
        document.getElementById('btn-records').onclick  = () => { Audio.click(); this.renderRecords(); showScreen('records'); };
        document.getElementById('btn-settings').onclick = () => { Audio.click(); showScreen('settings'); };
        document.getElementById('btn-resume').onclick   = () => { Audio.click(); this.resume(); };
        document.getElementById('btn-restart-level').onclick = () => { Audio.click(); this.restartLevel(); };
        document.getElementById('btn-to-menu').onclick  = () => { Audio.click(); this.toMenu(); };
        document.getElementById('btn-retry').onclick    = () => { Audio.click(); this.startNewGame(this.levelIndex + 1); };
        document.getElementById('btn-go-menu').onclick  = () => { Audio.click(); this.toMenu(); };
        document.getElementById('btn-win-menu').onclick = () => { Audio.click(); this.toMenu(); };
        document.getElementById('btn-records-back').onclick = () => { Audio.click(); showScreen('menu'); };
        document.getElementById('btn-settings-back').onclick = () => { Audio.click(); showScreen('menu'); };
        document.getElementById('btn-save-record').onclick = () => { Audio.click(); this.saveRecord(); };
        document.getElementById('btn-reset-records').onclick = () => {
            Audio.click();
            if (confirm('Сбросить все рекорды? Действие необратимо.')) {
                SAVE.records = []; SAVE.best = 0; SAVE.maxLevel = 1; SAVE.hasProgress = false;
                persistSave(SAVE);
                this.renderRecords();
                updateMenuContinue();
                document.getElementById('hud-best').textContent = '0';
            }
        };

        const soundToggle = document.getElementById('opt-sound');
        soundToggle.checked = SAVE.sound;
        soundToggle.onchange = () => {
            SAVE.sound = soundToggle.checked;
            persistSave(SAVE);
        };

        window.addEventListener('blur', () => {
            if (this.state === 'playing') this.pause();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.state === 'playing') this.pause();
        });

        // menu keys: R restarts, P/Esc pauses
        window.addEventListener('keydown', (e) => {
            const k = e.key.toLowerCase();
            if (this.state === 'playing') {
                if (k === 'p' || k === 'escape') this.pause();
                else if (k === 'r') this.restartLevel();
            } else if (this.state === 'paused') {
                if (k === 'p' || k === 'escape') this.resume();
            }
        });

        updateMenuContinue();
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.loop(t));
    },

    startNewGame(fromLevel) {
        this.levelIndex = clamp((fromLevel || 1) - 1, 0, LEVELS.length - 1);
        this.score = 0;
        this.coinsCollected = 0;
        this.lives = 3;
        this.totalTime = 0;
        this.savedThisRun = false;
        this.loadLevel(this.levelIndex);
        this.state = 'playing';
        showScreen(null);
        document.getElementById('hud').classList.remove('hidden');
        this.updateHUD();
    },

    loadLevel(idx) {
        const data = LEVELS[idx];
        const clone = JSON.parse(JSON.stringify(data));
        clone.hitBlocks = {};
        this.level = clone;
        this.camera.x = 0;
        this.checkpoint = null;
        this.player = new Player(data.spawn.x, data.spawn.y);
        this.enemies = data.enemies.map(e => new Enemy(e));
        this.coins = data.coins.map(c => new Coin(c.x, c.y));
        this.powerups = data.powerups.map(p => new PowerUp(p.type, p.x, p.y));
        this.timeLeft = data.time;
        this.levelPixelWidth = this.level.data[0].length * TS;
        particles.length = 0;
    },

    restartLevel() {
        this.loadLevel(this.levelIndex);
        this.state = 'playing';
        showScreen(null);
        document.getElementById('hud').classList.remove('hidden');
        this.lastTime = performance.now();
    },

    nextLevel() {
        Audio.level();
        this.score += 2000 + Math.floor(this.timeLeft) * 10;
        if (this.levelIndex + 1 < LEVELS.length) {
            this.levelIndex++;
            SAVE.maxLevel = Math.max(SAVE.maxLevel, this.levelIndex + 1);
            SAVE.hasProgress = true;
            persistSave(SAVE);
            this.loadLevel(this.levelIndex);
            this.state = 'playing';
            this.updateHUD();
        } else {
            this.victory();
        }
    },

    victory() {
        this.state = 'victory';
        this.savedThisRun = false;
        document.getElementById('win-score').textContent = this.score;
        document.getElementById('win-coins').textContent = this.coinsCollected;
        document.getElementById('win-time').textContent = Math.floor(this.totalTime);
        document.getElementById('record-name').value = this.playerName || '';
        showScreen('victory');
        Audio.level();
        if (this.score > SAVE.best) {
            SAVE.best = this.score;
            SAVE.hasProgress = true;
            persistSave(SAVE);
        }
    },

    gameOver() {
        this.state = 'gameover';
        document.getElementById('go-score').textContent = this.score;
        document.getElementById('go-level').textContent = this.levelIndex + 1;
        document.getElementById('go-coins').textContent = this.coinsCollected;
        showScreen('gameover');
        Audio.lose();
        if (this.score > SAVE.best) {
            SAVE.best = this.score;
            SAVE.hasProgress = true;
            persistSave(SAVE);
        }
    },

    pause() {
        if (this.state !== 'playing') return;
        this.state = 'paused';
        showScreen('pause');
    },

    resume() {
        if (this.state !== 'paused') return;
        this.state = 'playing';
        showScreen(null);
        this.lastTime = performance.now();
    },

    toMenu() {
        this.state = 'menu';
        showScreen('menu');
        document.getElementById('hud').classList.add('hidden');
        updateMenuContinue();
    },

    addCoin() {
        this.coinsCollected++;
        this.score += 100;
        this.updateHUD();
    },

    addScore(n) {
        this.score += n;
        this.updateHUD();
    },

    updateHUD() {
        document.getElementById('hud-score').textContent = this.score;
        document.getElementById('hud-coins').textContent = this.coinsCollected;
        document.getElementById('hud-lives').textContent = this.lives;
        document.getElementById('hud-level').textContent = this.levelIndex + 1;
        document.getElementById('hud-time').textContent = Math.max(0, Math.floor(this.timeLeft));
        document.getElementById('hud-best').textContent = SAVE.best;
    },

    renderRecords() {
        const tbody = document.getElementById('records-body');
        tbody.innerHTML = '';
        const list = SAVE.records.slice().sort((a, b) => b.score - a.score).slice(0, 10);
        if (list.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 4;
            td.textContent = 'Пока нет рекордов';
            td.style.textAlign = 'center';
            td.style.color = '#8890b8';
            td.style.padding = '20px';
            tr.appendChild(td);
            tbody.appendChild(tr);
        } else {
            list.forEach((r, i) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${i+1}</td><td>${escapeHtml(r.name)}</td><td>${r.score}</td><td>${escapeHtml(r.date || '')}</td>`;
                tbody.appendChild(tr);
            });
        }
    },

    saveRecord() {
        if (this.savedThisRun) return;
        const nameInput = document.getElementById('record-name');
        let name = (nameInput.value || '').trim();
        if (!name) name = 'Аноним';
        if (name.length > 16) name = name.slice(0, 16);
        const date = new Date().toLocaleDateString('ru-RU');
        SAVE.records.push({ name, score: this.score, date });
        SAVE.records.sort((a, b) => b.score - a.score);
        SAVE.records = SAVE.records.slice(0, 10);
        if (this.score > SAVE.best) SAVE.best = this.score;
        SAVE.hasProgress = true;
        persistSave(SAVE);
        this.playerName = name;
        this.savedThisRun = true;
        document.getElementById('hud-best').textContent = SAVE.best;
        updateMenuContinue();
        Audio.power();
        const btn = document.getElementById('btn-save-record');
        btn.textContent = '✓ Сохранено';
        btn.disabled = true;
        setTimeout(() => { btn.textContent = '💾 Сохранить рекорд'; btn.disabled = false; }, 1800);
    },

    loop(now) {
        const dt = Math.min(0.05, (now - this.lastTime) / 1000) || 0;
        this.lastTime = now;

        if (this.state === 'playing') this.update(dt);
        this.render();
        Input.clearPressed();

        requestAnimationFrame((t) => this.loop(t));
    },

    update(dt) {
        this.totalTime += dt;
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
            this.timeLeft = this.level.time;
            this.player.hurt();
            if (this.state !== 'playing') return;
        }

        this.player.update(dt, this.level);
        this.camera.follow(this.player, this.levelPixelWidth, VIEW_W);

        for (const e of this.enemies) if (e.alive) e.update(dt, this.level);

        for (const c of this.coins) {
            if (c.collected) continue;
            c.update(dt);
            if (rectsOverlap(this.player, c)) {
                c.collected = true;
                this.addCoin();
                Audio.coin();
                spawnCoinSparkle(c.x + c.w/2, c.y + c.h/2);
            }
        }

        for (const p of this.powerups) {
            if (p.collected) continue;
            p.update(dt);
            if (rectsOverlap(this.player, p)) {
                p.collected = true;
                Audio.power();
                if (p.type === 'speed') this.player.speedBoost = 6;
                else if (p.type === 'shield') this.player.shield = 8;
                else if (p.type === 'life') this.lives++;
                this.addScore(150);
            }
        }

        for (const e of this.enemies) {
            if (!e.alive) continue;
            if (!rectsOverlap(this.player, e)) continue;
            const playerBottom = this.player.y + this.player.h;
            if (this.player.vy > 80 && playerBottom - e.y < 20) {
                e.alive = false;
                this.player.vy = -420;
                this.addScore(200);
                Audio.stomp();
                spawnEnemyPoof(e.x + e.w/2, e.y + e.h/2);
            } else {
                if (this.player.invuln <= 0 && this.player.shield <= 0) {
                    this.player.hurt();
                    this.updateHUD();
                    if (this.state !== 'playing') return;
                }
            }
        }

        this.checkBlockHits();

        // goal
        const goalX = this.level.goal.x;
        const goalY = this.level.goal.y;
        if (this.player.x + this.player.w > goalX && this.player.x < goalX + 40 &&
            this.player.y + this.player.h > goalY - 200) {
            this.nextLevel();
            return;
        }

        // checkpoint
        if (!this.checkpoint) {
            const cp1x = this.levelPixelWidth * 0.35;
            if (this.player.x > cp1x && this.player.onGround) {
                this.checkpoint = { x: this.player.x, y: this.player.y };
            }
        }

        updateParticles(dt);
        this.updateHUD();
    },

    checkBlockHits() {
        const p = this.player;
        if (p.vy >= 0) return;
        const tx0 = Math.floor(p.x / TS);
        const tx1 = Math.floor((p.x + p.w - 1) / TS);
        const tyTop = Math.floor((p.y - 1) / TS);
        for (let tx = tx0; tx <= tx1; tx++) {
            const t = this.level.data[tyTop] && this.level.data[tyTop][tx];
            if (t === '?') {
                hitQuestionBlock(this.level, tx, tyTop, this.powerups);
                this.addScore(50);
            } else if (t === 'B') {
                this.level.data[tyTop][tx] = '.';
                spawnBrickDebris(tx * TS, tyTop * TS, '#b8492a');
                this.addScore(20);
            }
        }
    },

    render() {
        const w = VIEW_W, h = VIEW_H;
        ctx.clearRect(0, 0, w, h);

        if (this.state === 'menu' || this.state === 'records' || this.state === 'settings') {
            drawSky(ctx, 'day', w, h);
            drawParallax(ctx, 0, 'day', w, h);
            return;
        }

        const theme = this.level ? this.level.theme : 'day';
        drawSky(ctx, theme, w, h);
        drawParallax(ctx, this.camera.x, theme, w, h);

        if (this.level) {
            ctx.save();
            ctx.translate(-Math.floor(this.camera.x), 0);

            const startTx = Math.max(0, Math.floor(this.camera.x / TS) - 1);
            const endTx = Math.min(this.level.data[0].length - 1, Math.floor((this.camera.x + w) / TS) + 1);
            for (let ty = 0; ty < this.level.data.length; ty++) {
                for (let tx = startTx; tx <= endTx; tx++) {
                    const t = this.level.data[ty][tx];
                    if (t && t !== '.') drawTile(ctx, tx, ty, t, this.level);
                }
            }

            for (const c of this.coins) if (!c.collected) c.draw(ctx);
            for (const p of this.powerups) if (!p.collected) p.draw(ctx);
            drawFlag(ctx, this.level.goal.x, this.level.goal.y + 60);
            for (const e of this.enemies) if (e.alive) e.draw(ctx);
            if (this.player) this.player.draw(ctx);
            drawParticles(ctx);

            ctx.restore();
        }
    }
};

// ---------- Helpers ----------
function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
}

function showScreen(name) {
    const screens = ['menu','pause','gameover','victory','records','settings'];
    screens.forEach(s => {
        const el = document.getElementById(s === 'menu' ? 'main-menu' : s + '-screen');
        if (!el) return;
        if (s === name) el.classList.remove('hidden');
        else el.classList.add('hidden');
    });
    if (name !== null && name !== 'menu') {
        document.getElementById('hud').classList.add('hidden');
    }
}

function updateMenuContinue() {
    const btn = document.getElementById('btn-continue');
    if (SAVE.hasProgress || SAVE.maxLevel > 1) {
        btn.style.display = '';
        btn.textContent = '⏩ Продолжить (ур. ' + SAVE.maxLevel + ')';
    } else {
        btn.style.display = 'none';
    }
}

if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    if (window.innerWidth < 1100) {
        document.getElementById('mobile-controls').classList.remove('hidden');
    }
}

Game.init();