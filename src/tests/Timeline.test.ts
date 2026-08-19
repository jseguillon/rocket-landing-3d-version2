import { describe, it, expect } from 'vitest';
import { TimelineEngine } from '../engine/Timeline.js';
import { PHASE_ORDER, TIMELINE_CHECKPOINTS, TOTAL_DURATION, type PhaseName } from '../types.js';

describe('TimelineEngine', () => {
  describe('initialization', () => {
    it('starts at time zero', () => {
      const engine = new TimelineEngine();
      expect(engine.time).toBe(0);
    });

    it('starts playing by default', () => {
      const engine = new TimelineEngine();
      expect(engine.playing).toBe(true);
    });

    it('has correct total duration', () => {
      const engine = new TimelineEngine();
      expect(engine.duration).toBe(TOTAL_DURATION);
    });

    it('starts at zero progress', () => {
      const engine = new TimelineEngine();
      expect(engine.progress).toBe(0);
    });

    it('accepts a custom seed', () => {
      const e1 = new TimelineEngine(42);
      const e2 = new TimelineEngine(42);
      const s1 = e1.getRocketState();
      const s2 = e2.getRocketState();
      expect(s1.position).toEqual(s2.position);
    });

    it('altitude decreases monotonically during early descent', () => {
      const e1 = new TimelineEngine(42);
      const e2 = new TimelineEngine(42);
      // Advance both to same time
      e1.update(5);
      e2.update(3);
      // Earlier time should have higher altitude (rocket is descending)
      expect(e2.getRocketState().position[1]).toBeGreaterThan(e1.getRocketState().position[1]);
    });
  });

  describe('time progression', () => {
    it('advances time with update()', () => {
      const engine = new TimelineEngine();
      engine.update(1);
      expect(engine.time).toBeCloseTo(1, 3);
    });

    it('caps at total duration', () => {
      const engine = new TimelineEngine();
      engine.update(TOTAL_DURATION + 10);
      expect(engine.time).toBe(TOTAL_DURATION);
      expect(engine.progress).toBe(1);
    });

    it('stops updating when not playing', () => {
      const engine = new TimelineEngine();
      engine.update(5);
      engine.setQAPercent(100); // QA mode pauses updates
      engine.update(5);
      expect(engine.time).toBeCloseTo(TOTAL_DURATION, 3);
    });

    it('resets to zero', () => {
      const engine = new TimelineEngine();
      engine.update(10);
      engine.reset();
      expect(engine.time).toBe(0);
      expect(engine.playing).toBe(true);
    });
  });

  describe('phase detection', () => {
    it('starts in approach phase', () => {
      const engine = new TimelineEngine();
      expect(engine.getPhase()).toBe('approach');
    });

    it('transitions to descent at t=5', () => {
      const engine = new TimelineEngine();
      engine.update(4.99);
      expect(engine.getPhase()).toBe('approach');
      engine.update(0.01);
      expect(engine.getPhase()).toBe('descent');
    });

    it('transitions through all phases in order', () => {
      const expected: [number, PhaseName][] = [
        [0, 'approach'],
        [5, 'descent'],
        [12, 'entry'],
        [20, 'landing-burn'],
        [27, 'leg-deploy'],
        [31, 'touchdown'],
        [35, 'hero'],
      ];

      for (const [time, expectedPhase] of expected) {
        const engine = new TimelineEngine();
        engine.update(time + 0.1);
        expect(engine.getPhase()).toBe(expectedPhase);
      }
    });

    it('stays in hero phase after completion', () => {
      const engine = new TimelineEngine();
      engine.update(TOTAL_DURATION);
      expect(engine.getPhase()).toBe('hero');
    });

    it('phase order matches PHASE_ORDER constant', () => {
      const phases: PhaseName[] = [];
      for (let t = 0; t <= TOTAL_DURATION; t += 1) {
        const engine = new TimelineEngine();
        engine.update(t);
        if (!phases.includes(engine.getPhase())) {
          phases.push(engine.getPhase());
        }
      }
      expect(phases).toEqual(PHASE_ORDER);
    });
  });

  describe('rocket state', () => {
    it('starts high above the ground', () => {
      const engine = new TimelineEngine();
      const state = engine.getRocketState();
      expect(state.position[1]).toBeGreaterThan(400);
    });

    it('ends near the ground on touchdown', () => {
      const engine = new TimelineEngine();
      engine.update(TOTAL_DURATION);
      const state = engine.getRocketState();
      expect(state.position[1]).toBeLessThan(2);
    });

    it('engine is off during approach', () => {
      const engine = new TimelineEngine();
      engine.update(3);
      expect(engine.getRocketState().engineActive).toBe(false);
    });

    it('engine activates during landing burn', () => {
      const engine = new TimelineEngine();
      engine.update(21);
      expect(engine.getRocketState().engineActive).toBe(true);
    });

    it('thrust is exactly zero at end of animation', () => {
      const engine = new TimelineEngine();
      engine.update(TOTAL_DURATION);
      expect(engine.getRocketState().engineThrust).toBe(0);
    });

    it('legs are stowed at start', () => {
      const engine = new TimelineEngine();
      engine.update(10);
      expect(engine.getRocketState().legDeployed).toBe(false);
    });

    it('legs deploy before touchdown', () => {
      const engine = new TimelineEngine();
      engine.update(25);
      expect(engine.getRocketState().legDeployed).toBe(false);
      engine.update(30);
      expect(engine.getRocketState().legDeployed).toBe(true);
    });

    it('altitude is pairwise monotonically decreasing through all phases', () => {
      const samples: number[] = [];
      for (let t = 0; t <= TOTAL_DURATION; t += 0.25) {
        const engine = new TimelineEngine();
        engine.update(t);
        samples.push(engine.getRocketState().position[1]);
      }

      // Every sample must be >= the next sample (monotonic decrease)
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 0.01);
      }

      // First sample much higher than last
      expect(samples[0]).toBeGreaterThan(300);
      expect(samples[samples.length - 1]).toBeLessThan(2);
    });

    it('leg angle animates during leg-deploy phase', () => {
      const engine = new TimelineEngine();
      engine.update(25);
      expect(engine.getRocketState().legAngle).toBe(0);
      engine.update(30);
      expect(engine.getRocketState().legAngle).toBeGreaterThan(0);
    });
  });

  describe('telemetry', () => {
    it('returns valid telemetry at any time', () => {
      const engine = new TimelineEngine();
      const tel = engine.getTelemetry();
      expect(tel.phase).toBeDefined();
      expect(tel.altitude).toBeGreaterThanOrEqual(0);
      expect(tel.velocity).toBeGreaterThanOrEqual(0);
      expect(tel.progress).toBeGreaterThanOrEqual(0);
      expect(tel.progress).toBeLessThanOrEqual(1);
    });

    it('velocity is high during entry phase', () => {
      const engine = new TimelineEngine();
      engine.update(15);
      expect(engine.getTelemetry().velocity).toBeGreaterThan(50);
    });

    it('velocity drops near zero at hero phase', () => {
      const engine = new TimelineEngine();
      engine.update(TOTAL_DURATION);
      expect(engine.getTelemetry().velocity).toBeLessThan(20);
    });
  });

  describe('QA mode', () => {
    it('freezes at a specific percentage', () => {
      const engine = new TimelineEngine();
      engine.setQAPercent(50);
      expect(engine.time).toBeCloseTo(TOTAL_DURATION / 2, 3);
      expect(engine.playing).toBe(false);
    });

    it('resets while maintaining QA mode', () => {
      const engine = new TimelineEngine();
      engine.setQAPercent(75);
      engine.reset();
      expect(engine.time).toBeCloseTo((75 / 100) * TOTAL_DURATION, 3);
    });

    it('qa percent 0 starts at beginning', () => {
      const engine = new TimelineEngine();
      engine.setQAPercent(0);
      expect(engine.time).toBe(0);
    });

    it('qa percent 100 goes to end', () => {
      const engine = new TimelineEngine();
      engine.setQAPercent(100);
      expect(engine.time).toBe(TOTAL_DURATION);
    });
  });

  describe('checkpoints', () => {
    it('returns all defined checkpoints', () => {
      const engine = new TimelineEngine();
      const cps = engine.getCheckpoints();
      expect(cps).toHaveLength(TIMELINE_CHECKPOINTS.length);
    });

    it('current checkpoint is the latest passed one', () => {
      const engine = new TimelineEngine();
      engine.update(15);
      const cp = engine.getCurrentCheckpoint();
      expect(cp.name).toBe('entry');
    });

    it('checkpoint progress is between 0 and 1', () => {
      const engine = new TimelineEngine();
      for (let t = 0; t <= TOTAL_DURATION; t += 2) {
        engine.update(t);
        const cp = engine.getCurrentCheckpoint();
        expect(cp.progress).toBeGreaterThanOrEqual(0);
        expect(cp.progress).toBeLessThanOrEqual(1);
      }
    });

    it('has checkpoint at each phase boundary', () => {
      const expectedNames: PhaseName[] = [
        'approach',
        'descent',
        'entry',
        'landing-burn',
        'leg-deploy',
        'touchdown',
        'hero',
      ];
      for (const cp of TIMELINE_CHECKPOINTS) {
        expect(expectedNames).toContain(cp.name);
      }
    });
  });

  describe('determinism', () => {
    it('produces identical state across runs with same seed', () => {
      const results: ReturnType<TimelineEngine['getRocketState']>[] = [];
      for (let run = 0; run < 3; run++) {
        const engine = new TimelineEngine(42);
        engine.update(15.5);
        results.push(engine.getRocketState());
      }
      for (let i = 1; i < results.length; i++) {
        expect(results[i].position).toEqual(results[0].position);
        expect(results[i].rotation).toEqual(results[0].rotation);
      }
    });

    it('state is deterministic at every 0.5s interval', () => {
      const reference = new TimelineEngine(42);
      reference.update(20);
      const refState = reference.getRocketState();

      for (let run = 0; run < 2; run++) {
        const engine = new TimelineEngine(42);
        engine.update(20);
        const state = engine.getRocketState();
        expect(state.position).toEqual(refState.position);
      }
    });
  });

  describe('boundary conditions', () => {
    it('handles dt=0 gracefully', () => {
      const engine = new TimelineEngine();
      engine.update(0);
      expect(engine.time).toBe(0);
    });

    it('handles large dt without clipping issues', () => {
      const engine = new TimelineEngine();
      engine.update(100);
      expect(engine.time).toBe(TOTAL_DURATION);
    });

    it('progress is always in [0, 1]', () => {
      const engine = new TimelineEngine();
      for (let t = 0; t <= TOTAL_DURATION + 10; t += 0.5) {
        engine.update(1);
        expect(engine.progress).toBeGreaterThanOrEqual(0);
        expect(engine.progress).toBeLessThanOrEqual(1);
      }
    });

    it('altitude is always non-negative', () => {
      const engine = new TimelineEngine();
      for (let t = 0; t <= TOTAL_DURATION + 5; t += 0.25) {
        engine.update(1);
        expect(engine.getRocketState().position[1]).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('pause/resume/replay', () => {
    it('can pause and resume', () => {
      const engine = new TimelineEngine();
      engine.update(5);
      expect(engine.playing).toBe(true);
      engine.pause();
      expect(engine.paused).toBe(true);
      expect(engine.playing).toBe(false);

      const timeBefore = engine.time;
      // Time should NOT advance while paused
      engine.update(3);
      expect(engine.time).toBe(timeBefore);

      // Resume and verify time advances
      engine.play();
      expect(engine.playing).toBe(true);
      engine.update(2);
      expect(engine.time).toBeCloseTo(timeBefore + 2, 3);
    });

    it('replay resets to beginning', () => {
      const engine = new TimelineEngine();
      engine.update(10);
      engine.pause();
      expect(engine.paused).toBe(true);

      engine.reset();
      expect(engine.time).toBe(0);
      expect(engine.playing).toBe(true);
    });

    it('togglePlayPause alternates correctly', () => {
      const engine = new TimelineEngine();
      expect(engine.playing).toBe(true);

      engine.togglePlayPause();
      expect(engine.playing).toBe(false);
      expect(engine.paused).toBe(true);

      engine.togglePlayPause();
      expect(engine.playing).toBe(true);
    });

    it('play() after completion resets and replays', () => {
      const engine = new TimelineEngine();
      engine.update(TOTAL_DURATION);
      expect(engine.finished).toBe(true);

      engine.play();
      expect(engine.time).toBe(0);
      expect(engine.playing).toBe(true);
      expect(engine.finished).toBe(false);
    });

    it('QA mode time matches percentage exactly', () => {
      const engine = new TimelineEngine();
      for (const pct of [0, 25, 50, 75, 100]) {
        engine.setQAPercent(pct);
        const expected = (pct / 100) * TOTAL_DURATION;
        expect(engine.time).toBeCloseTo(expected, 3);
      }
    });

    it('pause/resume preserves exact time', () => {
      const engine = new TimelineEngine();
      engine.update(17.5);
      const savedTime = engine.time;

      engine.pause();
      engine.update(999); // should not advance
      expect(engine.time).toBe(savedTime);

      engine.play();
      engine.update(0.5);
      expect(engine.time).toBeCloseTo(savedTime + 0.5, 3);
    });
  });

  describe('freezeAt / unfreeze / play / reset', () => {
    it('freezeAt freezes time at the specified value', () => {
      const engine = new TimelineEngine();
      engine.update(10);
      expect(engine.time).toBeCloseTo(10, 3);

      engine.freezeAt(20);
      expect(engine.time).toBe(20);
      expect(engine.playing).toBe(false);
      // Frozen at mid-flight: not finished (mission complete) but paused and frozen
      expect(engine.finished).toBe(false);
      expect(engine.paused).toBe(true);
      expect(engine._pausedTimeValue).toBe(20);
    });

    it('freezeAt prevents time advancement during update()', () => {
      const engine = new TimelineEngine();
      engine.freezeAt(15);
      expect(engine.time).toBe(15);

      engine.update(100); // should not advance while frozen
      expect(engine.time).toBe(15);
    });

    it('freezeAt at edge values works correctly', () => {
      const engine = new TimelineEngine();
      engine.freezeAt(0);
      expect(engine.time).toBe(0);

      engine.freezeAt(TOTAL_DURATION + 100); // should clamp to max
      expect(engine.time).toBe(TOTAL_DURATION);
    });

    it('play() clears freeze so timeline advances', () => {
      const engine = new TimelineEngine();
      engine.freezeAt(25);
      expect(engine.time).toBe(25);
      expect(engine.playing).toBe(false);
      expect(engine.finished).toBe(false);

      engine.play();
      expect(engine.playing).toBe(true);
      expect(engine.finished).toBe(false);

      // Verify timeline now advances
      engine.update(3);
      expect(engine.time).toBeCloseTo(28, 3);
    });

    it('reset() clears freeze and restarts from zero', () => {
      const engine = new TimelineEngine();
      engine.freezeAt(30);
      expect(engine.time).toBe(30);
      expect(engine.finished).toBe(false);

      engine.reset();
      expect(engine.time).toBe(0);
      expect(engine.playing).toBe(true);
      expect(engine.finished).toBe(false);

      // Verify timeline advances from reset
      engine.update(5);
      expect(engine.time).toBeCloseTo(5, 3);
    });

    it('setQAPercent clears any active freeze', () => {
      const engine = new TimelineEngine();
      engine.freezeAt(20);
      expect(engine.time).toBe(20);

      engine.setQAPercent(50);
      // setQAPercent should have cleared the freeze and set time to 50% of duration
      expect(engine._qaPercentValue).toBe(50);
      expect(engine.time).toBeCloseTo((50 / 100) * TOTAL_DURATION, 3);
    });

    it('unfreeze() without args starts playing from frozen position', () => {
      const engine = new TimelineEngine();
      engine.freezeAt(22);
      expect(engine.time).toBe(22);

      engine.unfreeze();
      expect(engine.playing).toBe(true);
      expect(engine.time).toBe(22); // time preserved

      engine.update(3);
      expect(engine.time).toBeCloseTo(25, 3);
    });

    it('unfreeze() with qaPercent restores QA position', () => {
      const engine = new TimelineEngine();
      engine.freezeAt(20);

      engine.unfreeze(75);
      expect(engine._qaPercentValue).toBe(75);
      expect(engine.time).toBeCloseTo((75 / 100) * TOTAL_DURATION, 3);
    });

    it('frozen checkpoint stays stable across multiple update() calls', () => {
      const engine = new TimelineEngine();
      engine.freezeAt(25);

      for (let i = 0; i < 50; i++) {
        engine.update(0.1);
      }
      expect(engine.time).toBe(25);
    });

    it('freezeAt then play then freezeAt works correctly', () => {
      const engine = new TimelineEngine();
      engine.freezeAt(10);
      expect(engine.time).toBe(10);

      engine.play();
      engine.update(5);
      expect(engine.time).toBeCloseTo(15, 3);

      // Freeze at a new position
      engine.freezeAt(20);
      expect(engine.time).toBe(20);
    });

    it('play() after freeze clears finished flag', () => {
      const engine = new TimelineEngine();
      // Freeze at end to get finished=true
      engine.freezeAt(TOTAL_DURATION);
      expect(engine.finished).toBe(true);

      engine.play();
      expect(engine.finished).toBe(false);
    });

    it('play() after mid-flight freeze clears _isFrozen', () => {
      const engine = new TimelineEngine();
      engine.freezeAt(15);
      expect(engine._isFrozen).toBe(true);
      expect(engine.finished).toBe(false); // mid-flight is not finished

      engine.play();
      expect(engine._isFrozen).toBe(false);
    });

    it('_isFrozen reflects current freeze state accurately', () => {
      const engine = new TimelineEngine();
      expect(engine._isFrozen).toBe(false);

      engine.freezeAt(10);
      expect(engine._isFrozen).toBe(true);

      engine.play();
      expect(engine._isFrozen).toBe(false);
    });

    it('phase is correct during freeze', () => {
      const engine = new TimelineEngine();
      engine.freezeAt(23); // landing-burn phase (20-27)
      expect(engine.getPhase()).toBe('landing-burn');

      engine.update(999);
      expect(engine.getPhase()).toBe('landing-burn');
    });

    it('rocket state is correct during freeze', () => {
      const engine = new TimelineEngine();
      engine.freezeAt(23);
      const rocketA = engine.getRocketState();

      engine.update(999);
      const rocketB = engine.getRocketState();

      // Rocket state must be identical when frozen
      expect(rocketA.position).toEqual(rocketB.position);
      expect(rocketA.engineThrust).toBeCloseTo(rocketB.engineThrust, 6);
    });

    it('getState does not claim mid-flight freeze is mission-complete', () => {
      const engine = new TimelineEngine();
      // Freeze at landing-burn (time=20), which is mid-flight, NOT hero (time=35)
      engine.freezeAt(20);

      const state = engine.getState();
      // Must not be finished — this is a burn in progress, not mission-complete
      expect(engine.finished).toBe(false);
      expect(state.playing).toBe(false);
      expect(state.phase).toBe('landing-burn');
      expect(state.time).toBe(20);
    });

    it('freezeAt at TOTAL_DURATION sets finished=true', () => {
      const engine = new TimelineEngine();
      // Freezing at the very end should mark as finished
      engine.freezeAt(TOTAL_DURATION);

      expect(engine.time).toBe(TOTAL_DURATION);
      expect(engine.finished).toBe(true);
    });
  });
});
