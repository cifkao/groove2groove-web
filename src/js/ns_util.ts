import * as mm from '@magenta/music/es6/core';
import {INoteSequence, NoteSequence} from '@magenta/music/es6/protobuf';

export const DRUMS = 'DRUMS';
export type InstrumentSpec = number | 'DRUMS';
export type ProgramSpec = number | 'DRUMS';

export function getBeats(ns: INoteSequence, extraFinalBeat?: boolean): number[] {
  const beats = [0];

  const tempos = Array.from(ns.tempos);
  tempos.sort((a, b) => a.time - b.time);
  if (tempos.length == 0 || tempos[0].time > 0) {
    tempos.unshift(NoteSequence.Tempo.create({time: 0, qpm: 120}));
  }
  tempos.push(NoteSequence.Tempo.create({time: ns.totalTime}));  // Dummy final tempo

  var currentBeats = 0; // The time in (fractional) beats of the next tempo change
  for (let i = 0; i < tempos.length - 1; i++) {
    const timeDiff = tempos[i + 1].time - tempos[i].time;
    const beatDiff = timeDiff * tempos[i].qpm / 60;
    // Emit all the beats between the two tempo changes.
    while (beats.length < currentBeats + beatDiff) {
      beats.push(tempos[i].time + (beats.length - currentBeats) / tempos[i].qpm * 60);
    }
    currentBeats += beatDiff;
  }

  if (extraFinalBeat) {
    // Add one more beat after totalTime
    beats.push(beats[beats.length - 1] + 60 / tempos[tempos.length - 2].qpm);
  }

  return beats;
}

export function filterSequence(ns: INoteSequence, instruments: InstrumentSpec[], inPlace?: boolean) {
  const instrumentSet = new Set<InstrumentSpec>();
  for (let i of instruments) {
    instrumentSet.add(i || 0);
  }

  const filtered = inPlace ? ns : mm.sequences.clone(ns);
  const notes = filtered.notes;
  filtered.notes = [];
  for (let note of notes) {
    if ((note.isDrum && instrumentSet.has(DRUMS)) || instrumentSet.has(note.instrument || 0)) {
      filtered.notes.push(note);
    }
  }

  return filtered;
}

export function getInstrumentPrograms(ns: INoteSequence) {
  const map = new Map<InstrumentSpec, ProgramSpec>();
  for (let note of ns.notes) {
    const program = note.isDrum ? DRUMS : note.program || 0;
    map.set(note.instrument || 0, program);
  }
  return map;
}
