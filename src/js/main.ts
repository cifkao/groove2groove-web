import '../scss/main.scss';

import 'bootstrap/js/dist/modal';
import {saveAs} from 'file-saver';
import * as mm from '@magenta/music/es6/core';
import {NoteSequence, INoteSequence} from '@magenta/music/es6/protobuf';
import {instrumentByPatchID} from '@tonejs/midi/dist/InstrumentMaps';
import * as ns_util from './ns_util';


const config = {apiUrl: '.'};
export function init(cfg: any) {
  Object.assign(config, cfg);
}

const VISUALIZER_CONFIG = {
  pixelsPerTimeStep: 40,
  noteHeight: 4,
} as mm.VisualizerConfig;

const DRUMS = ns_util.DRUMS;
const INSTRUMENT_NAMES = instrumentByPatchID.map(
  (s) => s.replace(/\b\w/g, (m) => m.toUpperCase()));

interface ErrorMessage {
  title: string;
  message: string;
}
const ERROR_MESSAGES = {
  'STYLE_INPUT_TOO_LONG': {
    title: 'Input too long',
    message: 'The given style input is too long. Please use the ‘Start bar’ and ‘End bar’ fields to select an 8-bar (32-beat) section.'
  }
} as Record<string, ErrorMessage>;

interface SequenceData {
  sequence?: INoteSequence;
  fullSequence?: INoteSequence;
  trimmedSequence?: INoteSequence;
  section?: HTMLElement;
  player?: mm.SoundFontPlayer;
  visualizer?: mm.PianoRollSVGVisualizer;
  visualizerConfig?: mm.VisualizerConfig;
  tempo?: number;
  beats?: number[];
}

const SEQ_IDS = ['content', 'style', 'output', 'remix'] as const;
type SequenceId = (typeof SEQ_IDS)[number];
const data = {} as Record<SequenceId, SequenceData>;
for (const seqId of SEQ_IDS) { data[seqId] = {}; }

var controlCount = 0;  // counter used for assigning IDs to dynamically created controls

$('.section[data-sequence-id]').each(function() {
  data[getSeqId($(this))].section = this;
});

$('form').submit(function(e){ e.preventDefault(); });

$('.after-content-loaded, .after-style-loaded, .after-output-loaded').hide();
$('.container').fadeIn('fast');

$('#presetsButton').click(function() {
  $('#presetModal').modal('show');
});

$('input.midi-input').on('change', function() {
  const el = this as HTMLInputElement;
  const file = el.files[0];
  if (!file) return;

  const section = $(el).closest('[data-sequence-id]');

  setControlsEnabled(section, false);
  $(el).siblings('.custom-file-label').text(el.files[0].name);

  mm.blobToNoteSequence(file).then(function(seq) {
    seq.filename = file.name;

    initSequence(section, seq);
    initTrimControls(section);

    showMore(getSeqId(section) + '-loaded');
  }).catch(handleError).finally(() => setControlsEnabled(section, true));
});

$('.start-time, .end-time').on('change', handleSequenceEdit);

$('.tempo').on('change', function() {
  const section = $(this).closest('[data-sequence-id]');
  const seqId = getSeqId(section);

  data[seqId].tempo = parseInt($(this).val() as string);
  if (data[seqId].player)
    data[seqId].player.setTempo(data[seqId].tempo);
});

$('.play-button').on('click', function() {
  const section = $(this).closest('[data-sequence-id]');
  const seqId = getSeqId(section);

  if (!data[seqId].player)
    data[seqId].player = new mm.SoundFontPlayer(
      "https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus",
      undefined, null, null, {
        run: (note) => {
          data[seqId].visualizer.redraw(note, true);
          section.find('.seek-slider').val(note.startTime);
        },
        stop: () => handlePlaybackStop(seqId)
    });

  if (data[seqId].tempo)
    data[seqId].player.setTempo(data[seqId].tempo);

  if (data[seqId].player.isPlaying()) {
    data[seqId].player.stop();
    handlePlaybackStop(seqId);
  } else {
    stopAllPlayers();

    section.find('.visualizer-container').scrollLeft(0);
    section.find('.seek-slider').prop('max', data[seqId].sequence.totalTime).val(0);
    $('#loadingModal .loading-text').text('Loading sounds…');
    $('#loadingModal').modal('show');
    showWaiting($('html'), true);
    data[seqId].player.loadSamples(data[seqId].sequence)
      .then(() => {
        // Change button icon and text
        $(this).find('.oi').removeClass('oi-media-play').addClass('oi-media-stop');
        $(this).find('.text').text('Stop');
        $(this).prop('title', 'Stop');

        // Disable everything except for bottom controls
        setControlsEnabled(section, false);
        section.find('.card-footer button, .card-footer input').prop('disabled', false);

        // Start playback
        data[seqId].player.start(data[seqId].sequence);
      }).catch(handleError).finally(() => {
        $('#loadingModal').modal('hide');
        showWaiting($('html'), false);
      });
  }
});

$('.seek-slider').on('input', function() {
  const section = $(this).closest('[data-sequence-id]');
  const seqId = getSeqId(section);

  data[seqId].player.pause();
  data[seqId].player.seekTo(parseInt($(this).val() as string));
  data[seqId].player.resume();
});

$('.save-button').on('click', function() {
  const section = $(this).closest('[data-sequence-id]');
  const seqId = getSeqId(section);

  const seq = data[seqId].sequence;
  saveAs(new File([mm.sequenceProtoToMidi(seq)], seq.filename));
});

$('.generate-button').on('click', function() {
  const section = $(this).closest('[data-sequence-id]');

  // Create request
  const formData = new FormData();
  formData.append('content_input', new Blob([NoteSequence.encode(data['content'].sequence).finish()]), 'content_input');
  formData.append('style_input', new Blob([NoteSequence.encode(data['style'].sequence).finish()]), 'style_input');
  formData.append('sample', $('#samplingCheckbox').is(':checked').toString());
  formData.append('softmax_temperature', $('#samplingTemperature').val().toString());

  setControlsEnabled(section, false);
  showWaiting(section, true);
  const remixSection = $('.section[data-sequence-id="remix"]');
  setControlsEnabled(remixSection, false);
  showWaiting(remixSection, true);

  fetch(config.apiUrl + '/api/v1/style_transfer/' + $('#modelName').val() + '/',
        {method: 'POST', body: formData})
    .then(ensureResponseOk, () => Promise.reject('Connection error'))
    .then((response) => response.arrayBuffer())
    .then(function(buffer) {
      stopAllPlayers();

      // Decode the protobuffer
      const seq = NoteSequence.decode(new Uint8Array(buffer));

      // Assign a new filename based on the input filenames
      seq.filename = data['content'].sequence.filename.replace(/\.[^.]+$/, '') + '__' + data['style'].sequence.filename;

      // Display the sequence
      initSequence(section, seq);
      showMore('output-loaded');
    })
    .catch(handleError)
    .finally(() => {
      setControlsEnabled(section, true);
      showWaiting(section, false);
      setControlsEnabled(remixSection, true);
      showWaiting(remixSection, false);
    });
});

$('#savePreset').on('click', function() {
  saveAs(new File([exportPreset()], data['output'].sequence.filename.replace(/\.mid$/, '.json')));
});

function getSeqId(section: JQuery) {
  return section.data('sequence-id') as SequenceId;
}

function initSequence(section: JQuery, seq: INoteSequence, visualizerConfig?: mm.VisualizerConfig, staticMode?: boolean) {
  const seqId = getSeqId(section);
  data[seqId].trimmedSequence = seq;
  data[seqId].sequence = seq;

  if (!staticMode) {
    data[seqId].fullSequence = seq;

    if (seqId === 'content' || seqId === 'style') {
      data[seqId].beats = ns_util.getBeats(seq, true);
    }
  }

  if (seq.tempos && seq.tempos.length > 0 && seq.tempos[0].qpm > 0) {
    data[seqId].tempo = Math.round((seq.tempos[0].qpm + Number.EPSILON) * 10) / 10;
  } else {
    data[seqId].tempo = mm.constants.DEFAULT_QUARTERS_PER_MINUTE;
  }
  section.find('.tempo').val(data[seqId].tempo);

  // Show piano roll
  if (visualizerConfig) {
    // Override defaults with supplied values
    visualizerConfig = Object.assign(Object.assign({}, VISUALIZER_CONFIG), visualizerConfig);
  } else {
    visualizerConfig = VISUALIZER_CONFIG;
  }
  data[seqId].visualizerConfig = visualizerConfig;
  initVisualizer(seqId);

  if (seqId == 'remix') {
    const outputCheckboxes = addInstrumentCheckboxes(
        section.find('#remixOutputToggles'), seq, seqId);
    const contentCheckboxes = addInstrumentCheckboxes(
        section.find('#remixContentToggles'), data['content'].trimmedSequence, seqId,
        Math.max(0, ...outputCheckboxes.map((_, e) => parseInt(e.value))) + 1);
    contentCheckboxes.prop('checked', false);
    return;
  }

  addInstrumentCheckboxes(section.find('.instrument-toggles'), seq, seqId);

  // Update the remix section if needed
  if (seqId == 'content' || seqId == 'output') {
    initRemix(staticMode);
  }
}

function initVisualizer(seqId: SequenceId) {
  const section = $(data[seqId].section);
  const svg = section.find('svg')[0];
  data[seqId].visualizer = new mm.PianoRollSVGVisualizer(data[seqId].sequence, svg, data[seqId].visualizerConfig);
  section.find('.visualizer-container').scrollLeft(0);
}

function initTrimControls(section: JQuery) {
  const seqId = getSeqId(section);
  if (section.find('.start-time, .end-time').length === 0)
    return;
  const maxTime = data[seqId].beats.length - 1;
  section.find('.start-time').val(0);
  section.find('.start-time').prop('max', maxTime - 1);
  section.find('.end-time').val(maxTime);
  section.find('.end-time').prop('max', maxTime);
}

function addInstrumentCheckboxes(parent: JQuery, seq: INoteSequence, seqId: SequenceId, instrumentOffset = 0) {
  parent.empty();
  for (let [instrument, program] of ns_util.getInstrumentPrograms(seq)) {
    instrument = instrument + instrumentOffset;
    const controlId = 'checkbox' + (controlCount++);
    const label = program == DRUMS ? 'Drums' : INSTRUMENT_NAMES[program];
    const checkbox = $('<input type="checkbox" class="form-check-input" checked>')
        .attr('id', controlId)
        .attr('name', seqId + 'Instrument' + instrument)
        .val(instrument)
        .on('change', handleSequenceEdit);
    $('<div class="form-check form-check-inline"></div>')
      .append(checkbox)
      .append($('<label class="form-check-label"></label>')
        .attr('for', controlId)
        .attr('data-instrument', instrument)
        .text(label))
      .appendTo(parent);
  }
  return parent.find('input');
}

function handleSequenceEdit(this: HTMLElement) {
  const control = $(this);
  const section = control.closest('[data-sequence-id]');
  const seqId = getSeqId(section);

  showWaiting($('html'), true);
  delay().then(() => {
    var seq = data[seqId].fullSequence;
    if (seq) {
      const startBeat = parseInt(section.find('.start-time').val() as string);
      const endBeat = parseInt(section.find('.end-time').val() as string);
      // startBeat and endBeat will be NaN if the section has no trim controls.
      if (Number.isFinite(startBeat) && Number.isFinite(endBeat)) {
        // Cut a bit before the first beat, so that notes starting on the beat don't get removed.
        // The sequence will be quantized before running the model, so it's OK that it's a bit shifted.
        const beats = data[seqId].beats;
        const startTime = Math.max(0, beats[startBeat] - 1e-5);
        const endTime = beats[endBeat];
        seq = mm.sequences.trim(seq, startTime, endTime, true);
      }
      data[seqId].trimmedSequence = seq;
    } else {
      // There might be no fullSequence if the data was loaded from a preset
      seq = data[seqId].trimmedSequence;
    }

    const instruments = getSelectedInstruments(section.find('.instrument-toggles :checked'));
    seq = ns_util.filterByInstrument(seq, instruments);

    updateSequence(seqId, seq);

    if (control.hasClass('start-time')) {
      section.find('.visualizer-container').scrollLeft(0);
    }
  }).finally(() => showWaiting($('html'), false));
}

function initRemix(staticMode?: boolean) {
  const section = $('.section[data-sequence-id=remix]');

  $('#remixContentToggles input').prop('checked', false);
  if (!data['output'].trimmedSequence) return;

  // Make sure the visualizer is tall enough
  let minPitch = 127, maxPitch = 0;
  for (const seq of [data['output'].trimmedSequence, data['content'].trimmedSequence]) {
    for (const note of seq.notes) {
      minPitch = Math.min(minPitch, note.pitch);
      maxPitch = Math.max(maxPitch, note.pitch);
    }
  }
  minPitch = Math.min(minPitch, maxPitch);

  initSequence(section, data['output'].trimmedSequence, {minPitch: minPitch, maxPitch: maxPitch},
               staticMode);

  if (!staticMode) {
    const outputSeq = data['output'].trimmedSequence;
    const contentSeq = ns_util.normalizeTempo(data['content'].trimmedSequence,
                                              outputSeq.tempos[0].qpm);
    const seq = ns_util.merge([outputSeq, contentSeq]);
    seq.filename = outputSeq.filename.replace(/\.[^.]+$/, '') + '__remix.mid';
    data['remix'].fullSequence = data['remix'].trimmedSequence = seq;
  }
}

function updateSequence(seqId: SequenceId, seq: INoteSequence) {
  data[seqId].sequence = seq;
  initVisualizer(seqId);
}

function setControlsEnabled(section: JQuery, enabled: boolean) {
  section.find('input, button, select')
         .filter((_, e) => $(e).data('no-enable') === undefined)
         .prop('disabled', !enabled);
}

function handlePlaybackStop(seqId: SequenceId) {
  const section = $(data[seqId].section);
  const button = section.find('.play-button');

  button.find('.oi').removeClass("oi-media-stop").addClass("oi-media-play");
  button.find('.text').text('Play');
  button.prop('title', 'Play');

  setControlsEnabled(section, true);
  section.find('.seek-slider').prop('disabled', true);
}

export function stopAllPlayers() {
  for (const seqId of SEQ_IDS) {
    if (data[seqId].player && data[seqId].player.isPlaying()) {
      data[seqId].player.stop();
      handlePlaybackStop(seqId);
    }
  }
}

function showMore(label: string, scroll = true) {
  const elements = $('.after-' + label);
  if (!elements.is(":visible")) {
    elements.fadeIn(
      'fast',
      () => {
        elements.find('.seek-slider').prop('disabled', true);  // Workaround for Bootstrap range
        if (scroll) {
          elements.filter('.visualizer-card').first().each((_, e) => {
            e.scrollIntoView({behavior: 'smooth'});
          });
        }
      });
  }
}

function getSelectedInstruments(checkboxes: JQuery<HTMLElement>) {
  return checkboxes.map((_, checkbox) => $(checkbox).val())
    .map((_, p) => Number(p))
    .get();
}

export function exportPreset() {
  const dataCopy = {} as any;
  for (const seqId of SEQ_IDS) {
    dataCopy[seqId] = {};
    for (const key in data[seqId]) {
      if (!['player', 'visualizer', 'visualizerConfig', 'section', 'fullSequence', 'beats'].includes(key)) {
        var value = data[seqId][key as keyof SequenceData];
        if (value instanceof NoteSequence) {
          value = value.toJSON();
        }
        dataCopy[seqId][key] = value;
      }
    }
  }
  return JSON.stringify({
    data: dataCopy,
    controls: $('input, select').serializeArray()
  });
}

export function loadPreset(preset: {[k: string]: any}, staticMode = false) {
  // Load full sequence data
  for (const seqId of SEQ_IDS) {
    // Convert NoteSequences from JSON
    const presetData = {} as any;
    for (const key in preset.data[seqId]) {
      presetData[key] = preset.data[seqId][key];
      if (presetData[key].notes) {
        presetData[key] = NoteSequence.fromObject(presetData[key]);
      }
    }

    if (seqId == 'remix') {
      initRemix(true);
    } else {
      initSequence($(data[seqId].section), presetData.trimmedSequence, undefined, staticMode);
    }
    Object.assign(data[seqId], presetData);
  }

  // Restore control states
  $('input[type="radio"], input[type="checkbox"]').prop('checked', false);
  for (const ctrl of preset.controls) {
    for (const e of document.getElementsByName(ctrl.name) as NodeListOf<HTMLInputElement>) {
      if (['radio', 'checkbox'].includes(e.type)) {
        e.checked = true;
      } else {
        e.value = ctrl.value;
      }
    }
  }

  // Re-initialize controls if not in static mode
  if (!staticMode) {
    SEQ_IDS.forEach((seqId) => { initTrimControls($(data[seqId].section)); });
  }

  // Load the edited (filtered & remixed) sequences
  for (const seqId of SEQ_IDS) {
    updateSequence(seqId, data[seqId].sequence);

    // Also set filenames
    $(data[seqId].section).find('.custom-file label').text(data[seqId].sequence.filename);

    showMore(seqId + '-loaded', false);
  }
}

export function loadPresetFromUrl(url: string, contentName: string, styleName: string, staticMode?: boolean) {
  stopAllPlayers();

  $('#loadingModal .loading-text').text('Loading…');
  $('#loadingModal').modal('show');
  $('html').addClass('cursor-progress');

  fetch(url)
    .then(ensureResponseOk, () => Promise.reject('Connection error'))
    .then((response) => response.json()).then((json) => {
      loadPreset(json, staticMode);
      $('#contentFilename').val(json.data['content'].sequence.filename);
      $('#styleFilename').val(json.data['style'].sequence.filename);
      if (contentName) {
        $('.section[data-sequence-id="content"] h2').text('Content input: ' + contentName);
      }
      if (styleName) {
        $('.section[data-sequence-id="style"] h2').text('Style input: ' + styleName);
      }
      $('.section[data-sequence-id="content"]')[0].scrollIntoView({behavior: 'smooth'});
    }).catch(handleError).finally(() => {
      $('#loadingModal').modal('hide');
      $('html').removeClass('cursor-progress');
    });
}

function ensureResponseOk(response: Response) {
  if (!response.ok) {
    const contentType = response.headers.get('Content-Type');
    if (contentType && contentType.startsWith('text/plain')) {
      return response.text().then((text) => Promise.reject(text));
    } else {
      return Promise.reject(response.statusText);
    }
  }
  return response;
}

function handleError(error: any) {
  try {
    var text = '';
    if (error) {
      if (typeof error.text === 'function') {
        text = error.text();
      } else {
        text = error.toString();
      }
    }
    var message = text, title = 'Error';
    if (ERROR_MESSAGES[text]) {
      message = ERROR_MESSAGES[text].message;
      title = ERROR_MESSAGES[text].title;
    }
    $('#errorModal .modal-title').text('\u26a0 ' + title);
    $('#errorModal .error-text').text(message);
    $('#errorModal').modal('show');
  } finally {
    throw error;
  }
}

function showWaiting(element: JQuery, waiting = true) {
  if (waiting) {
    element.data('in-progress', (element.data('in-progress') || 0) + 1);
    element.addClass('cursor-progress');
  } else {
    element.data('in-progress', (element.data('in-progress') || 1) - 1);
    if (!element.data('in-progress')) {
      element.removeClass('cursor-progress');
    }
  }
}

function delay(time = 0) {
  return new Promise(resolve => setTimeout(() => resolve(), time));
}
