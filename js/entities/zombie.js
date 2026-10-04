/**
 * zombie.js — IA del zombi: deambular → investigar ruidos → perseguir → atacar.
 *
 * Escuchan los eventos de ruido (correr los atrae desde lejos, caminar
 * agachado casi no los alerta) y "huelen/ven" al jugador con línea de visión.
 *
 * v0.14 — VARIANTES:
 *  - normal:  el de toda la vida (equilibrado).
 *  - runner:  CORREDOR — mitad de vida y rápido, pero con margen para
 *             contragolpear (v0.15: 148 px/s — caminando te alcanza,
 *             esprintando le ganas de verdad; su golpe deja respiro).
 *             Carne fresca rosada y chillidos agudos.
 *  - brute:   BRUTO — solo en comisaría/tienda y ocasionalmente vagando por
 *             el mapa. Lento, muchísima vida, golpes demoledores y apenas
 *             retrocede al recibir impactos. Masa oscura y retumbo grave.
 *
 * v0.23 — GRITADOR: 4ª variante RARA (no nace con la horda: main.js la hace
 *  EMERGER donde hay mucha población zombi). Al verte se PARA, hincha el
 *  pecho (screamWindup s de aviso — la ventana del jugador) y CHILLA:
 *  un evento de ruido gigante (screamR px) que arrastra a todos los
 *  zombis que lo oyen hacia su posición. Frágil: mátalo durante el aviso.
 *
 * v0.15 — CLIMA: con NEBLINA el alcance al que ven/huelen al jugador se
 * contrae en la misma medida que la visión del jugador (hasta la mitad):
 * todos van a tientas. La lluvia no los ciega (solo enmascara el ruido,
 * cosa de noise.js)… y también amortigua el CHILLIDO del gritador.
 */

import { ZOMBIE_CFG as Z, TILE, T, SPECIALS, CRAFTEO } from '../config.js';
import { dist, angDiff } from '../utils.js';
import { damageConstruction, drawBurnFlames } from '../systems/crafting.js';

const ST = { IDLE: 'idle', WANDER: 'wander', INVESTIGATE: 'investigate', SEARCH: 'search', CHASE: 'chase' };

// v0.13: burbuja de seguridad alrededor del punto de aparición del jugador.
// Ningún zombi EXTERIOR nace a menos de esta distancia → imposible aparecer
// rodeado o con un muerto pegado a la espalda. Los zombis de interior de la
// comisaría/tienda se salvan (viven tras sus muros: ahí está el riesgo),
// pero los de casas normales también la respetan.
const SPAWN_SAFE_R = 460;

/**
 * Aplica a un zombi las estadísticas de su variante (v0.14).
 * Comparte constructor y deserialización: una única fuente de verdad.
 */
function applyVariant(z, variant) {
  const v = (variant !== 'normal' && Z.variants[variant]) ? Z.variants[variant] : null;
  z.variant = v ? variant : 'normal';
  z.r = v ? v.radius : Z.radius;
  z.maxHp = v ? v.hp : Z.hp;
  z.wanderSpeed = v ? v.wanderSpeed : Z.wanderSpeed;
  z.investigateSpeed = v ? v.investigateSpeed : Z.investigateSpeed;
  z.chaseSpeed = v ? v.chaseSpeed : Z.chaseSpeed;
  z.attackRange = v ? v.attackRange : Z.attackRange;
  z.attackCdBase = v ? v.attackCd : Z.attackCd;
  z.dmgMin = v ? v.dmgMin : Z.dmgMin;
  z.dmgMax = v ? v.dmgMax : Z.dmgMax;
  z.loseSightTime = v ? v.loseSightTime : Z.loseSightTime;
  z.kbMult = v ? v.kbMult : 1;
  z.groanPitch = v ? v.groanPitch : 1;
  z.speedMulRange = v && v.speedMulRange ? v.speedMulRange : [0.86, 1.14];
}

export class Zombie {
  constructor(x, y, rng, variant = 'normal', z = 0) {
    this.x = x; this.y = y;
    applyVariant(this, variant);
    this.hp = this.maxHp;
    this.z = z;                 // planta: 0 calle/baja, -1 sótanos (base militar)
    this.state = ST.IDLE;
    this.timer = rng.range(0.5, 3);
    this.dirX = 0; this.dirY = 0;
    this.targetX = x; this.targetY = y;
    this.lastSeenX = 0; this.lastSeenY = 0;
    this.unseenT = 0;
    this.speedMul = rng.range(this.speedMulRange[0], this.speedMulRange[1]);
    this.tint = rng.range(0.85, 1.1);
    this.flash = 0;
    this.attackCd = 0;
    this.groanT = rng.range(1, Z.groanMax);
    this.kbx = 0; this.kby = 0;
    this.stuckT = 0;
    this.burn = 0;              // v0.20: segundos de QUemadura restantes (antorcha/molotov)
    this.screamT = 0;           // v0.23: gritador — cuenta atrás del AVISO (windup)
    this.screamCd = 0;          // v0.23: gritador — enfriamiento entre chillidos
    this.face = rng.range(0, Math.PI * 2);
    this.visibleNow = false;
  }

  takeDamage(dmg, ang, kb, game) {
    this.hp -= dmg;
    this.flash = 0.14;
    // v0.14: el empuje depende de la masa (el bruto apenas se mueve;
    // el corredor, ligero, sale despedido)
    this.kbx += Math.cos(ang) * kb * this.kbMult;
    this.kby += Math.sin(ang) * kb * this.kbMult;
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
    // v0.15: la neblina cierra SU alcance visual igual que el del jugador
    // (la lluvia no: solo enmascara el sonido en noise.js)
    if (game.weather) detectR *= game.weather.zombieSightMul();
    if (d > detectR) return false;
    // forAI=true: árboles y coches tapan la vista del zombi → cobertura.
    // El jugador los ve desde arriba, pero puede esconderse detrás de ellos.
    // v0.16: la línea de visión es la de TU planta (el sótano tiene sus muros)
    return game.map.lineClearZ(this.x, this.y, p.x, p.y, this.z);
  }

  update(dt, game) {
    const p = game.player;
    const map = game.map;
    const d = dist(this.x, this.y, p.x, p.y);

    this.flash = Math.max(0, this.flash - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);

    // ---- v0.20: QUEMADURA (antorcha / molotov) — arde y se consume ----
    if (this.burn > 0) {
      this.burn -= dt;
      this.hp -= CRAFTEO.burnDps * dt;
      this.flash = Math.max(this.flash, 0.08);
      if (this.hp <= 0) {
        game.killZombie(this);
        return;
      }
    }

    // ---- v0.23: GRITADOR — enfriamiento del chillido ----
    if (this.screamCd > 0) this.screamCd = Math.max(0, this.screamCd - dt);
    if (this.screamT > 0) {
      // AVISO (windup): parado, hinchándose… al agotarse, CHILLA
      this.screamT -= dt;
      if (this.screamT <= 0) this._doScream(game);
    }

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
        game.audio.groan(0.5, this._pan(game), this.groanPitch);
      }
      // v0.14: primera vez que una VARIANTE te ve → mini bestiario (una vez
      // por partida y variante) para que el jugador sepa a qué se enfrenta
      if (this.variant !== 'normal') {
        const seen = game._seenVariants || (game._seenVariants = {});
        if (!seen[this.variant]) {
          seen[this.variant] = true;
          game.toasts.push(this.variant === 'runner'
            ? '¡CORREDOR! Frágil y veloz — esprintando le ganas: gana distancia y contragolpea'
            : this.variant === 'screamer'
              ? '¡GRITADOR! Va a CHILLAR — mátalo ya o convocará a toda la zona'
              : '¡BRUTO! Lento pero brutal: mucha vida y golpes demoledores', 'warn');
          game.audio.groan(1, this._pan(game), this.groanPitch);
        }
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
        speed = this.wanderSpeed * this.speedMul;
        mvx = this.dirX; mvy = this.dirY;
        this.timer -= dt;
        if (this.timer <= 0) { this.state = ST.IDLE; this.timer = 1 + Math.random() * 2.5; }
        break;
      }

      case ST.INVESTIGATE: {
        speed = this.investigateSpeed * this.speedMul;
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
        speed = this.chaseSpeed * this.speedMul;
        // v0.23: el GRITADOR prepara su chillido al verte (si no está en
        // enfriamiento). El aviso lo arraiga en el sitio: su única debilidad.
        if (this.variant === 'screamer' && sees && this.screamCd <= 0 && this.screamT <= 0) {
          this.screamT = Z.variants.screamer.screamWindup;
        }
        if (sees) {
          this.lastSeenX = p.x; this.lastSeenY = p.y;
          this.unseenT = 0;
        } else {
          this.unseenT += dt;
          if (this.unseenT > this.loseSightTime) {
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
        if (d < this.attackRange + p.r && this.attackCd <= 0 && (p.z || 0) === this.z &&
            !p.climb && map.lineClearZ(this.x, this.y, p.x, p.y, this.z)) {
          this.attackCd = this.attackCdBase;
          game.combatZombieHit(this);
        }
        break;
      }
    }

    // ---- separación entre zombis (v0.14: según los radios reales;
    // normal+normal sigue siendo 22 px, como siempre) ----
    for (const o of game.zombies) {
      if (o === this) continue;
      if ((o.z || 0) !== this.z) continue;   // v0.16: no se empujan a través del suelo
      const dx = this.x - o.x, dy = this.y - o.y;
      const dd = dx * dx + dy * dy;
      const sep = this.r + o.r + 2;
      if (dd < sep * sep && dd > 0.01) {
        const inv = 1 / Math.sqrt(dd);
        mvx += dx * inv * 0.5;
        mvy += dy * inv * 0.5;
      }
    }

    // ---- v0.23: GRITADOR preparando el chillido → ARRAIGADO en el sitio
    // (el aviso es su debilidad: queda expuesto ~1 s). El knockback sigue
    // funcionando: puedes empujarlo, pero no avanza por su propio pie.
    if (this.screamT > 0) { speed = 0; mvx = 0; mvy = 0; }

    // ---- movimiento + knockback ----
    const ox = this.x, oy = this.y;
    if (speed > 0 || this.kbx !== 0 || this.kby !== 0) {
      map.moveCircle(this, (mvx * speed + this.kbx) * dt, (mvy * speed + this.kby) * dt, this.z || 0);
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
          map.moveCircle(this, px * speed * dt * 8, py * speed * dt * 8, this.z || 0);
          this.stuckT = 0.3;
        }
        // v0.20: si lo que frena al zombi es una CONSTRUCCIÓN (barricada,
        // valla, tablones), la golpea con su cadencia — PZ-style
        if (this.stuckT > 0.45 && this.attackCd <= 0) {
          const c = map.constructionNear(this.x + Math.cos(this.face) * 20, this.y + Math.sin(this.face) * 20);
          if (c) {
            this.attackCd = this.attackCdBase;
            const dmg = this.dmgMin + Math.random() * (this.dmgMax - this.dmgMin);
            damageConstruction(game, c, dmg, false);
          }
        }
      } else {
        this.stuckT = Math.max(0, this.stuckT - dt);
      }
    }

    // ---- gemidos espaciales (v0.14: tono según variante) ----
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = Z.groanMin + Math.random() * (Z.groanMax - Z.groanMin);
      if (d < 300) {
        game.audio.groan(1 - d / 300, this._pan(game), this.groanPitch);
      }
    }
  }

  /**
   * v0.23 — EL CHILLIDO del gritador. Estallido agudo + evento de ruido
   * GIGANTE (screamR px, ajustado por el clima: la lluvia lo amortigua)
   * que convoca a todos los zombis que lo oyen: los que no perseguían ya
   * al jugador pasan a INVESTIGAR la posición del gritador… que va detrás
   * del jugador. En la práctica: la horda del barrio entero converge.
   * Se avisa UNA vez por partida de qué acaba de pasar.
   */
  _doScream(game) {
    const v = Z.variants.screamer;
    this.screamT = 0;
    this.screamCd = v.screamCd;
    game.audio.scream(this._pan(game));
    game.cam.shake(2.5);
    // anillos rojos: la onda del chillido es VISIBLE en el suelo
    game.noise.emit(this.x, this.y, v.screamR, 'chillido', 'scream');
    if (!game._screamedOnce) {
      game._screamedOnce = true;
      game.toasts.push('¡CHILLIDO! El gritador ha convocado a todos los zombis de la zona', 'bad');
    }
  }

  _pan(game) {
    const p = game.player;
    const a = Math.atan2(this.y - p.y, this.x - p.x);
    return Math.max(-1, Math.min(1, Math.sin(angDiff(p.angle, a))));
  }

  draw(ctx, cam) {
    const s = cam.worldToScreen(this.x, this.y);
    const chase = this.state === ST.CHASE;
    const hurt = this.hp < this.maxHp * 0.5;

    // ---- paleta según variante (v0.14) ----
    // normal: oliva clásico · corredor: carne fresca rosada · bruto: masa oscura
    // v0.23 gritador: pajizo pálido con ojos blancos lechosos
    let body, head, arms, eye;
    if (this.variant === 'runner') {
      body = [168, 120, 108]; head = [186, 138, 124]; arms = [156, 108, 96];
      eye = '#f0821e';                        // ojos naranjas al perseguir
    } else if (this.variant === 'brute') {
      body = [78, 92, 72]; head = [88, 102, 80]; arms = [64, 78, 60];
      eye = '#b01616';                        // ojos rojo sangre
    } else if (this.variant === 'screamer') {
      body = [156, 156, 96]; head = [172, 170, 108]; arms = [140, 142, 86];
      eye = '#e8e4d0';                        // ojos blancos lechosos
    } else {
      body = [104, 116, 84]; head = [112, 126, 92]; arms = [96, 108, 80];
      eye = '#d83a2a';
    }

    // v0.23 — GRITADOR preparando el chillido: ondas de aviso pulsantes y
    // cuerpo que SE HINCHA (la boca se abre de par en par). Lectura clara:
    // «mátame AHORA o la zona entera viene aquí».
    if (this.variant === 'screamer' && this.screamT > 0) {
      const k = 1 - this.screamT / Z.variants.screamer.screamWindup;   // 0→1
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 45);
      ctx.strokeStyle = `rgba(226, 88, 58, ${(0.25 + 0.45 * k) * pulse})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const rr = this.r + 6 + i * 9 + k * 10;
        ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // sombra (el bruto proyecta más masa)
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(s.x + 2, s.y + 3, this.r, this.r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // v0.14: corredor persiguiendo → estelas de velocidad
    if (this.variant === 'runner' && chase) {
      ctx.strokeStyle = 'rgba(210, 140, 120, 0.28)';
      ctx.lineWidth = 2;
      for (const off of [-0.35, 0, 0.35]) {
        const bx = s.x + Math.cos(this.face + Math.PI + off) * (this.r + 6);
        const by = s.y + Math.sin(this.face + Math.PI + off) * (this.r + 6);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(this.face + Math.PI) * 7, by + Math.sin(this.face + Math.PI) * 7);
        ctx.stroke();
      }
    }

    // brazos (más abiertos al perseguir; el bruto los arrastra GORDOS;
    // el corredor los echa hacia atrás cuando corre)
    const armSpread = chase ? 0.9 : 0.55;
    const armReach = chase ? this.r + 5 : this.r + 2;
    const armR = this.variant === 'brute' ? 5.4 : 3.4;
    ctx.fillStyle = `rgb(${Math.round(arms[0] * this.tint)}, ${Math.round(arms[1] * this.tint)}, ${Math.round(arms[2] * this.tint)})`;
    if (this.variant === 'runner' && chase) {
      // pose de sprint: brazos hacia atrás
      for (const side of [-0.42, 0.42]) {
        const ax = s.x + Math.cos(this.face + Math.PI + side) * (this.r + 2);
        const ay = s.y + Math.sin(this.face + Math.PI + side) * (this.r + 2);
        ctx.beginPath(); ctx.arc(ax, ay, armR, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      for (const side of [-armSpread, armSpread]) {
        const ax = s.x + Math.cos(this.face + side) * armReach;
        const ay = s.y + Math.sin(this.face + side) * armReach;
        ctx.beginPath(); ctx.arc(ax, ay, armR, 0, Math.PI * 2); ctx.fill();
      }
    }

    // v0.14: hombros del bruto — dos jorobas oscuras a los lados
    if (this.variant === 'brute') {
      ctx.fillStyle = `rgb(${Math.round(58 * this.tint)}, ${Math.round(70 * this.tint)}, ${Math.round(54 * this.tint)})`;
      for (const side of [-1.35, 1.35]) {
        const hx = s.x + Math.cos(this.face + side) * this.r * 0.75;
        const hy = s.y + Math.sin(this.face + side) * this.r * 0.75;
        ctx.beginPath(); ctx.arc(hx, hy, this.r * 0.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // cuerpo
    ctx.fillStyle = `rgb(${Math.round(body[0] * this.tint)}, ${Math.round(body[1] * this.tint)}, ${Math.round(body[2] * this.tint)})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = this.variant === 'brute' ? 2.2 : 1.5; ctx.stroke();

    // heridas (el bruto enseña más carne magullada)
    if (hurt) {
      ctx.fillStyle = 'rgba(90,14,14,0.75)';
      const wr = this.variant === 'brute' ? 5.5 : 4;
      ctx.beginPath(); ctx.arc(s.x - this.r * 0.3, s.y - 2, wr, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s.x + this.r * 0.4, s.y + 3, wr * 0.65, 0, Math.PI * 2); ctx.fill();
    }

    // cabeza (la del bruto, hundida entre los hombros, es proporcionalmente
    // más pequeña; la del corredor va lanzada hacia delante)
    const headOff = this.variant === 'runner' ? 3.5 : this.variant === 'brute' ? 1.2 : 2;
    const headR = this.r * (this.variant === 'brute' ? 0.44 : 0.55);
    ctx.fillStyle = `rgb(${Math.round(head[0] * this.tint)}, ${Math.round(head[1] * this.tint)}, ${Math.round(head[2] * this.tint)})`;
    ctx.beginPath();
    ctx.arc(s.x + Math.cos(this.face) * headOff, s.y + Math.sin(this.face) * headOff, headR, 0, Math.PI * 2);
    ctx.fill();

    // v0.23 — GRITADOR: la BOCA. Cerrada = un rictus; preparando el chillido
    // = un pozo negro que se abre (y crece con el aviso). Su rasgo único.
    if (this.variant === 'screamer') {
      const k = this.screamT > 0 ? 1 - this.screamT / Z.variants.screamer.screamWindup : 0;
      const mx = s.x + Math.cos(this.face) * (headOff + headR * 0.42);
      const my = s.y + Math.sin(this.face) * (headOff + headR * 0.42);
      ctx.fillStyle = '#1a0e0a';
      ctx.beginPath();
      ctx.arc(mx, my, 1.4 + k * 3.4, 0, Math.PI * 2); ctx.fill();
      // mandíbula temblando durante el aviso
      if (k > 0) {
        ctx.strokeStyle = 'rgba(20,10,8,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(mx, my, 3 + k * 4.6, -0.5, 0.5); ctx.stroke();
      }
    }

    // ojos al perseguir (color según variente)
    if (chase) {
      ctx.fillStyle = eye;
      const eyeD = this.r * 0.5;
      const eyeR = this.variant === 'brute' ? 1.8 : 1.4;
      for (const side of [-0.35, 0.35]) {
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(this.face + side) * eyeD, s.y + Math.sin(this.face + side) * eyeD, eyeR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // flash al recibir daño
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 4})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, this.r + 1, 0, Math.PI * 2); ctx.fill();
    }

    // v0.20: ardiendo — llamas encima del cuerpo
    if (this.burn > 0) {
      drawBurnFlames(ctx, s.x, s.y, this.r, performance.now() / 1000);
    }

    // barra de vida pequeña solo si está herido (ancho según el cuerpo)
    if (this.hp < this.maxHp && this.hp > 0) {
      const w = this.r * 1.8;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(s.x - w / 2, s.y - this.r - 8, w, 3);
      ctx.fillStyle = '#b83a2a';
      ctx.fillRect(s.x - w / 2, s.y - this.r - 8, w * Math.max(0, this.hp / this.maxHp), 3);
    }
  }
}

/** Crea la horda inicial repartida por el mapa (v0.14: con variantes). */
export function spawnZombies(map, rng, count, spawnPoint) {
  const zombies = [];
  // v0.13: nada de zombis (de calle o de casas normales) dentro de la
  // burbuja de seguridad del spawn — se re-muestrean hasta salir de ella.
  const safe = (pos) => Math.hypot(pos.x - spawnPoint.x, pos.y - spawnPoint.y) >= SPAWN_SAFE_R;
  // v0.14: la horda callejera mezcla normales con CORREDORES (~15%).
  const pickVariant = () => (rng.chance(Z.runnerChance) ? 'runner' : 'normal');
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
    zombies.push(new Zombie(pos.x, pos.y, rng, pickVariant()));
  }

  // --- Densidad extra por estructura especial (v0.10) ---
  // La COMISARÍA concentra el mayor peligro del mapa (los agentes cayeron
  // dentro) y la TIENDA tiene presión media: zombis dentro + alrededor.
  // Cantidades FIJAS (SPECIALS.inside/around) → total determinista.
  // v0.13: los de ALREDEDOR también rehúyen la burbuja del spawn del jugador
  // (la estructura puede quedar cerca del centro del mapa).
  // v0.14: cada estructura guarda SUS BRUTOS de guarnición (comisaría 2,
  // tienda 1) entre su gente de dentro.
  for (const b of map.buildings) {
    if (b.kind !== 'police' && b.kind !== 'store' && b.kind !== 'military' && b.kind !== 'hospital') continue;
    const sp = SPECIALS[b.kind];
    const brutes = Z.bruteSpecials[b.kind] || 0;
    for (let i = 0; i < sp.inside; i++) {
      const pos = map.randomIndoorIn(b);
      if (!pos) break;
      zombies.push(new Zombie(pos.x, pos.y, rng, i < brutes ? 'brute' : pickVariant()));
    }
    for (let i = 0; i < sp.around; i++) {
      let pos = null;
      for (let k = 0; k < 60 && !pos; k++) {
        const p = map.randomOutdoorNear(b.cx, b.cy, TILE * 3.5, TILE * 11);
        if (p && safe(p)) pos = p;
      }
      if (!pos) break;
      zombies.push(new Zombie(pos.x, pos.y, rng, pickVariant()));
    }
    // v0.16: GUARDIANES DEL SÓTANO de la base militar — esperan abajo,
    // junto al botín. Mezcla fija: 1 bruto + 1 corredor + 2 normales.
    if (b.kind === 'military' && b.basement && sp.basement) {
      const fl = b.basement;
      const free = [];
      for (let ly = 1; ly < fl.h - 1; ly++) {
        for (let lx = 1; lx < fl.w - 1; lx++) {
          const t = fl.tiles[ly * fl.w + lx];
          if (t === T.FLOOR) free.push({ lx, ly });
        }
      }
      const kinds = ['brute', 'runner', 'normal', 'normal'];
      for (let i = 0; i < Math.min(sp.basement, free.length); i++) {
        const c = free[(i * 7 + 3) % free.length];   // repartidos, no apiñados
        const wx = (b.x0 + c.lx) * TILE + TILE / 2, wy = (b.y0 + c.ly) * TILE + TILE / 2;
        zombies.push(new Zombie(wx, wy, rng, kinds[i % kinds.length], -1));
      }
    }
    // v0.18: PLANTA DE HOSPITALIZACIÓN — el hospital está infestado TAMBIÉN
    // arriba: 10 zombis custodian las habitaciones y el botín exclusivo.
    // Mezcla fija: 1 bruto + 3 corredores + 6 normales.
    if (b.kind === 'hospital' && b.upper && sp.upper) {
      const fl = b.upper;
      const free = [];
      for (let ly = 1; ly < fl.h - 1; ly++) {
        for (let lx = 1; lx < fl.w - 1; lx++) {
          const t = fl.tiles[ly * fl.w + lx];
          if (t === T.FLOOR) free.push({ lx, ly });
        }
      }
      const kinds = ['brute', 'runner', 'normal', 'normal', 'runner',
                      'normal', 'normal', 'normal', 'runner', 'normal'];
      for (let i = 0; i < Math.min(sp.upper, free.length); i++) {
        const c = free[(i * 5 + 2) % free.length];   // repartidos por la planta
        const wx = (b.x0 + c.lx) * TILE + TILE / 2, wy = (b.y0 + c.ly) * TILE + TILE / 2;
        zombies.push(new Zombie(wx, wy, rng, kinds[i % kinds.length], 1));
      }
    }
  }

  // --- v0.14: BRUTOS errantes ocasionales ---
  // A veces (55% de los mapas) vagan 1-2 brutos por el mapa, siempre en el
  // exterior y aún más allá de la burbuja de seguridad del spawn: cruzarte
  // con uno debe ser un suceso, no una emboscada de bienvenida.
  if (rng.chance(Z.bruteRoamChance)) {
    const n = 1 + (rng.chance(0.5) ? 1 : 0) + (rng.chance(0.35) ? 1 : 0);   // v0.16: 1-3 con el mapa al doble
    for (let i = 0; i < n; i++) {
      let pos = null;
      for (let k = 0; k < 60 && !pos; k++) {
        const p = map.randomOutdoor(spawnPoint, SPAWN_SAFE_R + 240);
        if (p && safe(p)) pos = p;
      }
      if (!pos) continue;
      if (map.circleHitsSolid(pos.x, pos.y, 15)) continue;   // su masa es ancha
      zombies.push(new Zombie(pos.x, pos.y, rng, 'brute'));
    }
  }
  return zombies;
}

// ================== Serialización (v0.13: guardado de partidas) ==================

/** Estado persistente de un zombi (compacto, claves cortas).
 *  v0.14: `va` conserva la variante (runner/brute); los guardados viejos
 *  sin `va` se restauran como zombis normales. */
export function zombieToData(z) {
  return {
    va: z.variant, x: +z.x.toFixed(1), y: +z.y.toFixed(1), hp: z.hp,
    zz: z.z || 0,                       // v0.16: planta (guardianes del sótano)
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
  applyVariant(z, d.va);        // v0.14: stats + radio de su variante
  z.x = d.x; z.y = d.y;
  z.hp = d.hp;
  z.z = d.zz || 0;                // v0.16: planta (guardianes del sótano)
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
  z.burn = 0;                  // v0.20: sin quemadura al restaurar
  z.screamT = 0;               // v0.23: gritador — sin aviso/chillido en cola
  z.screamCd = 0;
  z.face = d.fa || 0;
  z.visibleNow = false;
  return z;
}
