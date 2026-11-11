// Power runtime: input-mode state machines, energy + cooldowns, persistent entities and
// the Limiter Break multiplier. Engine-agnostic (talks only to the API interfaces).
import { dist, norm, sub, type Vec2 } from '../core/math';
import type { AudioAPI, CastInput, FXAPI, PhysicsAPI, Power, PowerCtx, PowerEntity, StatusAPI, SubAbility } from './types';

export interface RuntimeApis {
  physics: PhysicsAPI;
  fx: FXAPI;
  audio: AudioAPI;
  status: StatusAPI;
}

interface Press {
  power: Power;
  sub: SubAbility;
  origin: Vec2;
  pos: Vec2;
  held: number;
  started: boolean;
}

export class PowerRuntime {
  energy = 100;
  maxEnergy = 100;
  regen = 16;
  infiniteEnergy = false;
  noCooldowns = false;
  time = 0;
  chaosScore = 0;
  readonly cooldowns = new Map<string, number>();
  readonly overrides = new Map<string, Record<string, number>>();
  private entities: PowerEntity[] = [];
  private press: Press | null = null;
  private limiterTime = 0;
  private limiterMult = 1;
  powerIndex = 0;
  subIndex = 0;
  /** Called whenever something worth surfacing happens (UI refresh). */
  onChange: () => void = () => undefined;
  onFail: (reason: 'energy' | 'cooldown') => void = () => undefined;

  constructor(
    private apis: RuntimeApis,
    readonly powers: Power[],
  ) {}

  get power(): Power {
    return this.powers[this.powerIndex]!;
  }
  get sub(): SubAbility {
    return this.power.subs[this.subIndex] ?? this.power.subs[0]!;
  }
  get mult(): number {
    return this.limiterTime > 0 ? this.limiterMult : 1;
  }
  get limiterRemaining(): number {
    return this.limiterTime;
  }
  get entityCount(): number {
    return this.entities.length;
  }
  get pressing(): boolean {
    return this.press !== null;
  }

  select(powerIndex: number, subIndex = 0): void {
    this.cancel();
    this.powerIndex = (powerIndex + this.powers.length) % this.powers.length;
    this.subIndex = Math.max(0, Math.min(subIndex, this.power.subs.length - 1));
    this.onChange();
  }

  selectById(powerId: string, subId?: string): void {
    const i = this.powers.findIndex((p) => p.id === powerId);
    if (i < 0) return;
    const s = subId ? this.powers[i]!.subs.findIndex((x) => x.id === subId) : 0;
    this.select(i, Math.max(0, s));
  }

  cycleSub(delta: number): void {
    this.cancel();
    const n = this.power.subs.length;
    this.subIndex = (this.subIndex + delta + n) % n;
    this.onChange();
  }

  params(sub: SubAbility): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, spec] of Object.entries(sub.params)) out[k] = spec.default;
    return { ...out, ...this.overrides.get(sub.id) };
  }

  ctx(power: Power, sub: SubAbility): PowerCtx {
    return {
      ...this.apis,
      time: this.time,
      params: this.params(sub),
      mult: this.mult,
      palette: power.palette,
      spawn: (e) => this.entities.push(e),
      entities: (tag) => this.entities.filter((e) => e.tag === tag),
      chaos: (pts) => {
        this.chaosScore += pts;
      },
      setLimiter: (seconds, mult) => {
        this.limiterTime = seconds;
        this.limiterMult = mult;
        this.onChange();
      },
    };
  }

  private input(p: Press, charge = 0): CastInput {
    const d = dist(p.origin, p.pos);
    let dir = norm(sub(p.pos, p.origin));
    if (d < 0.35) {
      // No drag: aim at the nearest dummy, else to the right.
      let best: Vec2 | null = null;
      let bd = Infinity;
      for (const dm of this.apis.physics.dummies()) {
        const dd = dist(dm.center, p.origin);
        if (dd < bd && dd > 0.5) {
          bd = dd;
          best = dm.center;
        }
      }
      dir = best ? norm(sub(best, p.origin)) : { x: 1, y: 0 };
    }
    return {
      origin: p.origin,
      pos: p.pos,
      dir,
      dist: d,
      charge,
      held: p.held,
      ...(p.sub.input === 'area-select' ? { area: { center: p.origin, radius: Math.max(1, d) } } : {}),
    };
  }

  private affordable(sub: SubAbility, cost: number): boolean {
    if ((this.cooldowns.get(sub.id) ?? 0) > 0 && !this.noCooldowns) {
      this.onFail('cooldown');
      return false;
    }
    if (!this.infiniteEnergy && this.energy < cost) {
      this.onFail('energy');
      return false;
    }
    return true;
  }

  private spend(sub: SubAbility, cost: number): void {
    if (!this.infiniteEnergy) this.energy = Math.max(0, this.energy - cost / Math.max(1, this.mult * 0.8));
    if (!this.noCooldowns) this.cooldowns.set(sub.id, sub.cooldown / this.mult);
    this.onChange();
  }

  private cast(p: Press, input: CastInput): void {
    const sub = p.sub;
    if (!this.affordable(sub, sub.cost)) return;
    this.spend(sub, sub.cost);
    sub.onCast?.(this.ctx(p.power, sub), input);
  }

  pointerDown(pos: Vec2): void {
    const power = this.power;
    const sub = this.sub;
    this.press = { power, sub, origin: pos, pos, held: 0, started: false };
    if (sub.input === 'click') {
      this.cast(this.press, this.input(this.press));
      this.press = null;
    } else if (sub.input === 'toggle') {
      const ctx = this.ctx(power, sub);
      const existing = ctx.entities(sub.id);
      if (existing.length) {
        for (const e of existing) e.dispose?.(ctx);
        this.entities = this.entities.filter((e) => e.tag !== sub.id);
        this.onChange();
      } else this.cast(this.press, this.input(this.press));
      this.press = null;
    } else if (sub.input === 'hold') {
      if (!this.affordable(sub, Math.max(1, sub.cost))) this.press = null;
      else {
        this.spend(sub, sub.cost);
        this.press.started = true;
      }
    }
  }

  pointerMove(pos: Vec2): void {
    if (this.press) this.press.pos = pos;
  }

  pointerUp(pos: Vec2): void {
    const p = this.press;
    if (!p) return;
    p.pos = pos;
    this.press = null;
    const sub = p.sub;
    if (sub.input === 'drag-aim' || sub.input === 'area-select') this.cast(p, this.input(p));
    else if (sub.input === 'charge-release') {
      const charge = Math.min(1, p.held / (sub.chargeTime ?? 1));
      this.cast(p, this.input(p, charge));
    } else if (sub.input === 'hold' && p.started) sub.onRelease?.(this.ctx(p.power, sub), this.input(p));
  }

  cancel(): void {
    const p = this.press;
    if (p?.sub.input === 'hold' && p.started) p.sub.onRelease?.(this.ctx(p.power, p.sub), this.input(p));
    this.press = null;
  }

  clearEntities(): void {
    for (const e of this.entities) {
      const ctx = this.ctx(this.power, this.sub);
      e.dispose?.(ctx);
    }
    this.entities = [];
    this.onChange();
  }

  /** Advance one fixed step. */
  step(dt: number): void {
    this.time += dt;
    for (const [k, v] of this.cooldowns) {
      if (v <= dt) this.cooldowns.delete(k);
      else this.cooldowns.set(k, v - dt);
    }
    if (this.limiterTime > 0) {
      this.limiterTime -= dt;
      if (this.limiterTime <= 0) this.onChange();
    }
    this.energy = Math.min(this.maxEnergy, this.energy + this.regen * dt * (this.limiterTime > 0 ? 2 : 1));

    const p = this.press;
    if (p) {
      p.held += dt;
      const sub = p.sub;
      const ctx = this.ctx(p.power, sub);
      if (sub.input === 'hold') {
        const cost = (sub.holdCost ?? 0) * dt;
        if (!this.infiniteEnergy && this.energy < cost) {
          this.cancel();
          this.onFail('energy');
        } else {
          if (!this.infiniteEnergy) this.energy -= cost;
          sub.onHold?.(ctx, this.input(p), dt);
        }
      } else if (sub.input === 'charge-release') {
        sub.onCharge?.(ctx, this.input(p, Math.min(1, p.held / (sub.chargeTime ?? 1))), dt);
      } else if (sub.input === 'drag-aim') {
        const inp = this.input(p);
        const end = { x: p.origin.x + inp.dir.x * Math.max(1.5, inp.dist), y: p.origin.y + inp.dir.y * Math.max(1.5, inp.dist) };
        ctx.fx.line(p.origin, end, { color: p.power.palette.primary, width: 0.05, life: dt * 1.5, alpha: 0.7 });
        ctx.fx.ring(end, { color: p.power.palette.primary, radius: 0.25, life: dt * 1.5, grow: false, width: 0.04 });
      } else if (sub.input === 'area-select') {
        ctx.fx.zone(p.origin, Math.max(1, dist(p.origin, p.pos)), { color: p.power.palette.primary, life: dt * 1.5, alpha: 0.12 });
      }
    }

    if (this.entities.length) {
      const ctx = this.ctx(this.power, this.sub);
      this.entities = this.entities.filter((e) => {
        const keep = e.update(ctx, dt);
        if (!keep) e.dispose?.(ctx);
        return keep;
      });
    }
  }
}
