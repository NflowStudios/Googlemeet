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

  // Estructura con línea de visión (muros/ventanas/puertas) redibujada NÍTIDA
  // por encima de la niebla: las paredes se distinguen con claridad en todo
  // el cono, pero el interior sigue oculto salvo por ventanas/puertas abiertas
  game.map.drawStructOver(ctx, cam, game);

  // ---- espacio de pantalla ----
  drawCrosshair(ctx, game);
  drawVignettes(ctx, game);
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
