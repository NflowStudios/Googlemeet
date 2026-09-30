/**
 * zombie.js — IA del zombi: deambular → investigar ruidos → perseguir → atacar.
 *
 * Escuchan los eventos de ruido (correr los atrae desde lejos, caminar
 * agachado casi no los alerta) y "huelen/ven" al jugador con línea de visión.
 */

import { ZOMBIE_CFG as Z, TILE, SPECIALS } from '../config.js';
import { dist, angDiff } from '../utils.js';

const ST = { IDLE: 'idle', WANDER: 'wander', INVESTIGATE: 'investigate', SEARCH: 'search', CHASE: 'chase' };

// v0.13: burbuja de seguridad alrededor del punto de aparición del jugador.
// Ningún zombi EXTERIOR nace a menos de esta distancia → imposible aparecer
// rodeado o con un muerto pegado a la espalda. Los zombis de interior de la
// comisaría/tienda se salvan (viven tras sus muros: ahí está el riesgo),
// pero los de casas normales también la respetan.
const SPAWN_SAFE_R = 460;

export class Zombie {
  constructor(x, y, rng) {
    this.x = x; this.y = y;
    this.r = Z.radius;
    this.hp = Z.hp;
    this.z = 0;                 // los zombis viven en la planta baja
    this.state = ST.IDLE;
    this.timer = rng.range(0.5, 3);
    this.dirX = 0; this.dirY = 0;
    this.targetX = x; this.targetY = y;
    this.lastSeenX = 0; this.lastSeenY = 0;
    this.unseenT = 0;
    this.speedMul = rng.range(0.86, 1.14);
    this.tint = rng.range(0.85, 1.1);
    this.flash = 0;
    this.attackCd = 0;
    this.groanT = rng.range(1, Z.groanMax);
    this.kbx = 0; this.kby = 0;
    this.stuckT = 0;
    this.face = rng.range(0, Math.PI * 2);
    this.visibleNow = false;
  }

  takeDamage(dmg, ang, kb, game) {
    this.hp -= dmg;
    this.flash = 0.14;
    this.kbx += Math.cos(ang) * kb;
    this.kby += Math.sin(ang) * kb;
    game.map.stampBlood(this.x, this.y);
    // sabe dónde estás: lo golpeado lo enfurece
    this.state = ST.CHASE;
    this.lastSeenX = game.player.x; this.lastSeenY = game.player.y;
    this.unseenT = 0;
  }

  _seePlayer(game) {
    const p = game.player;
    // otro plano (2º piso / sótano): ni te ve ni te huele
    if ((p.z || 0) !== this.z || p.climb) return false;
    const d = dist(this.x, this.y, p.x, p.y);
    let detectR = p.sneak ? Z.detectSneak : Z.detectRadius;
    if (p.running) detectR = Math.max(detectR, Z.detectRun);
    if (d > detectR) return false;
    // forAI=true: árboles y coches tapan la vista del zombi → cobertura.
    // El jugador los ve desde arriba, pero puede esconderse detrás de ellos.
    return game.map.lineClear(this.x, this.y, p.x, p.y, true);
  }

  update(dt, game) {
    const p = game.player;
    const map = game.map;
    const d = dist(this.x, this.y, p.x, p.y);

    this.flash = Math.max(0, this.flash - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);

    // ---- percepción: ruido ----
    if (this.state !== ST.CHASE) {
      for (const ev of game.noise.frame) {
        if (dist(this.x, this.y, ev.x, ev.y) < ev.radius) {
          this.state = ST.INVESTIGATE;
          this.targetX = ev.x; this.targetY = ev.y;
          this.timer = 8; //_TIMEOUT de investigación
          break;
        }
      }
    }

    // ---- percepción: jugador ----
    const sees = this._seePlayer(game);
    if (sees) {
      if (this.state !== ST.CHASE && Math.random() < 0.4) {
        game.audio.groan(0.5, this._pan(game));
      }
      this.state = ST.CHASE;
      this.lastSeenX = p.x; this.lastSeenY = p.y;
      this.unseenT = 0;
    }

    // ---- máquina de estados ----
    let mvx = 0, mvy = 0;
    let speed = 0;
    switch (this.state) {
      case ST.IDLE:
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = ST.WANDER;
          const a = Math.random() * Math.PI * 2;
          this.dirX = Math.cos(a); this.dirY = Math.sin(a);
          this.timer = 2 + Math.random() * 3;
        }
        break;

      case ST.WANDER: {
        speed = Z.wanderSpeed * this.speedMul;
        mvx = this.dirX; mvy = this.dirY;
        this.timer -= dt;
        if (this.timer <= 0) { this.state = ST.IDLE; this.timer = 1 + Math.random() * 2.5; }
        break;
      }

      case ST.INVESTIGATE: {
        speed = Z.investigateSpeed * this.speedMul;
        const td = dist(this.x, this.y, this.targetX, this.targetY);
        if (td < 18) {
          this.state = ST.SEARCH;
          this.timer = Z.searchTime;
        } else {
          mvx = (this.targetX - this.x) / td;
          mvy = (this.targetY - this.y) / td;
        }
        this.timer -= dt;
        if (this.timer <= 0) { this.state = ST.IDLE; this.timer = 1; }
        break;
      }

      case ST.SEARCH:
        // gira sobre sí mismo buscando
        this.face += dt * 2.4;
        this.timer -= dt;
        if (this.timer <= 0) { this.state = ST.IDLE; this.timer = 1 + Math.random() * 2; }
        break;

      case ST.CHASE: {
        speed = Z.chaseSpeed * this.speedMul;
        if (sees) {
          this.lastSeenX = p.x; this.lastSeenY = p.y;
          this.unseenT = 0;
        } else {
          this.unseenT += dt;
          if (this.unseenT > Z.loseSightTime) {
            this.state = ST.INVESTIGATE;
            this.targetX = this.lastSeenX; this.targetY = this.lastSeenY;
            this.timer = 6;
            break;
          }
        }
        const td = Math.max(1, dist(this.x, this.y, this.lastSeenX, this.lastSeenY));
        mvx = (this.lastSeenX - this.x) / td;
        mvy = (this.lastSeenY - this.y) / td;
        // ataque — SOLO con línea de visión directa Y en la MISMA planta
        // (nadie muerde a través del techo): la franja del muro y las puertas
        // cerradas bloquean el golpe (mismo criterio que el melee del jugador;
        // el cristal de las ventanas deja golpear a través).
        if (d < Z.attackRange + p.r && this.attackCd <= 0 && (p.z || 0) === this.z &&
            !p.climb && map.lineClear(this.x, this.y, p.x, p.y)) {
          this.attackCd = Z.attackCd;
          game.combatZombieHit(this);
        }
        break;
      }
    }

    // ---- separación entre zombis ----
    for (const o of game.zombies) {
      if (o === this) continue;
      const dx = this.x - o.x, dy = this.y - o.y;
      const dd = dx * dx + dy * dy;
      if (dd < 484 && dd > 0.01) { // 22²
        const inv = 1 / Math.sqrt(dd);
        mvx += dx * inv * 0.5;
        mvy += dy * inv * 0.5;
      }
    }

    // ---- movimiento + knockback ----
    const ox = this.x, oy = this.y;
    if (speed > 0 || this.kbx !== 0 || this.kby !== 0) {
      map.moveCircle(this, (mvx * speed + this.kbx) * dt, (mvy * speed + this.kby) * dt);
    }
    this.kbx *= Math.pow(0.0005, dt);
    this.kby *= Math.pow(0.0005, dt);
    if (Math.abs(this.kbx) < 1) this.kbx = 0;
    if (Math.abs(this.kby) < 1) this.kby = 0;

    // orientación
    if (mvx !== 0 || mvy !== 0) {
      this.face = Math.atan2(mvy, mvx);
    }

    // atascado persiguiendo: rodear dando un rodeo
    if (this.state === ST.CHASE) {
      const movedD = Math.hypot(this.x - ox, this.y - oy);
      if (movedD < speed * dt * 0.25) {
        this.stuckT += dt;
        if (this.stuckT > 0.7) {
          // desliza en perpendicular
          const perp = Math.random() < 0.5 ? 1 : -1;
          const px = -mvy * perp, py = mvx * perp;
          map.moveCircle(this, px * speed * dt * 8, py * speed * dt * 8);
          this.stuckT = 0.3;
        }
      } else {
        this.stuckT = Math.max(0, this.stuckT - dt);
      }
    }

    // ---- gemidos espaciales ----
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = Z.groanMin + Math.random() * (Z.groanMax - Z.groanMin);
      if (d < 300) {
        game.audio.groan(1 - d / 300, this._pan(game));
      }
    }
  }

  _pan(game) {
    const p = game.player;
    const a = Math.atan2(this.y - p.y, this.x - p.x);
    return Math.max(-1, Math.min(1, Math.sin(angDiff(p.angle, a))));
  }

  draw(ctx, cam) {
    const s = cam.worldToScreen(this.x, this.y);
    const hurt = this.hp < 50;

    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(s.x + 2, s.y + 3, this.r, this.r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // brazos extendidos (más abiertos al perseguir)
    const chase = this.state === ST.CHASE;
    const armSpread = chase ? 0.9 : 0.55;
    const armReach = chase ? this.r + 5 : this.r + 2;
    ctx.fillStyle = `rgb(${Math.round(96 * this.tint)}, ${Math.round(108 * this.tint)}, ${Math.round(80 * this.tint)})`;
    for (const side of [-armSpread, armSpread]) {
      const ax = s.x + Math.cos(this.face + side) * armReach;
      const ay = s.y + Math.sin(this.face + side) * armReach;
      ctx.beginPath(); ctx.arc(ax, ay, 3.4, 0, Math.PI * 2); ctx.fill();
    }

    // cuerpo
    ctx.fillStyle = `rgb(${Math.round(104 * this.tint)}, ${Math.round(116 * this.tint)}, ${Math.round(84 * this.tint)})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();

    // heridas
    if (hurt) {
      ctx.fillStyle = 'rgba(90,14,14,0.75)';
      ctx.beginPath(); ctx.arc(s.x - 3, s.y - 2, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s.x + 4, s.y + 3, 2.6, 0, Math.PI * 2); ctx.fill();
    }

    // cabeza
    ctx.fillStyle = `rgb(${Math.round(112 * this.tint)}, ${Math.round(126 * this.tint)}, ${Math.round(92 * this.tint)})`;
    ctx.beginPath();
    ctx.arc(s.x + Math.cos(this.face) * 2, s.y + Math.sin(this.face) * 2, this.r * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // ojos rojos al perseguir
    if (chase) {
      ctx.fillStyle = '#d83a2a';
      for (const side of [-0.35, 0.35]) {
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(this.face + side) * 5, s.y + Math.sin(this.face + side) * 5, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // flash al recibir daño
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 4})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, this.r + 1, 0, Math.PI * 2); ctx.fill();
    }

    // barra de vida pequeña solo si está herido
    if (this.hp < Z.hp && this.hp > 0) {
      const w = 18;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(s.x - w / 2, s.y - this.r - 8, w, 3);
      ctx.fillStyle = '#b83a2a';
      ctx.fillRect(s.x - w / 2, s.y - this.r - 8, w * Math.max(0, this.hp / Z.hp), 3);
    }
  }
}

/** Crea la horda inicial repartida por el mapa. */
export function spawnZombies(map, rng, count, spawnPoint) {
  const zombies = [];
  // v0.13: nada de zombis (de calle o de casas normales) dentro de la
  // burbuja de seguridad del spawn — se re-muestrea hasta salir de ella.
  const safe = (pos) => Math.hypot(pos.x - spawnPoint.x, pos.y - spawnPoint.y) >= SPAWN_SAFE_R;
  let guard = 0;
  while (zombies.length < count && guard < count * 60) {
    guard++;
    let pos = null;
    if (rng.chance(0.32)) {
      for (let k = 0; k < 30 && !pos; k++) {
        const p = map.randomIndoor();
        if (p && safe(p)) pos = p;
      }
    }
    if (!pos) {
      for (let k = 0; k < 30 && !pos; k++) {
        const p = map.randomOutdoor(spawnPoint, SPAWN_SAFE_R);
        if (p) pos = p;
      }
    }
    if (!pos) continue;
    if (map.circleHitsSolid(pos.x, pos.y, 12)) continue;
    zombies.push(new Zombie(pos.x, pos.y, rng));
  }

  // --- Densidad extra por estructura especial (v0.10) ---
  // La COMISARÍA concentra el mayor peligro del mapa (los agentes cayeron
  // dentro) y la TIENDA tiene presión media: zombis dentro + alrededor.
  // Cantidades FIJAS (SPECIALS.inside/around) → total determinista.
  // v0.13: los de ALREDEDOR también rehúyen la burbuja del spawn del jugador
  // (la estructura puede quedar cerca del centro del mapa).
  for (const b of map.buildings) {
    if (b.kind !== 'police' && b.kind !== 'store') continue;
    const sp = SPECIALS[b.kind];
    for (let i = 0; i < sp.inside; i++) {
      const pos = map.randomIndoorIn(b);
      if (!pos) break;
      zombies.push(new Zombie(pos.x, pos.y, rng));
    }
    for (let i = 0; i < sp.around; i++) {
      let pos = null;
      for (let k = 0; k < 60 && !pos; k++) {
        const p = map.randomOutdoorNear(b.cx, b.cy, TILE * 3.5, TILE * 11);
        if (p && safe(p)) pos = p;
      }
      if (!pos) break;
      zombies.push(new Zombie(pos.x, pos.y, rng));
    }
  }
  return zombies;
}

// ================== Serialización (v0.13: guardado de partidas) ==================

/** Estado persistente de un zombi (compacto, claves cortas). */
export function zombieToData(z) {
  return {
    x: +z.x.toFixed(1), y: +z.y.toFixed(1), hp: z.hp,
    st: z.state, tm: +z.timer.toFixed(2),
    dx: +z.dirX.toFixed(2), dy: +z.dirY.toFixed(2),
    tx: +z.targetX.toFixed(1), ty: +z.targetY.toFixed(1),
    lx: +z.lastSeenX.toFixed(1), ly: +z.lastSeenY.toFixed(1),
    un: +z.unseenT.toFixed(2), sm: +z.speedMul.toFixed(3),
    ti: +z.tint.toFixed(3), gr: +z.groanT.toFixed(1), fa: +z.face.toFixed(3),
  };
}

/** Reconstruye un zombi a partir de sus datos guardados. */
export function zombieFromData(d) {
  const z = Object.create(Zombie.prototype);
  z.x = d.x; z.y = d.y;
  z.r = Z.radius;
  z.hp = d.hp;
  z.z = 0;                       // los zombis viven en la planta baja
  z.state = d.st || ST.IDLE;
  z.timer = d.tm ?? 1;
  z.dirX = d.dx || 0; z.dirY = d.dy || 0;
  z.targetX = d.tx ?? d.x; z.targetY = d.ty ?? d.y;
  z.lastSeenX = d.lx || 0; z.lastSeenY = d.ly || 0;
  z.unseenT = d.un || 0;
  z.speedMul = d.sm || 1;
  z.tint = d.ti || 1;
  z.flash = 0; z.attackCd = 0;
  z.groanT = d.gr ?? 5;
  z.kbx = 0; z.kby = 0; z.stuckT = 0;
  z.face = d.fa || 0;
  z.visibleNow = false;
  return z;
}
