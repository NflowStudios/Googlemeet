/**
 * render.js — Composición del frame: mundo → entidades → copas → ruido →
 * niebla de guerra (dinámica día/noche) → estructura iluminada → TECHOS →
 * tinte ambiente día/noche → CLIMA (v0.15: lluvia/neblina) → retícula →
 * viñetas de estado.
 */

import { DAYNIGHT, HOSPITAL } from './config.js';
import { flashActive, isInHospital } from './systems/flashlight.js';
import {
  drawConstructions, drawFires, drawMolotovs, drawBuildGhost,
} from './systems/crafting.js';

export function renderGame(ctx, game) {
  const cam = game.cam;
  const w = cam.w, h = cam.h;
  // suelo, marcas, coches, decals, contenedores
  game.map.drawGround(ctx, cam);

  // PLANTA EXTRA (2º piso / sótano) del edificio en el que está el jugador:
  // en planta baja es invisible (alpha 0 — no se ve el otro piso), mientras
  // subes/bajas las escaleras va apareciendo con un fundido progresivo y al
  // llegar es opaca (tapa lo que hay debajo).
  // v0.19: se dibuja ANTES de las entidades — el canvas OPACO de la planta
  // (hormigón del sótano, linóleo del hospital) debe quedar DEBAJO de los
  // zombis y objetos de esa planta: si se pintara después, los taparía y
  // recibirías daño de enemigos invisibles (bug del sótano v0.18).
  game.map.drawFloorLayer(ctx, cam, game);

  // entidades de la planta: fundido escalonado al subir/bajar (aparecen con
  // la planta destino, no de golpe)
  const _p = game.player;
  const entA = (_p && _p.climb && _p.climb.to !== 0) ? _p.climb.k : 1;
  if (entA < 1) ctx.globalAlpha = entA;

  // v0.20: CONSTRUCCIONES del jugador (barricadas, vallas, trampas, cajas,
  // camas, mesas) — bajo los zombis y objetos del suelo, como el mobiliario
  // del mundo que son
  drawConstructions(ctx, cam, game);

  // objetos del suelo (solo si son visibles ahora)
  for (const gi of game.groundItems) {
    if (!gi.visibleNow) continue;
    const s = cam.worldToScreen(gi.x, gi.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(s.x - 8, s.y - 4, 20, 16);
    ctx.fillStyle = gi.item.def.color || '#8a8a8a';
    ctx.fillRect(s.x - 9, s.y - 7, 18, 14);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(s.x - 9, s.y - 7, 18, 14);
    ctx.fillStyle = 'rgba(15,15,15,0.85)';
    ctx.font = 'bold 9px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(gi.item.def.name.charAt(0), s.x, s.y + 1);
  }

  // zombis (solo visibles en el cono/radio de visión actual)
  for (const z of game.zombies) {
    if (z.visibleNow) z.draw(ctx, cam);
  }

  if (entA < 1) ctx.globalAlpha = 1;

  // jugador
  if (game.player) game.player.draw(ctx, cam);

  // copas de árboles por encima
  game.map.drawOverhead(ctx, cam);

  // ondas de ruido tenues
  game.noise.draw(ctx, cam);

  // niebla de guerra (85%): solo visión en tiempo real, la espalda oculta
  game.vision.render(ctx, game);

  // Estructura y props (muros/ventanas/puertas/árboles/coches) con línea de
  // visión redibujados NÍTIDOS por encima de la niebla: se distinguen con
  // claridad en todo el cono. Árboles y coches no tapan la vista.
  game.map.drawStructOver(ctx, cam, game);

  // TECHOS por encima de todo lo estructural — solo de los edificios dentro
  // del cono actual (filosofía de visión estricta: a tu espalda, oscuridad).
  // El techo es la superficie visible del edificio: tapa muros e interior
  // desde lejos, se atenúa al acercarse (se ve por las ventanas) y desaparece
  // mientras estás DENTRO.
  game.map.drawRoofs(ctx, cam, game);

  // efectos de disparo: trazadoras, fogonazos e impactos (siempre visibles
  // dentro del cono; ocurren delante del jugador)
  drawGunFX(ctx, game);

  // v0.20: botellas de molotov en vuelo y ZONAS DE FUEGO (aditivas, por
  // encima de los velos para que iluminen de verdad)
  drawMolotovs(ctx, cam, game);
  drawFires(ctx, cam, game);

  // v0.20: fantasma del modo construcción (encima de todo: es una decisión
  // del jugador, no parte del mundo)
  drawBuildGhost(ctx, cam, game);

  // ---- tinte ambiente del ciclo día/noche (v0.11) ----
  // Noche: velo azul oscuro sobre TODO el frame (con el cono encima se sigue
  // viendo, pero el mundo pesa). Amanecer/atardecer: golpe cálido anaranjado.
  drawDayNightTint(ctx, game);

  // ---- clima (v0.15): lluvia en cortinas + gris azulado, neblina lechosa
  // con bancos a la deriva. Mecánica aparte: el cono ya se contrajo en
  // vision.js (neblina −50%, lluvia −12%).
  drawWeatherFX(ctx, game);

  // ---- v0.18: APAGÓN del hospital — velo oscuro extra mientras estás
  // dentro (con el haz encendido casi desaparece: la luz lo despeja)
  drawHospitalFX(ctx, game);

  // ---- v0.17: haz de la linterna (si está encendida) — se dibuja ENCIMA de
  // los velos de noche y clima para iluminar de verdad el cono de visión ----
  drawFlashlightFX(ctx, game);

  // ---- espacio de pantalla ----
  drawCrosshair(ctx, game);
  drawVignettes(ctx, game);

  // v0.20: DORMIR — fundido a negro mientras el mundo espera al despertar
  if (game.sleepT > 0) {
    const k = Math.min(1, game.sleepT / 1.4);
    ctx.fillStyle = `rgba(2, 3, 2, ${(k * k * 0.96).toFixed(3)})`;
    ctx.fillRect(0, 0, game.cam.w, game.cam.h);
  }
}

/** Velo de ambiente según la hora: azul de noche, cálido al alba/ocaso. */
function drawDayNightTint(ctx, game) {
  const dn = game.daynight;
  if (!dn) return;
  const w = game.cam.w, h = game.cam.h;
  const dusk = dn.duskGlow, dark = dn.darkness;
  if (dusk > 0.01) {
    ctx.fillStyle = `rgba(215, 130, 55, ${(DAYNIGHT.tintDusk * dusk).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (dark > 0.01) {
    ctx.fillStyle = `rgba(9, 13, 30, ${(DAYNIGHT.tintNight * dark).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }
}

// ================== Linterna (v0.17) ==================

/**
 * Haz de la linterna: cuña cálida ADITIVA sobre el cono de visión (encima
 * del velo nocturno y del clima, así "ilumina" de verdad) con un degradado
 * que se apaga hacia el alcance efectivo, un halo suave alrededor del
 * jugador (luz derramada) y un parpadeo sutil determinista del tiempo.
 */
function drawFlashlightFX(ctx, game) {
  if (!flashActive(game)) return;
  const cam = game.cam, p = game.player;
  const cone = game.vision.cone;
  if (!cone || cone.length < 2) return;
  const r = Math.max(60, game.vision.rangeNow || 440);
  // parpadeo sutil (función del tiempo: nada de estado que serializar)
  const t = game.time;
  const flick = 0.9 + 0.08 * Math.sin(t * 11.3) * Math.sin(t * 3.7);
  const s = cam.worldToScreen(p.x, p.y);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // cuña cálida sobre el cono (más ámbar y presente: se LEE como linterna)
  const grad = ctx.createRadialGradient(s.x, s.y, 8, s.x, s.y, r);
  grad.addColorStop(0, `rgba(255, 228, 150, ${(0.34 * flick).toFixed(3)})`);
  grad.addColorStop(0.5, `rgba(255, 222, 140, ${(0.18 * flick).toFixed(3)})`);
  grad.addColorStop(1, 'rgba(255, 216, 130, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  for (const q of cone) {
    const ss = cam.worldToScreen(q[0], q[1]);
    ctx.lineTo(ss.x, ss.y);
  }
  ctx.closePath();
  ctx.fill();

  // halo suave alrededor del jugador (la luz que se derrama a la espalda)
  const halo = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, 52);
  halo.addColorStop(0, `rgba(255, 232, 160, ${(0.14 * flick).toFixed(3)})`);
  halo.addColorStop(1, 'rgba(255, 232, 160, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 52, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ================== Hospital: el apagón (v0.18) ==================

/**
 * Velo del APAGÓN: dentro del hospital no hay luz eléctrica, así que el
 * interior queda sumido en una oscuridad EXTRA (además de la contracción
 * del cono que ya hizo vision.js). Escala con la oscuridad de la hora y
 * casi se despeja con el haz de la linterna encendido.
 */
function drawHospitalFX(ctx, game) {
  if (!isInHospital(game)) return;
  const dark = game.daynight ? game.daynight.darkness : 0;
  const k = dark * (flashActive(game) ? 0.2 : 1);
  if (k <= 0.01) return;
  const w = game.cam.w, h = game.cam.h;
  ctx.fillStyle = `rgba(2, 4, 10, ${(HOSPITAL.tintMax * k).toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);
}

// ================== Clima (v0.15) ==================

/** Hash determinista [0,1) — animación SIN estado de las gotas/bancos. */
function _h1(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** Módulo siempre positivo (para el wrap-around de las gotas). */
const _wrap = (v, m) => ((v % m) + m) % m;

/**
 * Lluvia: cortinas de gotas diagonales (caen con un ligero viento) sobre un
 * velo gris azulado. La animación es pura función del tiempo: nada de estado
 * que serializar ni que pueda desincronizarse con el guardado.
 */
function drawRain(ctx, w, h, i, t) {
  // velo de cielo encapotado
  ctx.fillStyle = `rgba(34, 42, 54, ${(0.11 * i).toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);

  const n = Math.round(150 * i);
  if (!n) return;
  ctx.save();
  ctx.strokeStyle = `rgba(172, 192, 214, ${(0.30 * i).toFixed(3)})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const spanY = h + 40;
  const spanX = w + 120;
  for (let k = 0; k < n; k++) {
    const spd = 560 + _h1(k + 7.3) * 340;         // px/s de caída
    const drift = -70 - _h1(k + 3.1) * 55;        // viento hacia la izquierda
    const len = 11 + _h1(k + 11.7) * 9;           // largo del trazo
    const y = _wrap(_h1(k + 5.9) * spanY + t * spd, spanY) - 20;
    const x = _wrap(_h1(k) * spanX + t * drift, spanX) - 60;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (drift / spd) * len, y + len);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Neblina: velo lechoso general + bancos amplios a la deriva (radios grandes
 * que se solapan). La parte MECÁNICA (cono a la mitad) ya la hizo vision.js;
 * esto vende la sensación de mundo cerrado.
 */
function drawFog(ctx, w, h, i, t) {
  ctx.fillStyle = `rgba(184, 192, 198, ${(0.15 * i).toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);
  const big = Math.max(w, h);
  for (let k = 0; k < 6; k++) {
    const ph = _h1(k) * Math.PI * 2;
    const spd = 0.05 + _h1(k + 2.2) * 0.06;
    const cx = w * (0.15 + 0.7 * _h1(k + 4.4)) + Math.cos(t * spd + ph) * w * 0.2;
    const cy = h * (0.15 + 0.7 * _h1(k + 8.8)) + Math.sin(t * spd * 1.3 + ph) * h * 0.18;
    const R = big * (0.22 + _h1(k + 13.1) * 0.15);
    const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
    g.addColorStop(0, `rgba(200, 208, 214, ${(0.085 * i).toFixed(3)})`);
    g.addColorStop(1, 'rgba(200, 208, 214, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

/** Capa climática del frame: solo si hay frente activo con intensidad. */
function drawWeatherFX(ctx, game) {
  const wx = game.weather;
  if (!wx || wx.type === 'clear') return;
  const i = wx.intensity;
  if (i <= 0.01) return;
  const w = game.cam.w, h = game.cam.h;
  const t = performance.now() / 1000;
  if (wx.type === 'rain') drawRain(ctx, w, h, i, t);
  else drawFog(ctx, w, h, i, t);
}

/** Trazadoras, fogonazos y polvo de impacto de las armas de fuego. */
function drawGunFX(ctx, game) {
  const cam = game.cam;

  // trazadoras: líneas brillantes que se apagan en ~75 ms
  if (game.tracers && game.tracers.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const tr of game.tracers) {
      const k = 1 - tr.t / tr.life;
      const x1 = tr.x1 - cam.x + cam.offX, y1 = tr.y1 - cam.y + cam.offY;
      const x2 = tr.x2 - cam.x + cam.offX, y2 = tr.y2 - cam.y + cam.offY;
      ctx.strokeStyle = `rgba(255, 238, 180, ${0.75 * k})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();
  }

  // fogonazos: destello aditivo en la boca del cañón
  if (game.flashes && game.flashes.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const fl of game.flashes) {
      const k = 1 - fl.t / fl.life;
      const x = fl.x - cam.x + cam.offX, y = fl.y - cam.y + cam.offY;
      const R = (fl.big ? 26 : 18) * (0.7 + 0.3 * k);
      // halo
      const g = ctx.createRadialGradient(x, y, 1, x, y, R);
      g.addColorStop(0, `rgba(255, 210, 120, ${0.55 * k})`);
      g.addColorStop(1, 'rgba(255, 160, 60, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      // lengüeta de fuego
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(fl.a);
      ctx.fillStyle = `rgba(255, 240, 190, ${0.9 * k})`;
      ctx.beginPath();
      const L = fl.big ? 16 : 11;
      ctx.moveTo(0, -3.2); ctx.lineTo(L, 0); ctx.lineTo(0, 3.2); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // impactos en muro: puff de polvo que se expande
  if (game.impacts && game.impacts.length) {
    for (const im of game.impacts) {
      const k = im.t / im.life;
      const x = im.x - cam.x + cam.offX, y = im.y - cam.y + cam.offY;
      ctx.fillStyle = `rgba(200, 195, 180, ${0.5 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(x, y, 2.5 + k * 7, 0, Math.PI * 2); ctx.fill();
      // chispa
      ctx.fillStyle = `rgba(255, 230, 160, ${0.8 * Math.max(0, 1 - k * 3)})`;
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawCrosshair(ctx, game) {
  if (game.state !== 'playing' || game.uiOpen) return;
  const m = game.input.mouse;
  const ready = game.player.cooldown <= 0;
  ctx.save();
  ctx.strokeStyle = ready ? 'rgba(216,213,204,0.85)' : 'rgba(200,80,60,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(m.x, m.y, 7, 0, Math.PI * 2);
  ctx.stroke();
  for (const [dx, dy] of [[-11, 0], [11, 0], [0, -11], [0, 11]]) {
    ctx.beginPath();
    ctx.moveTo(m.x + dx * 0.55, m.y + dy * 0.55);
    ctx.lineTo(m.x + dx, m.y + dy);
    ctx.stroke();
  }
  ctx.fillStyle = ready ? 'rgba(216,213,204,0.9)' : 'rgba(200,80,60,0.6)';
  ctx.beginPath();
  ctx.arc(m.x, m.y, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawVignettes(ctx, game) {
  const cam = game.cam;
  const w = cam.w, h = cam.h;
  const s = game.survival;
  if (!s) return;

  // viñeta base cinematográfica
  let g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // pulso rojo con vida baja
  if (s.health < 30) {
    const k = 1 - s.health / 30;
    const a = (0.10 + 0.07 * Math.sin(performance.now() / 180)) * k;
    g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(120,0,0,0)');
    g.addColorStop(1, `rgba(150,10,10,${Math.max(0, a)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // tinte verdoso por infección
  if (s.infected) {
    ctx.fillStyle = `rgba(70,130,45,${0.06 + 0.16 * (s.infection / 100)})`;
    ctx.fillRect(0, 0, w, h);
  }

  // flash de daño
  const df = game.hud.dmgFlash;
  if (df > 0) {
    g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(160,20,20,0)');
    g.addColorStop(1, `rgba(190,25,25,${Math.min(0.55, df * 1.6)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
