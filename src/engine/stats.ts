// Practice statistics for the current run.

export interface MeasureStat { hits: number; wrong: number; missed: number }

export class PracticeStats {
  hits = 0;
  wrong = 0;
  missed = 0;
  streak = 0;
  bestStreak = 0;
  activeSeconds = 0;
  loopsCompleted = 0;
  cleanLoops = 0;
  perMeasure = new Map<number, MeasureStat>();
  startedAt = Date.now();
  private loopErrorsAtStart = 0;

  private m(i: number) {
    let s = this.perMeasure.get(i);
    if (!s) { s = { hits: 0, wrong: 0, missed: 0 }; this.perMeasure.set(i, s); }
    return s;
  }

  hit(measure: number) { this.hits++; this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak); this.m(measure).hits++; }
  miss(measure: number) { this.missed++; this.streak = 0; this.m(measure).missed++; }
  wrongNote(measure: number) { this.wrong++; this.streak = 0; if (measure >= 0) this.m(measure).wrong++; }

  get errors() { return this.wrong + this.missed; }
  get accuracy(): number {
    const total = this.hits + this.wrong + this.missed;
    return total ? this.hits / total : 0;
  }
  get attempted() { return this.hits + this.wrong + this.missed; }

  loopWrapped() {
    this.loopsCompleted++;
    if (this.errors === this.loopErrorsAtStart) this.cleanLoops++;
    this.loopErrorsAtStart = this.errors;
  }

  measureErrors(): Record<number, number> {
    const out: Record<number, number> = {};
    for (const [k, v] of this.perMeasure) if (v.wrong + v.missed > 0) out[k] = v.wrong + v.missed;
    return out;
  }

  reset() {
    Object.assign(this, new PracticeStats());
  }
}
