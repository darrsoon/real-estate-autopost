'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/* Кадрирование картинок под пост.
   Две планировки 520×728 (файл в 2×) и карта превью 520×272 (файл в 1.5×).
   Чистка фона: заливка от краёв, пипетка, ластик и кисть «вернуть».
   На карте сверху ещё красные пометки — стрелка и рамка. */

interface SlotSpec {
  title: string;
  fw: number;      // ширина кадра в его собственных координатах
  fh: number;      // высота кадра
  ex: number;      // во сколько раз файл крупнее кадра
  annotate: boolean;
}

const SLOTS: SlotSpec[] = [
  { title: 'Планировка 1', fw: 520, fh: 728, ex: 2, annotate: false },
  { title: 'Планировка 2', fw: 520, fh: 728, ex: 2, annotate: false },
  { title: 'Карта превью', fw: 520, fh: 272, ex: 1.5, annotate: true },
];

// Ширина рамки на экране подстраивается под окно, чтобы планировки стояли в два
// столбца. На результат не влияет: кадр считается в своих координатах.
const VIEW_MAX = 520;
const VIEW_MIN = 220;
const GAP = 24;       // расстояние между карточками (gap-6)
const CARD_PAD = 32;  // внутренние поля карточки (p-4)

const JPEG_QUALITY = 0.92;
const MIN_OVERLAP = 60;   // сколько картинки обязано остаться в рамке
const DEFAULT_TOL = 24;   // допуск по цвету фона, 0…100
const DEFAULT_BRUSH = 40; // диаметр кисти в экранных px

const MARK_RED = '#ee2b20';
const HANDLE = 9;         // радиус ручки в координатах кадра
const MARK_T = 7;         // толщина линии пометок по умолчанию

type Tool = 'move' | 'pick' | 'erase' | 'restore';

interface Pt {
  x: number;
  y: number;
}

type Shape =
  | { id: number; kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; t: number }
  | { id: number; kind: 'rect'; x: number; y: number; w: number; h: number; t: number; r: number };

let nextShapeId = 1;

/** Что именно считаем фоном. Правки применяются всегда к оригиналу. */
interface BgSpec {
  auto: boolean;                          // заливка от краёв картинки
  picks: { x: number; y: number }[];      // точки, ткнутые пипеткой
  tol: number;                            // допуск 0…100
}

interface Shot {
  orig: HTMLImageElement;             // исходник, его не трогаем
  origSrc: string;
  base: string;                       // имя файла без расширения
  nw: number;                         // натуральный размер
  nh: number;
  fw: number;                         // размеры кадра, в котором живут tx/ty/s
  fh: number;
  ex: number;                         // множитель экспорта
  s: number;                          // масштаб: 1 = натуральный размер в координатах кадра
  tx: number;                         // левый верхний угол неповёрнутой картинки
  ty: number;
  rot: number;                        // поворот вокруг центра картинки, градусы
  bg: BgSpec | null;
  bgCanvas: HTMLCanvasElement | null; // результат удаления фона
  eraseMask: HTMLCanvasElement | null;// где прошлись ластиком
  keepMask: HTMLCanvasElement | null; // где вернули исходник кистью
  composed: HTMLCanvasElement;        // итог: из него рисуем превью и экспорт
  shapes: Shape[];                    // красные пометки поверх кадра
  busy: boolean;
  rev: number;                        // счётчик правок — холсты мутабельные
}

type Updater = (s: Shot) => Shot;

const coverScale = (nw: number, nh: number, fw: number, fh: number) =>
  Math.max(fw / nw, fh / nh);
const containScale = (nw: number, nh: number, fw: number, fh: number) =>
  Math.min(fw / nw, fh / nh);

/** Центр картинки в координатах кадра — вокруг него идёт поворот. */
const centerOf = (shot: Shot): Pt => ({
  x: shot.tx + (shot.nw * shot.s) / 2,
  y: shot.ty + (shot.nh * shot.s) / 2,
});

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const ctx2d = (c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings) =>
  c.getContext('2d', opts) as CanvasRenderingContext2D;

/** Общий приём отрисовки: и превью, и экспорт кладут картинку одинаково. */
function drawShot(
  ctx: CanvasRenderingContext2D,
  shot: Shot,
  source: CanvasImageSource,
  k: number, // множитель координат кадра: превью — D, экспорт — ex
) {
  const c = centerOf(shot);
  const w = shot.nw * shot.s * k;
  const h = shot.nh * shot.s * k;
  ctx.save();
  ctx.translate(c.x * k, c.y * k);
  ctx.rotate((shot.rot * Math.PI) / 180);
  ctx.drawImage(source, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** Ставит картинку по центру кадра с заданным масштабом. */
function centered(shot: Shot, s: number): Shot {
  return {
    ...shot,
    s,
    tx: (shot.fw - shot.nw * s) / 2,
    ty: (shot.fh - shot.nh * s) / 2,
  };
}

/** Не даём утащить картинку целиком за пределы кадра. */
function clampPos(shot: Shot): Shot {
  const w = shot.nw * shot.s;
  const h = shot.nh * shot.s;
  return {
    ...shot,
    tx: Math.min(shot.fw - MIN_OVERLAP, Math.max(MIN_OVERLAP - w, shot.tx)),
    ty: Math.min(shot.fh - MIN_OVERLAP, Math.max(MIN_OVERLAP - h, shot.ty)),
  };
}

function clampScale(shot: Shot, s: number): number {
  const cover = coverScale(shot.nw, shot.nh, shot.fw, shot.fh);
  return Math.min(cover * 8, Math.max(cover * 0.15, s));
}

/** Собирает итоговую картинку: фон → возвращённые куски → стёртое ластиком. */
function recompose(shot: Shot) {
  const ctx = ctx2d(shot.composed);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, shot.nw, shot.nh);
  ctx.drawImage(shot.bgCanvas ?? shot.orig, 0, 0);

  if (shot.keepMask) {
    const tmp = makeCanvas(shot.nw, shot.nh);
    const t = ctx2d(tmp);
    t.drawImage(shot.orig, 0, 0);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(shot.keepMask, 0, 0);
    ctx.drawImage(tmp, 0, 0);
  }

  if (shot.eraseMask) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(shot.eraseMask, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
}

async function loadFile(file: File, slot: SlotSpec): Promise<Shot | null> {
  if (!file.type.startsWith('image/')) return null;
  const src = URL.createObjectURL(file);
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(src);
    return null;
  }
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const base = file.name.replace(/\.[^.]+$/, '') || 'plan';
  const shot: Shot = {
    orig: img,
    origSrc: src,
    base,
    nw,
    nh,
    fw: slot.fw,
    fh: slot.fh,
    ex: slot.ex,
    s: 1,
    tx: 0,
    ty: 0,
    rot: 0,
    bg: null,
    bgCanvas: null,
    eraseMask: null,
    keepMask: null,
    composed: makeCanvas(nw, nh),
    shapes: [],
    busy: false,
    rev: 0,
  };
  recompose(shot);
  return centered(shot, coverScale(nw, nh, slot.fw, slot.fh)); // по умолчанию — заполнить
}

/* ── Красные пометки ───────────────────────────────────────────────────── */

function newArrow(fw: number, fh: number): Shape {
  return {
    id: nextShapeId++,
    kind: 'arrow',
    x1: fw * 0.12,
    y1: fh * 0.18,
    x2: fw * 0.45,
    y2: fh * 0.55,
    t: MARK_T,
  };
}

function newRect(fw: number, fh: number): Shape {
  return {
    id: nextShapeId++,
    kind: 'rect',
    x: fw * 0.35,
    y: fh * 0.3,
    w: fw * 0.35,
    h: fh * 0.32,
    t: MARK_T,
    r: 0,
  };
}

const ROT_ARM = 26; // на сколько ручка поворота вынесена над рамкой

/** Центр рамки и перевод её собственных координат в координаты кадра. */
function rectFrame(sh: Extract<Shape, { kind: 'rect' }>) {
  const cx = sh.x + sh.w / 2;
  const cy = sh.y + sh.h / 2;
  const rad = (sh.r * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    cx,
    cy,
    cos,
    sin,
    /** локальная точка (от центра) → координаты кадра */
    out: (lx: number, ly: number): Pt => ({
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    }),
    /** координаты кадра → локальная точка */
    into: (p: Pt): Pt => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
    },
  };
}

/** Ручки фигуры: концы стрелки либо углы рамки и её поворот. */
function handlesOf(sh: Shape): [string, Pt][] {
  if (sh.kind === 'arrow') {
    return [
      ['h0', { x: sh.x1, y: sh.y1 }],
      ['h1', { x: sh.x2, y: sh.y2 }],
    ];
  }
  const f = rectFrame(sh);
  const hw = sh.w / 2;
  const hh = sh.h / 2;
  return [
    ['nw', f.out(-hw, -hh)],
    ['ne', f.out(hw, -hh)],
    ['sw', f.out(-hw, hh)],
    ['se', f.out(hw, hh)],
    ['rot', f.out(0, -Math.abs(hh) - ROT_ARM)],
  ];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Расстояние от точки до отрезка — им ловим клик по древку стрелки. */
function distToSegment(p: Pt, a: Pt, b: Pt) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (!len2) return dist(p, a);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * vx, y: a.y + t * vy });
}

/** Что под курсором: ручка выделенной фигуры или тело какой-нибудь фигуры. */
function hitTest(shapes: Shape[], p: Pt, selectedId: number | null) {
  for (const sh of shapes) {
    if (sh.id !== selectedId) continue;
    for (const [mode, hp] of handlesOf(sh)) {
      if (dist(p, hp) <= HANDLE) return { id: sh.id, mode };
    }
  }
  for (let i = shapes.length - 1; i >= 0; i--) {
    const sh = shapes[i];
    if (sh.kind === 'rect') {
      const l = rectFrame(sh).into(p);
      if (Math.abs(l.x) <= Math.abs(sh.w) / 2 && Math.abs(l.y) <= Math.abs(sh.h) / 2) {
        return { id: sh.id, mode: 'move' };
      }
    } else if (
      distToSegment(p, { x: sh.x1, y: sh.y1 }, { x: sh.x2, y: sh.y2 }) <= Math.max(12, sh.t)
    ) {
      return { id: sh.id, mode: 'move' };
    }
  }
  return null;
}

function drawArrow(ctx: CanvasRenderingContext2D, sh: Extract<Shape, { kind: 'arrow' }>, k: number) {
  const a = { x: sh.x1 * k, y: sh.y1 * k };
  const b = { x: sh.x2 * k, y: sh.y2 * k };
  const t = sh.t * k;
  const head = t * 2.8;      // длина наконечника
  const wing = t * 1.9;      // половина его ширины
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const stem = { x: b.x - cos * head * 0.92, y: b.y - sin * head * 0.92 };

  ctx.fillStyle = MARK_RED;
  ctx.strokeStyle = MARK_RED;
  ctx.lineCap = 'butt';
  ctx.lineWidth = t;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(stem.x, stem.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - cos * head + -sin * wing, b.y - sin * head + cos * wing);
  ctx.lineTo(b.x - cos * head + sin * wing, b.y - sin * head - cos * wing);
  ctx.closePath();
  ctx.fill();
}

/** Рисует пометки; ручки — только в превью, в файл они не попадают. */
function drawShapes(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  k: number,
  selectedId: number | null,
) {
  for (const sh of shapes) {
    if (sh.kind === 'arrow') {
      drawArrow(ctx, sh, k);
    } else {
      const f = rectFrame(sh);
      ctx.save();
      ctx.translate(f.cx * k, f.cy * k);
      ctx.rotate((sh.r * Math.PI) / 180);
      ctx.strokeStyle = MARK_RED;
      ctx.lineWidth = sh.t * k;
      ctx.lineJoin = 'miter';
      ctx.strokeRect((-sh.w / 2) * k, (-sh.h / 2) * k, sh.w * k, sh.h * k);
      ctx.restore();
    }

    if (sh.id !== selectedId) continue;

    // Поводок к ручке поворота, чтобы её было видно как ручку, а не точку.
    if (sh.kind === 'rect') {
      const f = rectFrame(sh);
      const top = f.out(0, -Math.abs(sh.h) / 2);
      const arm = f.out(0, -Math.abs(sh.h) / 2 - ROT_ARM);
      ctx.beginPath();
      ctx.moveTo(top.x * k, top.y * k);
      ctx.lineTo(arm.x * k, arm.y * k);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();
    }

    for (const [, hp] of handlesOf(sh)) {
      ctx.beginPath();
      ctx.arc(hp.x * k, hp.y * k, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();
    }
  }
}

/** Двигает или тянет фигуру: from — где нажали, to — где курсор сейчас. */
function moveShape(orig: Shape, mode: string, from: Pt, to: Pt, snap: boolean): Shape {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (orig.kind === 'arrow') {
    if (mode === 'h0') return { ...orig, x1: orig.x1 + dx, y1: orig.y1 + dy };
    if (mode === 'h1') return { ...orig, x2: orig.x2 + dx, y2: orig.y2 + dy };
    return { ...orig, x1: orig.x1 + dx, y1: orig.y1 + dy, x2: orig.x2 + dx, y2: orig.y2 + dy };
  }
  if (mode === 'move') return { ...orig, x: orig.x + dx, y: orig.y + dy };

  const f = rectFrame(orig);

  if (mode === 'rot') {
    const ang = (p: Pt) => (Math.atan2(p.y - f.cy, p.x - f.cx) * 180) / Math.PI;
    let r = orig.r + ang(to) - ang(from);
    if (snap) r = Math.round(r / 15) * 15;   // с Shift — по 15°
    return { ...orig, r: Math.round(r * 10) / 10 };
  }

  // Тянем угол — противоположный остаётся на месте. Считаем в осях самой рамки.
  const l = f.into(to);
  const l0 = f.into(from);
  const ldx = l.x - l0.x;
  const ldy = l.y - l0.y;
  let { x, y, w, h } = orig;
  if (mode === 'nw') { x += ldx; y += ldy; w -= ldx; h -= ldy; }
  if (mode === 'ne') { y += ldy; w += ldx; h -= ldy; }
  if (mode === 'sw') { x += ldx; w -= ldx; h += ldy; }
  if (mode === 'se') { w += ldx; h += ldy; }

  // Центр сместился в осях рамки — переносим его туда же, но уже повёрнуто,
  // иначе противоположный угол уедет.
  const mx = x + w / 2 - f.cx;
  const my = y + h / 2 - f.cy;
  x += f.cx + mx * f.cos - my * f.sin - (x + w / 2);
  y += f.cy + mx * f.sin + my * f.cos - (y + h / 2);
  return { ...orig, x, y, w, h };
}

/* ── Кисти ─────────────────────────────────────────────────────────────── */

/** Мазок от точки к точке: линия с круглыми концами плюс кружки по краям
    (нулевой отрезок сам по себе в canvas не рисуется). */
function paintSegment(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, r: number) {
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = r * 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Прямоугольник, который задел мазок, — чтобы не перерисовывать всё полотно. */
function segmentBox(a: Pt, b: Pt, r: number, w: number, h: number) {
  const pad = r + 2;
  const x = Math.max(0, Math.floor(Math.min(a.x, b.x) - pad));
  const y = Math.max(0, Math.floor(Math.min(a.y, b.y) - pad));
  const x2 = Math.min(w, Math.ceil(Math.max(a.x, b.x) + pad));
  const y2 = Math.min(h, Math.ceil(Math.max(a.y, b.y) + pad));
  return { x, y, w: x2 - x, h: y2 - y };
}

/** Ластик: убирает пиксели и из итога, и из масок. */
function eraseStroke(shot: Shot, a: Pt, b: Pt, r: number) {
  if (!shot.eraseMask) shot.eraseMask = makeCanvas(shot.nw, shot.nh);
  paintSegment(ctx2d(shot.eraseMask), a, b, r);

  if (shot.keepMask) {
    const k = ctx2d(shot.keepMask);
    k.globalCompositeOperation = 'destination-out';
    paintSegment(k, a, b, r);
    k.globalCompositeOperation = 'source-over';
  }

  const ctx = ctx2d(shot.composed);
  ctx.globalCompositeOperation = 'destination-out';
  paintSegment(ctx, a, b, r);
  ctx.globalCompositeOperation = 'source-over';
}

/** Обратная кисть: возвращает пиксели исходника (и отменяет ластик). */
function restoreStroke(shot: Shot, a: Pt, b: Pt, r: number) {
  if (!shot.keepMask) shot.keepMask = makeCanvas(shot.nw, shot.nh);
  paintSegment(ctx2d(shot.keepMask), a, b, r);

  if (shot.eraseMask) {
    const e = ctx2d(shot.eraseMask);
    e.globalCompositeOperation = 'destination-out';
    paintSegment(e, a, b, r);
    e.globalCompositeOperation = 'source-over';
  }

  const box = segmentBox(a, b, r, shot.nw, shot.nh);
  if (box.w <= 0 || box.h <= 0) return;

  // Кусок исходника, обрезанный по форме мазка, кладём поверх итога.
  const tmp = makeCanvas(box.w, box.h);
  const t = ctx2d(tmp);
  t.drawImage(shot.orig, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  t.globalCompositeOperation = 'destination-in';
  paintSegment(t, { x: a.x - box.x, y: a.y - box.y }, { x: b.x - box.x, y: b.y - box.y }, r);
  ctx2d(shot.composed).drawImage(tmp, box.x, box.y);
}

/* ── Удаление фона ─────────────────────────────────────────────────────── */

/** Самый частый цвет по периметру — им обычно и залит фон скриншота. */
function borderColor(data: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const add = (p: number) => {
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    cur.n++;
    cur.r += r;
    cur.g += g;
    cur.b += b;
    buckets.set(key, cur);
  };
  for (let x = 0; x < w; x++) {
    add(x);
    add((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    add(y * w);
    add(y * w + w - 1);
  }
  let best = { n: 0, r: 255, g: 255, b: 255 };
  buckets.forEach(v => {
    if (v.n > best.n) best = v;
  });
  return [best.r / best.n, best.g / best.n, best.b / best.n];
}

/**
 * Заливка от семян: всё связное и похожее на опорный цвет становится
 * прозрачным.
 *
 * Расползаться заливка может только по «ядру» — пикселям в пределах допуска.
 * Те, что попали в узкую полосу за ним, лишь смягчают край и дальше не пускают:
 * иначе на плавных переходах (тени, градиенты) заливка утекает внутрь плана.
 */
function floodClear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  seeds: number[],
  ref: [number, number, number],
  hard: number,
  mark: Int32Array,
  queue: Int32Array,
  id: number,
) {
  const outer = hard + Math.max(8, hard * 0.35);
  const hard2 = hard * hard;
  const outer2 = outer * outer;
  const [rr, rg, rb] = ref;

  const dist2 = (p: number) => {
    const dr = data[p * 4] - rr;
    const dg = data[p * 4 + 1] - rg;
    const db = data[p * 4 + 2] - rb;
    return dr * dr + dg * dg + db * db;
  };

  /** Край: гасим альфу пропорционально удалению от опорного цвета. */
  const feather = (p: number, d2: number) => {
    const t = (Math.sqrt(d2) - hard) / (outer - hard);
    const a = Math.round(Math.min(1, Math.max(0, t)) * 255);
    if (a < data[p * 4 + 3]) data[p * 4 + 3] = a;
  };

  let head = 0;
  let tail = 0;
  for (const p of seeds) {
    if (mark[p] === id) continue;
    const d2 = dist2(p);
    if (d2 <= hard2) {
      mark[p] = id;
      queue[tail++] = p;
    } else if (d2 <= outer2) {
      mark[p] = id;
      feather(p, d2);
    }
  }

  const visit = (q: number) => {
    if (mark[q] === id) return;
    const d2 = dist2(q);
    if (d2 <= hard2) {
      mark[q] = id;
      queue[tail++] = q;
    } else if (d2 <= outer2) {
      mark[q] = id;
      feather(q, d2);
    }
  };

  while (head < tail) {
    const p = queue[head++];
    data[p * 4 + 3] = 0;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (y > 0) visit(p - w);
    if (y < h - 1) visit(p + w);
  }
}

/** Гоняет заливки по спецификации и отдаёт полотно с прозрачным фоном. */
function processBackground(orig: HTMLImageElement, spec: BgSpec): HTMLCanvasElement | null {
  const w = orig.naturalWidth;
  const h = orig.naturalHeight;
  const canvas = makeCanvas(w, h);
  const ctx = ctx2d(canvas, { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(orig, 0, 0);

  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const mark = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  const hard = spec.tol * 2.2;
  let id = 0;

  if (spec.auto) {
    const seeds: number[] = [];
    for (let x = 0; x < w; x++) {
      seeds.push(x, (h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      seeds.push(y * w, y * w + w - 1);
    }
    floodClear(data, w, h, seeds, borderColor(data, w, h), hard, mark, queue, ++id);
  }

  for (const pick of spec.picks) {
    const x = Math.min(w - 1, Math.max(0, Math.round(pick.x)));
    const y = Math.min(h - 1, Math.max(0, Math.round(pick.y)));
    const p = y * w + x;
    const ref: [number, number, number] = [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
    floodClear(data, w, h, [p], ref, hard, mark, queue, ++id);
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/* ── Экспорт ───────────────────────────────────────────────────────────── */

/** Пошаговое уменьшение вдвое: одношаговый drawImage при сильном сжатии мылит. */
function downscaled(
  source: CanvasImageSource,
  w: number,
  h: number,
  targetScale: number,
): CanvasImageSource {
  let src = source;
  let cw = w;
  let ch = h;
  let scale = targetScale;
  while (scale < 0.5 && cw > 2 && ch > 2) {
    const c = makeCanvas(Math.max(1, Math.round(cw / 2)), Math.max(1, Math.round(ch / 2)));
    const ctx = ctx2d(c);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    src = c;
    cw = c.width;
    ch = c.height;
    scale *= 2;
  }
  return src;
}

function exportShot(shot: Shot, filename: string) {
  const canvas = makeCanvas(Math.round(shot.fw * shot.ex), Math.round(shot.fh * shot.ex));
  const ctx = ctx2d(canvas);

  // В JPG нет альфы — под картинку всегда кладём белый фон.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const k = shot.ex;
  drawShot(ctx, shot, downscaled(shot.composed, shot.nw, shot.nh, shot.s * k), k);
  drawShapes(ctx, shot.shapes, k, null);

  canvas.toBlob(
    blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    'image/jpeg',
    JPEG_QUALITY,
  );
}

/* ── Страница ──────────────────────────────────────────────────────────── */

export default function PlanCropPage() {
  const [shots, setShots] = useState<(Shot | null)[]>(SLOTS.map(() => null));

  // Обработчики читают актуальные слоты из ref — они запускаются после отрисовки.
  const shotsRef = useRef(shots);
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);

  // Метка последнего запуска обработки фона: ползунок допуска гоняет её часто.
  const bgToken = useRef<number[]>(SLOTS.map(() => 0));

  // Подгоняем размер рамок под окно так, чтобы планировки влезли в два столбца.
  const rowRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(VIEW_MAX);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      // Два столбца влезают не всегда: на телефоне рамки идут в один и берут
      // всю ширину, иначе они упирались бы в VIEW_MIN и зря теряли полэкрана.
      const twoCols = w >= 2 * (VIEW_MIN + CARD_PAD) + GAP;
      const per = twoCols ? Math.floor((w - GAP) / 2) - CARD_PAD : Math.floor(w) - CARD_PAD;
      setView(Math.max(VIEW_MIN, Math.min(VIEW_MAX, per)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Кладёт загруженные файлы по слотам, освобождая старые object URL. */
  const place = useCallback((loaded: (Shot | null)[], targets: number[]) => {
    setShots(prev => {
      const next = [...prev];
      loaded.forEach((shot, k) => {
        const i = targets[k];
        if (!shot || i === undefined) return;
        if (next[i]) {
          URL.revokeObjectURL(next[i]!.origSrc);
          bgToken.current[i]++;
        }
        next[i] = shot;
      });
      return next;
    });
  }, []);

  /** Файлы, брошенные на слот `from` (или в пустые, если from = null). */
  const accept = useCallback(
    async (fileList: FileList | File[] | null, from: number | null) => {
      const files = Array.from(fileList || [])
        .filter(f => f.type.startsWith('image/'))
        .slice(0, SLOTS.length);
      if (!files.length) return;

      let targets: number[];
      if (from === null) {
        const free = shotsRef.current.map((s, i) => (s ? -1 : i)).filter(i => i >= 0);
        targets = files.map((_, k) => free[k] ?? k % SLOTS.length);
      } else {
        targets = files.map((_, k) => (from + k) % SLOTS.length);
      }

      const loaded = await Promise.all(files.map((f, k) => loadFile(f, SLOTS[targets[k]])));
      place(loaded, targets);
    },
    [place],
  );

  // Ctrl+V — самый частый сценарий: скрин из буфера сразу в свободный слот.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      void accept(files, null);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [accept]);

  // Браузер по умолчанию открывает брошенный файл — гасим это на всей странице.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  const update = useCallback((i: number, updater: Updater) => {
    setShots(prev => prev.map((s, j) => (j === i && s ? updater(s) : s)));
  }, []);

  const remove = useCallback((i: number) => {
    bgToken.current[i]++;
    setShots(prev =>
      prev.map((s, j) => {
        if (j !== i) return s;
        if (s) URL.revokeObjectURL(s.origSrc);
        return null;
      }),
    );
  }, []);

  /** Пересчитывает фон по новой спецификации (null — вернуть исходник). */
  const applyBg = useCallback(async (i: number, spec: BgSpec | null) => {
    const shot = shotsRef.current[i];
    if (!shot) return;
    const token = ++bgToken.current[i];

    if (!spec) {
      shot.bgCanvas = null;
      recompose(shot);
      setShots(prev =>
        prev.map((s, j) => (j === i && s ? { ...s, bg: null, busy: false, rev: s.rev + 1 } : s)),
      );
      return;
    }

    setShots(prev => prev.map((s, j) => (j === i && s ? { ...s, bg: spec, busy: true } : s)));
    // Даём кадру отрисовать «Обрабатываю…» до тяжёлого прохода по пикселям.
    await new Promise(r => requestAnimationFrame(() => r(null)));
    const canvas = processBackground(shot.orig, spec);
    if (bgToken.current[i] !== token) return; // пришли поздно, уже считаем заново

    if (canvas) {
      shot.bgCanvas = canvas;
      recompose(shot);
    }
    setShots(prev => prev.map((s, j) => (j === i && s ? { ...s, busy: false, rev: s.rev + 1 } : s)));
  }, []);

  /** Одинаковые имена файлов (например, все из буфера) разводим суффиксом. */
  const filename = (i: number) => {
    const shot = shots[i];
    if (!shot) return '';
    const clash = shots.some((s, j) => j !== i && s?.base === shot.base);
    return `${shot.base}${clash ? `-${i + 1}` : ''}.jpg`;
  };

  const download = (i: number) => {
    const shot = shots[i];
    if (shot) exportShot(shot, filename(i));
  };

  const downloadAll = () => {
    shots.forEach((shot, i) => {
      if (shot) setTimeout(() => exportShot(shot, filename(i)), i * 250);
    });
  };

  const ready = shots.filter(Boolean).length;

  const frame = (i: number) => (
    <Frame
      key={i}
      index={i}
      slot={SLOTS[i]}
      view={view}
      shot={shots[i]}
      onFiles={accept}
      onChange={update}
      onRemove={remove}
      onDownload={download}
      onBg={applyBg}
      filename={filename(i)}
    />
  );

  return (
    <div className="max-w-[1160px] mx-auto space-y-6 bb-rise">
      <div className="bb-card p-4 sm:p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="bb-title text-2xl">Кадрирование картинок</h1>
          <p className="bb-sub text-sm mt-1">
            Перетащите скрин в рамку или вставьте из буфера (Ctrl+V), затем подгоните — лишнее
            обрежется. Планировки 520×728 (файл 1040×1456), карта превью 520×272 (файл 780×408).
          </p>
        </div>
        <button className="bb-btn bb-btn-primary" onClick={downloadAll} disabled={!ready}>
          ⬇ Скачать всё ({ready})
        </button>
      </div>

      <div ref={rowRef} className="flex flex-wrap gap-6 justify-center">
        {[0, 1].map(frame)}
      </div>

      <div className="flex justify-center">{frame(2)}</div>
    </div>
  );
}

/* ── Один кадр ─────────────────────────────────────────────────────────── */

interface FrameProps {
  index: number;
  slot: SlotSpec;
  view: number;         // ширина рамки на экране
  shot: Shot | null;
  onFiles: (files: FileList | File[] | null, from: number | null) => void;
  onChange: (i: number, updater: Updater) => void;
  onRemove: (i: number) => void;
  onDownload: (i: number) => void;
  onBg: (i: number, spec: BgSpec | null) => void;
  filename: string;
}

function Frame({
  index,
  slot,
  view,
  shot,
  onFiles,
  onChange,
  onRemove,
  onDownload,
  onBg,
  filename,
}: FrameProps) {
  const viewH = (view * slot.fh) / slot.fw;
  const D = view / slot.fw; // экранные px → координаты кадра

  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const paint = useRef<Pt | null>(null);
  const shapeDrag = useRef<{ id: number; mode: string; from: Pt; orig: Shape } | null>(null);
  const tolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [over, setOver] = useState(false);
  const [tool, setTool] = useState<Tool>('move');
  const [tol, setTol] = useState(DEFAULT_TOL);
  const [brush, setBrush] = useState(DEFAULT_BRUSH);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const brushing = tool === 'erase' || tool === 'restore';

  /** Рисует превью кадра из собранного полотна и пометки поверх. */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(view * dpr)) {
      canvas.width = Math.round(view * dpr);
      canvas.height = Math.round(viewH * dpr);
    }
    const ctx = ctx2d(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view, viewH);
    if (!shot) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawShot(ctx, shot, shot.composed, D);
    drawShapes(ctx, shot.shapes, D, selected);
  }, [shot, selected, view, viewH, D]);

  useEffect(draw, [draw]);

  /** Зум вокруг точки (cx, cy) в координатах кадра — точка остаётся на месте. */
  const zoomAt = useCallback(
    (cx: number, cy: number, k: number) => {
      onChange(index, s => {
        const ns = clampScale(s, s.s * k);
        const f = ns / s.s;
        // Масштабируем положение центра — так формула верна и при повороте.
        const c = centerOf(s);
        const nx = cx + (c.x - cx) * f;
        const ny = cy + (c.y - cy) * f;
        return clampPos({ ...s, s: ns, tx: nx - (s.nw * ns) / 2, ty: ny - (s.nh * ns) / 2 });
      });
    },
    [index, onChange],
  );

  useEffect(() => () => {
    if (tolTimer.current) clearTimeout(tolTimer.current);
  }, []);

  const cover = shot ? coverScale(shot.nw, shot.nh, slot.fw, slot.fh) : 1;
  const zoom = shot ? shot.s / cover : 1;

  const setZoom = (z: number) => {
    if (!shot) return;
    zoomAt(slot.fw / 2, slot.fh / 2, (cover * z) / shot.s);
  };

  // Поворот делим на четверти (кнопки) и мелкую правку завала (ползунок).
  const quarter = shot ? Math.round(shot.rot / 90) * 90 : 0;
  const fine = shot ? shot.rot - quarter : 0;
  const rotate = (deg: number) => onChange(index, s => ({ ...s, rot: s.rot + deg }));

  const fit = (mode: 'cover' | 'contain') => {
    onChange(index, s =>
      centered(
        s,
        mode === 'cover'
          ? coverScale(s.nw, s.nh, s.fw, s.fh)
          : containScale(s.nw, s.nh, s.fw, s.fh),
      ),
    );
  };

  const bgSpec = (patch: Partial<BgSpec>): BgSpec => ({
    auto: shot?.bg?.auto ?? false,
    picks: shot?.bg?.picks ?? [],
    tol: shot?.bg?.tol ?? tol,
    ...patch,
  });

  /** Экран → координаты кадра. */
  const toFrame = (clientX: number, clientY: number): Pt => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / D, y: (clientY - r.top) / D };
  };

  /** Экран → пиксель исходной картинки (с обратным поворотом). */
  const toImage = (clientX: number, clientY: number): Pt => {
    const s = shot!;
    const f = toFrame(clientX, clientY);
    const c = centerOf(s);
    const rad = (-s.rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = f.x - c.x;
    const dy = f.y - c.y;
    return {
      x: (dx * cos - dy * sin) / s.s + s.nw / 2,
      y: (dx * sin + dy * cos) / s.s + s.nh / 2,
    };
  };

  const pickAt = (clientX: number, clientY: number) => {
    if (!shot) return;
    const p = toImage(clientX, clientY);
    if (p.x < 0 || p.y < 0 || p.x >= shot.nw || p.y >= shot.nh) return;
    setTool('move');
    onBg(index, bgSpec({ picks: [...(shot.bg?.picks ?? []), p] }));
  };

  /** Один сегмент мазка: рисуем прямо в полотно и сразу перерисовываем превью. */
  const strokeTo = (clientX: number, clientY: number) => {
    if (!shot || !paint.current) return;
    const to = toImage(clientX, clientY);
    const r = brush / 2 / D / shot.s; // экранный диаметр → радиус в пикселях картинки
    if (tool === 'erase') eraseStroke(shot, paint.current, to, r);
    else restoreStroke(shot, paint.current, to, r);
    paint.current = to;
    draw();
  };

  const changeTol = (v: number) => {
    setTol(v);
    if (!shot?.bg) return;
    if (tolTimer.current) clearTimeout(tolTimer.current);
    tolTimer.current = setTimeout(() => onBg(index, bgSpec({ tol: v })), 250);
  };

  const chooseTool = (t: Tool) => setTool(prev => (prev === t ? 'move' : t));

  const bgOn = !!shot?.bg;
  const painted = !!(shot?.eraseMask || shot?.keepMask);

  /** Сброс кистей — маски выбрасываем и пересобираем картинку. */
  const clearBrushes = () => {
    if (!shot) return;
    onChange(index, s => {
      s.eraseMask = null;
      s.keepMask = null;
      recompose(s);
      return { ...s, rev: s.rev + 1 };
    });
  };

  const addShape = (make: (fw: number, fh: number) => Shape) => {
    if (!shot) return;
    const sh = make(slot.fw, slot.fh);
    setSelected(sh.id);
    setTool('move');
    onChange(index, s => ({ ...s, shapes: [...s.shapes, sh] }));
  };

  const dropShape = () => {
    if (selected === null) return;
    const id = selected;
    setSelected(null);
    onChange(index, s => ({ ...s, shapes: s.shapes.filter(sh => sh.id !== id) }));
  };

  const setThickness = (t: number) =>
    onChange(index, s => ({
      ...s,
      shapes: s.shapes.map(sh => (sh.id === selected ? { ...sh, t } : sh)),
    }));

  const current = shot?.shapes.find(sh => sh.id === selected) ?? null;

  return (
    <div className="bb-card p-4 space-y-3" style={{ width: view + CARD_PAD }}>
      <div className="flex items-center justify-between gap-2 h-6">
        <span className="bb-label truncate">{shot ? filename : slot.title}</span>
        <span className="bb-sub text-[11px] shrink-0">
          {shot ? `${shot.nw}×${shot.nh}` : `${slot.fw}×${slot.fh}`}
        </span>
      </div>

      <div
        ref={boxRef}
        onDragOver={e => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={e => {
          e.preventDefault();
          setOver(false);
          onFiles(e.dataTransfer.files, index);
        }}
        onPointerDown={e => {
          if (!shot) return;
          // Средняя кнопка двигает картинку в любом режиме — удобно при рисовании.
          if (brushing && e.button !== 1) {
            e.currentTarget.setPointerCapture(e.pointerId);
            paint.current = toImage(e.clientX, e.clientY);
            strokeTo(e.clientX, e.clientY);
            return;
          }
          if (tool === 'pick') return;

          // Пометки перехватывают клик раньше, чем начинается перетаскивание кадра.
          if (slot.annotate && e.button !== 1) {
            const f = toFrame(e.clientX, e.clientY);
            const hit = hitTest(shot.shapes, f, selected);
            setSelected(hit ? hit.id : null);
            if (hit) {
              const orig = shot.shapes.find(sh => sh.id === hit.id)!;
              e.currentTarget.setPointerCapture(e.pointerId);
              shapeDrag.current = { id: hit.id, mode: hit.mode, from: f, orig };
              return;
            }
          }

          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={e => {
          if (brushing) setCursor(toFrame(e.clientX, e.clientY));
          if (paint.current) {
            strokeTo(e.clientX, e.clientY);
            return;
          }
          if (shapeDrag.current) {
            const { id, mode, from, orig } = shapeDrag.current;
            const next = moveShape(orig, mode, from, toFrame(e.clientX, e.clientY), e.shiftKey);
            onChange(index, s => ({ ...s, shapes: s.shapes.map(sh => (sh.id === id ? next : sh)) }));
            return;
          }
          if (!drag.current) return;
          const dx = (e.clientX - drag.current.x) / D;
          const dy = (e.clientY - drag.current.y) / D;
          drag.current = { x: e.clientX, y: e.clientY };
          onChange(index, s => clampPos({ ...s, tx: s.tx + dx, ty: s.ty + dy }));
        }}
        onPointerUp={() => {
          drag.current = null;
          shapeDrag.current = null;
          if (paint.current) {
            paint.current = null;
            onChange(index, s => ({ ...s, rev: s.rev + 1 }));
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          shapeDrag.current = null;
          paint.current = null;
        }}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={() => shot && tool === 'move' && fit('cover')}
        onClick={e => {
          if (!shot) fileRef.current?.click();
          else if (tool === 'pick') pickAt(e.clientX, e.clientY);
        }}
        className="relative overflow-hidden select-none touch-none"
        style={{
          width: view,
          height: viewH,
          borderRadius: 18,
          background: '#fff',
          border: `2px ${shot ? 'solid' : 'dashed'} ${
            over || tool !== 'move' ? 'var(--aqua-400)' : shot ? 'transparent' : 'var(--sky-200)'
          }`,
          boxShadow: 'var(--lift-2)',
          cursor: !shot
            ? 'pointer'
            : tool === 'pick'
              ? 'crosshair'
              : brushing
                ? 'none'
                : 'grab',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: view, height: viewH }}
        />

        {!shot && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <span className="text-3xl">🖼️</span>
            <span className="bb-label">Перетащите скрин сюда</span>
            <span className="bb-sub text-xs">или Ctrl+V, или кликните, чтобы выбрать файл</span>
          </div>
        )}

        {brushing && cursor && (
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              left: cursor.x * D - brush / 2,
              top: cursor.y * D - brush / 2,
              width: brush,
              height: brush,
              border: '1px solid rgba(15,23,42,.75)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.9)',
            }}
          />
        )}

        {shot?.busy && (
          <div
            className="absolute inset-0 flex items-center justify-center bb-label"
            style={{ background: 'rgba(255,255,255,.7)' }}
          >
            Обрабатываю…
          </div>
        )}

        {tool === 'pick' && !shot?.busy && (
          <div
            className="absolute left-0 right-0 bottom-0 text-center py-2 bb-label"
            style={{ background: 'rgba(255,255,255,.85)' }}
          >
            Кликните по фону
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={e => {
          onFiles(e.target.files, index);
          e.target.value = '';
        }}
      />

      {/* Масштаб меняется только отсюда: колесо оставлено странице для прокрутки. */}
      <div className="flex items-center gap-2">
        <button
          className="bb-btn bb-btn-ghost text-xs px-3"
          disabled={!shot}
          onClick={() => zoomAt(slot.fw / 2, slot.fh / 2, 1 / 1.15)}
          title="Уменьшить"
        >
          −
        </button>
        <input
          type="range"
          min={0.15}
          max={8}
          step={0.01}
          value={zoom}
          disabled={!shot}
          onChange={e => setZoom(Number(e.target.value))}
          className="flex-1 accent-teal-400 disabled:opacity-40"
        />
        <button
          className="bb-btn bb-btn-ghost text-xs px-3"
          disabled={!shot}
          onClick={() => zoomAt(slot.fw / 2, slot.fh / 2, 1.15)}
          title="Увеличить"
        >
          +
        </button>
        <span className="bb-sub text-[11px] tabular-nums w-12 text-right">
          {shot ? `${Math.round(shot.s * 100)}%` : '—'}
        </span>
      </div>

      {/* Ползунок правит завал в пределах ±20°, четверти оборота — кнопками. */}
      <div className="flex items-center gap-2">
        <button
          className="bb-btn bb-btn-ghost text-xs px-3"
          disabled={!shot}
          onClick={() => rotate(-90)}
          title="Повернуть на 90° влево"
        >
          ⟲
        </button>
        <input
          type="range"
          min={-20}
          max={20}
          step={0.1}
          value={fine}
          disabled={!shot}
          onChange={e => onChange(index, s => ({ ...s, rot: quarter + Number(e.target.value) }))}
          className="flex-1 accent-teal-400 disabled:opacity-40"
        />
        <button
          className="bb-btn bb-btn-ghost text-xs px-3"
          disabled={!shot}
          onClick={() => rotate(90)}
          title="Повернуть на 90° вправо"
        >
          ⟳
        </button>
        <button
          className="bb-sub text-[11px] tabular-nums w-12 text-right underline"
          disabled={!shot}
          onClick={() => onChange(index, s => ({ ...s, rot: 0 }))}
          title="Сбросить поворот"
        >
          {shot ? `${shot.rot.toFixed(1)}°` : '—'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="bb-btn bb-btn-ghost text-xs" disabled={!shot} onClick={() => fit('cover')}>
          Заполнить
        </button>
        <button className="bb-btn bb-btn-ghost text-xs" disabled={!shot} onClick={() => fit('contain')}>
          Вписать
        </button>
        {shot && (
          <button className="bb-btn bb-btn-ghost text-xs bb-bad" onClick={() => onRemove(index)}>
            Удалить
          </button>
        )}
      </div>

      {slot.annotate && (
        <div className="rounded-2xl p-3 space-y-2" style={{ background: 'var(--sky-50)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="bb-label mr-1">Пометки</span>
            <button
              className="bb-btn bb-btn-ghost text-xs"
              disabled={!shot}
              onClick={() => addShape(newArrow)}
            >
              ➜ Стрелка
            </button>
            <button
              className="bb-btn bb-btn-ghost text-xs"
              disabled={!shot}
              onClick={() => addShape(newRect)}
            >
              ▭ Рамка
            </button>
            {current && (
              <button className="bb-btn bb-btn-ghost text-xs bb-bad" onClick={dropShape}>
                Убрать
              </button>
            )}
            <span className="bb-sub text-[11px] flex-1 text-right leading-tight">
              {current?.kind === 'rect'
                ? `поворот ${current.r.toFixed(1)}° — верхняя ручка, с Shift по 15°`
                : current
                  ? 'тяните за белые точки'
                  : 'кликните по фигуре, чтобы менять'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="bb-sub text-[11px] w-16">Толщина</span>
            <input
              type="range"
              min={2}
              max={30}
              step={1}
              value={current?.t ?? MARK_T}
              disabled={!current}
              onChange={e => setThickness(Number(e.target.value))}
              className="flex-1 accent-teal-400 disabled:opacity-40"
            />
            <span className="bb-sub text-[11px] tabular-nums w-6 text-right">
              {current?.t ?? '—'}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* ── Фон ── */}
        <div className="rounded-2xl p-3 space-y-2" style={{ background: 'var(--sky-50)' }}>
          <div className="flex items-center justify-between">
            <span className="bb-label">Фон</span>
            {bgOn && (
              <button
                className="bb-sub text-[11px] underline"
                disabled={shot?.busy}
                onClick={() => onBg(index, null)}
              >
                вернуть
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className={`bb-btn text-xs ${shot?.bg?.auto ? 'bb-btn-primary' : 'bb-btn-ghost'}`}
              disabled={!shot || shot.busy}
              onClick={() => onBg(index, bgSpec({ auto: !shot?.bg?.auto, tol }))}
              title="Заливка от краёв картинки"
            >
              ✨ Убрать
            </button>
            <button
              className={`bb-btn text-xs ${tool === 'pick' ? 'bb-btn-primary' : 'bb-btn-ghost'}`}
              disabled={!shot || shot.busy}
              onClick={() => chooseTool('pick')}
              title="Кликнуть по цвету, который считать фоном"
            >
              💧 Пипетка{shot?.bg?.picks.length ? ` (${shot.bg.picks.length})` : ''}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="bb-sub text-[11px] w-12">Допуск</span>
            <input
              type="range"
              min={2}
              max={100}
              step={1}
              value={tol}
              disabled={!shot || !bgOn}
              onChange={e => changeTol(Number(e.target.value))}
              className="flex-1 accent-teal-400 disabled:opacity-40"
            />
            <span className="bb-sub text-[11px] tabular-nums w-6 text-right">{tol}</span>
          </div>
        </div>

        {/* ── Кисти ── */}
        <div className="rounded-2xl p-3 space-y-2" style={{ background: 'var(--sky-50)' }}>
          <div className="flex items-center justify-between">
            <span className="bb-label">Кисть</span>
            {painted && (
              <button className="bb-sub text-[11px] underline" onClick={clearBrushes}>
                сбросить
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className={`bb-btn text-xs ${tool === 'erase' ? 'bb-btn-primary' : 'bb-btn-ghost'}`}
              disabled={!shot || shot.busy}
              onClick={() => chooseTool('erase')}
              title="Стереть в прозрачность"
            >
              🧽 Ластик
            </button>
            <button
              className={`bb-btn text-xs ${tool === 'restore' ? 'bb-btn-primary' : 'bb-btn-ghost'}`}
              disabled={!shot || shot.busy}
              onClick={() => chooseTool('restore')}
              title="Вернуть кистью пиксели исходника"
            >
              ↩︎ Вернуть
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="bb-sub text-[11px] w-12">Размер</span>
            <input
              type="range"
              min={4}
              max={200}
              step={1}
              value={brush}
              disabled={!shot}
              onChange={e => setBrush(Number(e.target.value))}
              className="flex-1 accent-teal-400 disabled:opacity-40"
            />
            <span className="bb-sub text-[11px] tabular-nums w-6 text-right">{brush}</span>
          </div>
        </div>
      </div>

      <button
        className="bb-btn bb-btn-ink w-full"
        disabled={!shot || shot.busy}
        onClick={() => onDownload(index)}
      >
        ⬇ Скачать JPG {Math.round(slot.fw * slot.ex)}×{Math.round(slot.fh * slot.ex)}
      </button>
    </div>
  );
}
