/**
 * Procedural 8-bit sprites: critters (+hats, walk cycle, facing, dramatic soak),
 * water balloons, sandcastles, tiles, splash sprays, power-ups and rubber ducks.
 * All drawn with primitives so they scale cleanly to any tile size.
 */
import { POWERUP_COLORS, slotColor, splashColor, THEME_PALETTES } from '../theme';
import { circle, ellipse, hash2, rect, withAlpha } from './pixel';
const ANIMAL = {
    frog: { body: '#5bbf3a', body2: '#489a2c', belly: '#d7f0b0', feet: '#3a7a22', ears: 'none' },
    duck: { body: '#ffd23f', body2: '#e8b520', belly: '#fff0b8', feet: '#ff8a3c', ears: 'none', beak: '#ff8a3c' },
    otter: { body: '#9a6a3c', body2: '#7d5430', belly: '#e6cba0', feet: '#6b4728', ears: 'round' },
    penguin: { body: '#2b2f3a', body2: '#1c2029', belly: '#f2f5ff', feet: '#ff8a3c', ears: 'none', beak: '#ff8a3c' },
    cat: { body: '#b8b8c0', body2: '#9a9aa4', belly: '#eef0f6', feet: '#8a8a94', ears: 'cat', dramatic: true },
    raccoon: { body: '#8b93a1', body2: '#6d7482', belly: '#d8dee8', feet: '#565c68', ears: 'round', mask: true },
    turtle: { body: '#57c06a', body2: '#3f9a52', belly: '#cdeccf', feet: '#3f9a52', ears: 'none', shell: true },
    capybara: { body: '#b98a54', body2: '#9a6f40', belly: '#e2c79a', feet: '#7d5730', ears: 'round', big: true },
};
function facingVec(dir) {
    switch (dir) {
        case 'up':
            return { x: 0, y: -1 };
        case 'down':
            return { x: 0, y: 1 };
        case 'left':
            return { x: -1, y: 0 };
        case 'right':
            return { x: 1, y: 0 };
    }
}
export function drawCritter(ctx, o) {
    const s = ANIMAL[o.animal];
    const u = o.size / 16; // unit
    const cx = o.cx;
    const cy = o.cy;
    const f = facingVec(o.facing);
    const bob = o.moving ? Math.sin((o.frame + 0.5) * Math.PI) * 0.6 * u : 0;
    // team ring under feet
    withAlpha(ctx, 0.5, () => ellipse(ctx, cx, cy + 6 * u, 6 * u, 2.4 * u, '#00000055'));
    ctx.fillStyle = slotColor(o.ownerSlot, o.colorblind);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6 * u, 6.4 * u, 2.6 * u, 0, 0, Math.PI * 2);
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
    // feet (walk cycle)
    const legOff = o.moving ? (o.frame === 0 ? 1.4 * u : -1.4 * u) : 0;
    rect(ctx, cx - 4 * u, cy + 4 * u + legOff, 3 * u, 3 * u, s.feet);
    rect(ctx, cx + 1 * u, cy + 4 * u - legOff, 3 * u, 3 * u, s.feet);
    const bodyY = cy - bob;
    if (s.shell) {
        // turtle: head pokes out in facing dir, shell on body
        ellipse(ctx, cx + f.x * 5 * u, bodyY + f.y * 4 * u - 1 * u, 3.2 * u, 3 * u, s.body);
        ellipse(ctx, cx, bodyY, 6.5 * u, 5.5 * u, '#8a5a34');
        ellipse(ctx, cx, bodyY, 5 * u, 4.2 * u, '#a9743f');
        // shell plates
        rect(ctx, cx - 1 * u, bodyY - 4 * u, 2 * u, 8 * u, '#7a4e2c');
        rect(ctx, cx - 4 * u, bodyY - 1 * u, 8 * u, 2 * u, '#7a4e2c');
    }
    else {
        const rx = (s.big ? 7 : 6) * u;
        const ry = (s.big ? 6 : 5.4) * u;
        ellipse(ctx, cx, bodyY, rx, ry, s.body);
        ellipse(ctx, cx, bodyY + 1.4 * u, rx * 0.62, ry * 0.62, s.belly);
        // shade
        withAlpha(ctx, 0.25, () => ellipse(ctx, cx + 2.2 * u, bodyY - 1 * u, rx * 0.5, ry * 0.7, s.body2));
    }
    // ears
    if (s.ears === 'cat') {
        tri(ctx, cx - 5 * u, bodyY - 4 * u, cx - 2 * u, bodyY - 4 * u, cx - 3.5 * u, bodyY - 8 * u, s.body);
        tri(ctx, cx + 2 * u, bodyY - 4 * u, cx + 5 * u, bodyY - 4 * u, cx + 3.5 * u, bodyY - 8 * u, s.body);
    }
    else if (s.ears === 'round') {
        circle(ctx, cx - 4 * u, bodyY - 4.5 * u, 2 * u, s.body);
        circle(ctx, cx + 4 * u, bodyY - 4.5 * u, 2 * u, s.body);
    }
    if (!s.shell)
        drawFace(ctx, cx, bodyY, u, f, s, o);
    if (o.hat !== 'none')
        drawHat(ctx, o.hat, cx, bodyY - (s.big ? 6 : 5) * u, u, f);
    if (o.soaked)
        drawSoak(ctx, cx, cy, o.size, o.soakT ?? 0, s.dramatic ?? false);
}
function drawFace(ctx, cx, cy, u, f, s, o) {
    const ex = f.x * 1.6 * u;
    const ey = f.y * 1.2 * u - 1.2 * u;
    if (s.mask) {
        rect(ctx, cx - 4 * u, cy - 2.4 * u, 8 * u, 3 * u, '#2a2f3a');
    }
    // eyes
    const eyeR = 1.8 * u;
    circle(ctx, cx - 2.4 * u + ex, cy - 1.4 * u + ey, eyeR, '#ffffff');
    circle(ctx, cx + 2.4 * u + ex, cy - 1.4 * u + ey, eyeR, '#ffffff');
    const pupilR = 0.9 * u;
    const pdx = f.x * 0.8 * u;
    const pdy = f.y * 0.8 * u;
    circle(ctx, cx - 2.4 * u + ex + pdx, cy - 1.4 * u + ey + pdy, pupilR, '#101018');
    circle(ctx, cx + 2.4 * u + ex + pdx, cy - 1.4 * u + ey + pdy, pupilR, '#101018');
    if (s.beak) {
        tri(ctx, cx + ex + f.x * 3 * u - 2 * u, cy + 1.5 * u, cx + ex + f.x * 3 * u + 2 * u, cy + 1.5 * u, cx + ex + f.x * 5 * u, cy + 2.5 * u, s.beak);
    }
}
function drawSoak(ctx, cx, cy, size, t, dramatic) {
    const u = size / 16;
    withAlpha(ctx, 0.35, () => ellipse(ctx, cx, cy, 7 * u, 6 * u, '#5fb0f2'));
    const n = dramatic ? 8 : 5;
    const spread = (dramatic ? 12 : 8) * u * (0.4 + t);
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = spread;
        circle(ctx, cx + Math.cos(a) * r, cy - 4 * u + Math.sin(a) * r * 0.6, (dramatic ? 1.6 : 1.2) * u, '#bfe6ff');
    }
    if (dramatic) {
        // X eyes for the water-hating cat
        ctx.strokeStyle = '#26364f';
        ctx.lineWidth = Math.max(1, u);
        for (const sx of [-2.4, 2.4]) {
            ctx.beginPath();
            ctx.moveTo(cx + sx * u - u, cy - 2.4 * u - u);
            ctx.lineTo(cx + sx * u + u, cy - 2.4 * u + u);
            ctx.moveTo(cx + sx * u + u, cy - 2.4 * u - u);
            ctx.lineTo(cx + sx * u - u, cy - 2.4 * u + u);
            ctx.stroke();
        }
    }
}
function drawHat(ctx, hat, cx, topY, u, f) {
    switch (hat) {
        case 'bucket':
            rect(ctx, cx - 5 * u, topY, 10 * u, 1.6 * u, '#5ec5b0');
            rect(ctx, cx - 3.6 * u, topY - 3.4 * u, 7.2 * u, 3.6 * u, '#7ad8c4');
            break;
        case 'snorkel':
            rect(ctx, cx - 4.4 * u, topY - 1 * u, 8.8 * u, 2.4 * u, '#2a3550');
            circle(ctx, cx + f.x * 3 * u, topY + 0.2 * u, 2.2 * u, '#9fd8ff');
            rect(ctx, cx + 3.2 * u, topY - 3 * u, 1.4 * u, 3 * u, '#ffce3a');
            break;
        case 'crown':
            for (let i = -2; i <= 2; i++)
                tri(ctx, cx + i * 2 * u - u, topY, cx + i * 2 * u + u, topY, cx + i * 2 * u, topY - 3 * u, '#ffd23f');
            rect(ctx, cx - 5 * u, topY, 10 * u, 1.6 * u, '#e5a81f');
            break;
        case 'bandana':
            rect(ctx, cx - 5 * u, topY - 2.4 * u, 10 * u, 3.4 * u, '#c0303f');
            circle(ctx, cx, topY - 0.6 * u, 1 * u, '#ffffff');
            break;
        case 'propeller':
            rect(ctx, cx - 4 * u, topY - 1 * u, 8 * u, 2.4 * u, '#3a7ad8');
            rect(ctx, cx - 1 * u, topY - 3.4 * u, 2 * u, 2.4 * u, '#cfa000');
            rect(ctx, cx - 5 * u, topY - 4 * u, 10 * u, 1.2 * u, '#ffe06a');
            break;
        default:
            break;
    }
}
function tri(ctx, x1, y1, x2, y2, x3, y3, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
}
export function drawBalloon(ctx, cx, cy, size, ownerSlot, wobbleT, fuseFrac, colorblind) {
    const u = size / 16;
    const wob = Math.sin(wobbleT * Math.PI * 2) * 0.6 * u;
    const inflate = 1 + (1 - fuseFrac) * 0.18;
    const rx = 5.4 * u * inflate + wob;
    const ry = 6 * u * inflate - wob;
    const flash = fuseFrac < 0.18 && Math.floor(wobbleT * 8) % 2 === 0;
    ellipse(ctx, cx, cy, rx, ry, flash ? '#ffb4c0' : '#7fd0ff');
    ellipse(ctx, cx, cy + 0.6 * u, rx * 0.7, ry * 0.7, flash ? '#ffd0d8' : '#b9ecff');
    // highlight
    withAlpha(ctx, 0.85, () => circle(ctx, cx - 1.8 * u, cy - 2 * u, 1.4 * u, '#ffffff'));
    // knot in owner colour
    tri(ctx, cx - 1.4 * u, cy + ry - 0.4 * u, cx + 1.4 * u, cy + ry - 0.4 * u, cx, cy + ry + 1.8 * u, slotColor(ownerSlot, colorblind));
}
export function drawFloor(ctx, x, y, size, theme) {
    const p = THEME_PALETTES[theme];
    const v = hash2(x / size, y / size) % 7;
    rect(ctx, x, y, size, size, v === 0 ? p.floorB : p.floorA);
    if (v === 1)
        rect(ctx, x + size * 0.25, y + size * 0.3, Math.max(1, size * 0.12), Math.max(1, size * 0.12), p.floorB);
    if (v === 2)
        rect(ctx, x + size * 0.6, y + size * 0.55, Math.max(1, size * 0.12), Math.max(1, size * 0.12), p.floorB);
}
export function drawBoulder(ctx, x, y, size, theme) {
    const p = THEME_PALETTES[theme];
    const m = size * 0.08;
    rect(ctx, x + m, y + m, size - 2 * m, size - 2 * m, p.boulderShade);
    rect(ctx, x + m, y + m, size - 2 * m, size - 2 * m - size * 0.14, p.boulder);
    rect(ctx, x + m + size * 0.12, y + m + size * 0.1, size * 0.28, size * 0.18, p.boulderLight);
}
export function drawSandcastle(ctx, x, y, size, theme, crumble = 0) {
    const p = THEME_PALETTES[theme];
    const shrink = crumble * size * 0.4;
    const bx = x + shrink / 2;
    const by = y + shrink / 2;
    const bs = size - shrink;
    const m = bs * 0.12;
    rect(ctx, bx + m, by + bs * 0.28, bs - 2 * m, bs * 0.62, p.castleShade);
    rect(ctx, bx + m, by + bs * 0.28, bs - 2 * m, bs * 0.5, p.castle);
    // turrets
    for (const tx of [m, bs * 0.5 - bs * 0.09, bs - m - bs * 0.18]) {
        rect(ctx, bx + tx, by + bs * 0.12, bs * 0.18, bs * 0.2, p.castleLight);
    }
    // door
    rect(ctx, bx + bs * 0.42, by + bs * 0.58, bs * 0.16, bs * 0.32, p.castleShade);
}
export function drawFlood(ctx, x, y, size, theme, t) {
    const p = THEME_PALETTES[theme];
    rect(ctx, x, y, size, size, p.water);
    const shimmer = (Math.sin(t * 3 + x * 0.3 + y * 0.2) + 1) / 2;
    withAlpha(ctx, 0.4 + shimmer * 0.4, () => rect(ctx, x + size * 0.12, y + size * (0.2 + shimmer * 0.2), size * 0.5, Math.max(1, size * 0.12), p.waterLight));
}
export function drawSplashCell(ctx, cx, cy, size, ownerSlot, life, // 0..1 (1 = fresh)
center, colorblind) {
    const u = size / 16;
    const col = splashColor(ownerSlot, colorblind);
    const grow = center ? 1 + (1 - life) * 0.2 : 0.8 + (1 - life) * 0.4;
    withAlpha(ctx, 0.35 + life * 0.4, () => ellipse(ctx, cx, cy, 7 * u * grow, 7 * u * grow, col));
    withAlpha(ctx, 0.5 + life * 0.3, () => ellipse(ctx, cx, cy, 4.4 * u * grow, 4.4 * u * grow, '#eaffff'));
    // droplets
    const n = 4;
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + life * 3;
        const r = (5 + (1 - life) * 5) * u;
        withAlpha(ctx, life, () => circle(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.1 * u, col));
    }
}
export function drawPowerup(ctx, cx, cy, size, kind, bobT) {
    const u = size / 16;
    const bob = Math.sin(bobT * Math.PI * 2) * 1 * u;
    const c = POWERUP_COLORS[kind];
    const y = cy + bob;
    rect(ctx, cx - 5 * u, y - 5 * u, 10 * u, 10 * u, '#0009');
    rect(ctx, cx - 4.4 * u, y - 4.4 * u, 8.8 * u, 8.8 * u, c.body);
    rect(ctx, cx - 4.4 * u, y - 4.4 * u, 8.8 * u, 2 * u, c.edge);
    ctx.fillStyle = '#1a1a24';
    drawIcon(ctx, kind, cx, y, u);
}
function drawIcon(ctx, kind, cx, cy, u) {
    switch (kind) {
        case 'extraBalloon':
            circle(ctx, cx, cy + 0.5 * u, 3 * u, '#ffffff');
            ellipse(ctx, cx, cy + 0.2 * u, 2 * u, 2.4 * u, '#7fd0ff');
            break;
        case 'bigSplash':
            for (const [dx, dy] of [[0, -3], [0, 3], [-3, 0], [3, 0]])
                circle(ctx, cx + dx * u, cy + dy * u, 1.2 * u, '#ffffff');
            circle(ctx, cx, cy, 1.6 * u, '#ffffff');
            break;
        case 'flippers':
            ellipse(ctx, cx - 1.5 * u, cy + 1 * u, 2 * u, 3 * u, '#ffffff');
            ellipse(ctx, cx + 1.5 * u, cy + 1 * u, 2 * u, 3 * u, '#ffffff');
            break;
        case 'rubberBoots':
            rect(ctx, cx - 2 * u, cy - 3 * u, 2.4 * u, 5 * u, '#3a2600');
            rect(ctx, cx - 2 * u, cy + 1 * u, 5 * u, 2.4 * u, '#3a2600');
            break;
    }
}
export function drawDuck(ctx, cx, cy, size, ownerSlot, colorblind) {
    const u = size / 16;
    ellipse(ctx, cx, cy + 3 * u, 6 * u, 2.4 * u, '#2f7fd6'); // little water
    ellipse(ctx, cx, cy, 5 * u, 4 * u, '#ffe14a');
    circle(ctx, cx + 3 * u, cy - 3 * u, 2.6 * u, '#ffe14a');
    circle(ctx, cx + 3.6 * u, cy - 3.4 * u, 0.7 * u, '#101018');
    tri(ctx, cx + 5 * u, cy - 3 * u, cx + 5 * u, cy - 2 * u, cx + 7.5 * u, cy - 2.5 * u, '#ff8a3c');
    rect(ctx, cx - 5 * u, cy - 6 * u, 1.6 * u, 1.6 * u, slotColor(ownerSlot, colorblind));
}
export function drawLob(ctx, cx, cy, size, ownerSlot, colorblind) {
    const u = size / 16;
    ellipse(ctx, cx, cy, 3.4 * u, 3.8 * u, '#7fd0ff');
    circle(ctx, cx - 1 * u, cy - 1 * u, 1 * u, '#ffffff');
    tri(ctx, cx - 1 * u, cy + 3 * u, cx + 1 * u, cy + 3 * u, cx, cy + 4.4 * u, slotColor(ownerSlot, colorblind));
}
//# sourceMappingURL=sprites.js.map