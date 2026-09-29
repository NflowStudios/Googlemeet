/**
 * render.js — Composición del frame: mundo → entidades → copas → ruido →
 * niebla de guerra → estructura iluminada → retícula → viñetas de estado.
 */

export function renderGame(ctx, game) {
  const cam = game.cam;
  const w = cam.w, h = cam.h;
  // suelo, marcas, coches, decals, contenedores
  game.map.drawGround(ctx, cam);

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

  // jugador
  if (game.player) game.player.draw(ctx, cam);

  // copas de árboles por encima
  game.map.drawOverhead(ctx, cam);

  // ondas de ruido tenues
  game.noise.draw(ctx, cam);

  // niebla de guerra (solo visión en tiempo real: la espalda queda oculta)
  game.vision.render(ctx, game);

  // Estructura y props (muros/ventanas/puertas/árboles/coches) con línea de
  // visión redibujados NÍTIDOS por encima de la niebla: se distinguen con
  // claridad en todo el cono, pero el interior sigue oculto salvo por
  // ventanas/puertas abiertas. Árboles y coches no tapan la vista.
  game.map.drawStructOver(ctx, cam, game);

  // efectos de disparo: trazadoras, fogonazos e impactos (siempre visibles
  // dentro del cono; ocurren delante del jugador)
  drawGunFX(ctx, game);

  // ---- espacio de pantalla ----
  drawCrosshair(ctx, game);
  drawVignettes(ctx, game);
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
