import * as mm from '@magenta/music/es6/core';
import {INoteSequence, NoteSequence} from '@magenta/music/es6/protobuf';

export const DRUMS = 'DRUMS';
export type ProgramSpec = number | typeof DRUMS;

export function filterByInstrument(ns: INoteSequence, instruments: number[], inPlace = false) {
  const instrumentSet = new Set<number>();
  for (const i of instruments) {
    instrumentSet.add(i || 0);
  }

  const filtered = inPlace ? ns : mm.sequences.clone(ns);
  const notes = filtered.notes;
  filtered.notes = [];
  for (const note of notes) {
    if (instrumentSet.has(note.instrument || 0)) {
      filtered.notes.push(note);
    }
  }

  return filtered;
}

export function getInstrumentPrograms(ns: INoteSequence) {
  const map = new Map<number, ProgramSpec>();
  for (const note of ns.notes) {
    const program = note.isDrum ? DRUMS : note.program || 0;
    map.set(note.instrument || 0, program);
  }
  return map;
}

export function getBeats(ns: INoteSequence, extraFinalBeat = false): number[] {
  const beats = [0];

  type MyTempo = NoteSequence.ITempo & {dummy?: boolean};
  const tempos = Array.from<MyTempo>(ns.tempos);
  tempos.push({time: ns.totalTime, dummy: true});  // Dummy final tempo
  tempos.sort((a, b) => a.time - b.time);
  if (tempos[0].time > 0) {
    tempos.unshift(NoteSequence.Tempo.create({time: 0, qpm: 120}));
  }

  var currentBeats = 0; // The time in (fractional) beats of the next tempo change
  for (let i = 0; i < tempos.length - 1; i++) {
    if (tempos[i].dummy) {  // May happen if some of the tempos occur after totalTime
      break;
    }

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

export function normalizeTempo(ns: INoteSequence, targetTempo?: number) {
  ns = mm.sequences.clone(ns);

  const tempos = Array.from(ns.tempos);
  tempos.sort((a, b) => a.time - b.time);
  if (tempos.length == 0 || tempos[0].time > 0) {
    tempos.unshift({time: 0, qpm: 120});
  }
  if (targetTempo === undefined) {
    targetTempo = tempos[0].qpm;
  }

  // Get all events. Ignore tempos because we will eventually remove them.
  const events = [];
  for (const eventCollection of [ns.timeSignatures, ns.keySignatures, ns.pitchBends,
                                 ns.controlChanges, ns.textAnnotations, ns.sectionAnnotations]) {
    for (const event of eventCollection) {
      events.push(event);
    }
  }
  // Add an artificial event for totalTime.
  const totalTimeEvent = {time: ns.totalTime};
  events.push(totalTimeEvent);
  // Sort the events in reverse (so that we pop the earlier ones first).
  events.sort((a, b) => b.time - a.time);

  // Do the same for note-ons and note-offs.
  const noteOns = Array.from(ns.notes);
  noteOns.sort((a, b) => b.startTime - a.startTime);
  const noteOffs = Array.from(ns.notes);
  noteOffs.sort((a, b) => b.endTime - a.endTime);

  const newTempoTimes = [0];

  function getNewTime(oldTime: number, currentTempoIndex: number) {
    const tempo = tempos[currentTempoIndex];
    return newTempoTimes[currentTempoIndex] + (oldTime - tempo.time) * tempo.qpm / targetTempo;
  }

  function popIf<T>(array: T[], condition: (e: T) => boolean): T {
    if (array.length > 0 && condition(array[array.length - 1])) {
      return array.pop();
    }
    return null;
  }

  tempos.push(NoteSequence.Tempo.create({time: ns.totalTime + 1}));  // Dummy final tempo

  // Find the new times of all tempo changes, then adjust the events in between.
  for (let i = 0; i < tempos.length - 1; i++) {
    if (i > 0) {
      newTempoTimes.push(getNewTime(tempos[i].time, i - 1));
    }

    let event, note;
    while (event = popIf(events, (e) => e.time <= tempos[i+1].time)) {
      event.time = getNewTime(event.time, i);
    }
    while (note = popIf(noteOns, (n) => n.startTime <= tempos[i+1].time)) {
      note.startTime = getNewTime(note.startTime, i);
    }
    while (note = popIf(noteOffs, (n) => n.endTime <= tempos[i+1].time)) {
      note.endTime = getNewTime(note.endTime, i);
    }
  }

  ns.totalTime = totalTimeEvent.time;
  ns.tempos = [NoteSequence.Tempo.create({time: 0, qpm: targetTempo})];
  return ns;
}

export function merge(sequences: INoteSequence[]) {
  const result = mm.sequences.clone(sequences[0]);
  for (let ns of sequences.slice(1)) {
    ns = mm.sequences.clone(ns);

    // Shift instrument IDs to avoid collisions
    const instrumentOffset = 1 + result.notes.reduce(
        (a: number, b: NoteSequence.INote) => Math.max(a, b.instrument), -1);
    for (const collection of [ns.notes, ns.pitchBends, ns.controlChanges]) {
      for (const item of collection) {
        item.instrument += instrumentOffset;
      }
    }

    const KEYS = ['tempos', 'timeSignatures', 'keySignatures', 'notes', 'pitchBends',
                  'controlChanges', 'textAnnotations'] as const;
    for (const key of KEYS) {
      for (const item of ns[key]) {
        result[key].push(item);
      }
    }
    result.totalTime = Math.max(result.totalTime, ns.totalTime);
  }
  return result;
}
