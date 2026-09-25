'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Notification sound for every screen: a short two-tone chime, rung 3 times.
 *
 * Browsers only allow sound after the person has touched the page once. So: sound is ON by
 * default (remembered per device), and the first tap anywhere unlocks it. The user menu has
 * an on/off switch. Generated with WebAudio — no sound files to load.
 */
let ctx: AudioContext | null = null;
let unlocked = false;
const listeners = new Set<() => void>();

function soundPref(): boolean {
  try {
    return localStorage.getItem('sound') !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem('sound', on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
  if (on) ring(1);
}

/** Call once (Providers): the first touch/click/key anywhere unlocks audio for the session. */
export function installSoundUnlock() {
  const unlock = () => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = ctx ?? new Ctx();
      void ctx.resume();
      unlocked = true;
      listeners.forEach((l) => l());
    } catch {
      /* no audio on this device */
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function chimeAt(c: AudioContext, start: number) {
  [880, 1320].forEach((freq, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    const t = start + i * 0.18;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.4);
  });
}

/** Rings `times` chimes (default 3), ~0.75s apart. Silent if sound is off or not unlocked yet. */
export function ring(times = 3) {
  if (!ctx || !unlocked || !soundPref()) return;
  const now = ctx.currentTime + 0.05;
  for (let i = 0; i < times; i++) chimeAt(ctx, now + i * 0.75);
  if (navigator.vibrate) navigator.vibrate([200, 150, 200, 150, 200]);
}

/** Sound status for UI (menu switch, "tap to enable" hint). */
export function useSoundState() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { enabled: typeof window !== 'undefined' && soundPref(), unlocked };
}

/**
 * Rings when `count` goes UP (a new ready dish, a new ticket, a new bill request…).
 * The first value after load never rings, so opening a page doesn't alarm.
 */
export function useRingOnIncrease(count: number | null | undefined, times = 3) {
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (count === null || count === undefined) return;
    if (prev.current !== null && count > prev.current) ring(times);
    prev.current = count;
  }, [count, times]);
}
