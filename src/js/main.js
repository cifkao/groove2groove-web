import '../scss/main.scss';

import 'bootstrap/js/dist/modal';
import {saveAs} from 'file-saver';
import * as mm from '@magenta/music/es6/core';
import {NoteSequence} from '@magenta/music/es6/protobuf';
import * as ns_util from './ns_util';


const config = {apiUrl: '.'};
export function init(cfg) {
  Object.assign(config, cfg);
}

const VISUALIZER_CONFIG = {
  pixelsPerTimeStep: 40,
  noteHeight: 4,
};
const INSTRUMENT_NAMES = [
  "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano", "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet", "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer", "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion", "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)", "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics", "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2", "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani", "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2", "Choir Aahs", "Voice Oohs", "Synth Choir", "Orchestra Hit", "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2", "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet", "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown bottle", "Shakuhachi", "Whistle", "Ocarina", "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 chiff", "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)", "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)", "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)", "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)", "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)", "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai", "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal", "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot"
];
const DRUMS = ns_util.DRUMS;

const ERROR_MESSAGES = {
  'STYLE_INPUT_TOO_LONG': {
    title: 'Input too long',
    message: 'The given style input is too long. Please use the ‘Start bar’ and ‘End bar’ fields to select an 8-bar (32-beat) section.'
  }
};

const data = {content: {}, style: {}, output: {}, remix: {}};
var controlCount = 0;  // counter used for assigning IDs to dynamically created controls

$('.section[data-sequence-id]').each(function() {
  data[$(this).data('sequence-id')].section = this;
});

$('form').submit(function(e){ e.preventDefault(); });

$('.after-content-loaded, .after-style-loaded, .after-output-loaded').hide();
$('.container').fadeIn('fast');

$('#presetsButton').click(function() {
  $('#presetModal').modal('show');
});

$('input.midi-input').on('change', function() {
  const file = this.files[0];
  if (!file) return;

  const section = $(this).closest('[data-sequence-id]');
  const seqId = section.data('sequence-id');

  setControlsEnabled(section, false);
  $(this).siblings('.custom-file-label').text(this.files[0].name);

  mm.blobToNoteSequence(file).then(function(seq) {
    seq.filename = file.name;

    initSequence(section, seq);
    initTrimControls(section);

    showMore(seqId + '-loaded');
  }).catch(handleError).finally(() => setControlsEnabled(section, true));
});

$('.start-time, .end-time').on('change', handleSequenceEdit);

$('.tempo').on('change', function() {
  const section = $(this).closest('[data-sequence-id]');
  const seqId = section.data('sequence-id');

  data[seqId].tempo = $(this).val();
  if (data[seqId].player)
    data[seqId].player.setTempo(data[seqId].tempo);
});

$('.play-button').on('click', function() {
  const section = $(this).closest('[data-sequence-id]');
  const seqId = section.data('sequence-id');

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
      }).catch(handleError).finally(() => $('#loadingModal').modal('hide'));
  }
});

$('.seek-slider').on('input', function() {
  const section = $(this).closest('[data-sequence-id]');
  const seqId = section.data('sequence-id');

  data[seqId].player.pause();
  data[seqId].player.seekTo($(this).val());
  data[seqId].player.resume();
});

$('.save-button').on('click', function() {
  const section = $(this).closest('[data-sequence-id]');
  const seqId = section.data('sequence-id');

  const seq = data[seqId].sequence;
  saveAs(new File([mm.sequenceProtoToMidi(seq)], seq.filename));
});

$('.generate-button').on('click', function() {
  const section = $(this).closest('[data-sequence-id]');
  const seqId = section.data('sequence-id');

  // Create request
  const formData = new FormData();
  formData.append('content_input', new Blob([NoteSequence.encode(data['content'].sequence).finish()]), 'content_input');
  formData.append('style_input', new Blob([NoteSequence.encode(data['style'].sequence).finish()]), 'style_input');
  formData.append('sample', $('#samplingCheckbox').is(':checked'));
  formData.append('softmax_temperature', $('#samplingTemperature').val());

  setControlsEnabled(section, false);

  fetch(config.apiUrl + '/api/v1/style_transfer/' + $('#modelName').val() + '/', {method: 'POST', body: formData})
    .then(ensureResponseOk, () => Promise.reject('Connection error'))
    .then((response) => response.arrayBuffer())
    .then(function (buffer) {
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
    .finally(() => setControlsEnabled(section, true));
});

$('#savePreset').on('click', function() {
  saveAs(new File([exportPreset()], data['output'].sequence.filename.replace(/\.mid$/, '.json')));
});

function initSequence(section, seq, visualizerConfig, staticMode) {
  const seqId = section.data('sequence-id');
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
  const svg = section.find('svg')[0];
  if (visualizerConfig) {
    // Override defaults with supplied values
    visualizerConfig = Object.assign(Object.assign({}, VISUALIZER_CONFIG), visualizerConfig);
  } else {
    visualizerConfig = VISUALIZER_CONFIG;
  }
  data[seqId].visualizer = new mm.PianoRollSVGVisualizer(seq, svg, visualizerConfig);
  section.find('.visualizer-container').scrollLeft(0);

  if (seqId == 'remix') {
    const outputCheckboxes = addInstrumentCheckboxes(
        section.find('#remixOutputToggles'), seq, seqId);
    const contentCheckboxes = addInstrumentCheckboxes(
        section.find('#remixContentToggles'), data['content'].trimmedSequence, seqId,
        Math.max(0, ...outputCheckboxes.map((_, e) => e.value)) + 1);
    contentCheckboxes.prop('checked', false);
    return;
  }

  addInstrumentCheckboxes(section.find('.instrument-toggles'), seq, seqId);

  // Update the remix section if needed
  if (seqId == 'content' || seqId == 'output') {
    initRemix(staticMode);
  }
}

function initTrimControls(section) {
  const seqId = section.data('sequence-id');
  if (section.find('.start-time, .end-time').length === 0)
    return;
  const seq = data[seqId].fullSequence;
  const maxTime = data[seqId].beats.length - 1;
  section.find('.start-time').val(0);
  section.find('.start-time').prop('max', maxTime - 1);
  section.find('.end-time').val(maxTime);
  section.find('.end-time').prop('max', maxTime);
}

function addInstrumentCheckboxes(parent, seq, seqId, instrumentOffset) {
  instrumentOffset = instrumentOffset || 0;

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

function handleSequenceEdit() {
  const section = $(this).closest('[data-sequence-id]');
  const seqId = section.data('sequence-id');

  var seq = data[seqId].fullSequence;
  if (seq) {
    const startBeat = parseInt(section.find('.start-time').val());
    const endBeat = parseInt(section.find('.end-time').val());
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
  data[seqId].selectedInstruments = instruments;
  seq = ns_util.filterSequence(seq, instruments);

  updateSequence(seqId, seq);

  if ($(this).hasClass('start-time'))
    section.find('.visualizer-container').scrollLeft(0);
}

function initRemix(staticMode) {
  const section = $('.section[data-sequence-id=remix]');

  $('#remixContentToggles input').prop('checked', false);
  if (!data['output'].trimmedSequence) return;

  // Initialize with the output only, but make sure the visualizer is tall enough
  initSequence(section, data['output'].trimmedSequence,
               {minPitch: Math.min(data['output'].visualizer.config.minPitch, data['content'].visualizer.config.minPitch),
                maxPitch: Math.max(data['output'].visualizer.config.maxPitch, data['content'].visualizer.config.maxPitch)},
               staticMode);

  if (!staticMode) {
    // Create request
    const contentSeq = data['content'].trimmedSequence;
    const outputSeq = data['output'].trimmedSequence;
    const formData = new FormData();
    formData.append('content_sequence', new Blob([NoteSequence.encode(contentSeq).finish()]), 'content_sequence');
    formData.append('output_sequence', new Blob([NoteSequence.encode(outputSeq).finish()]), 'output_sequence');

    // Get the response
    setControlsEnabled(section, false);
    fetch(config.apiUrl + '/api/v1/remix/', {method: 'POST', body: formData})
      .then(ensureResponseOk, () => Promise.reject('Connection error'))
      .then((response) => response.arrayBuffer())
      .then(function (buffer) {
        // Decode the protobuffer
        const seq = NoteSequence.decode(new Uint8Array(buffer));

        // Assign a new filename based on the input filenames
        seq.filename = outputSeq.filename.replace(/\.[^.]+$/, '') + '__remix.mid';

        data['remix'].fullSequence = data['remix'].trimmedSequence = seq;
      })
      .catch(handleError)
      .finally(() => setControlsEnabled(section, true));
  }
}

function updateSequence(seqId, seq) {
  data[seqId].sequence = seq;
  data[seqId].visualizer.noteSequence = seq;
  data[seqId].visualizer.clear();
  data[seqId].visualizer.redraw();
}

function setControlsEnabled(section, enabled) {
  section.find('input, button, select')
         .filter((_, e) => $(e).data('no-enable') === undefined)
         .prop('disabled', !enabled);
}

function handlePlaybackStop(seqId) {
  const section = $(data[seqId].section);
  const button = section.find('.play-button');

  button.find('.oi').removeClass("oi-media-stop").addClass("oi-media-play");
  button.find('.text').text('Play');
  button.prop('title', 'Play');

  setControlsEnabled(section, true);
  section.find('.seek-slider').prop('disabled', true);
}

export function stopAllPlayers() {
  for (const seqId in data) {
    if (data[seqId].player && data[seqId].player.isPlaying()) {
      data[seqId].player.stop();
      handlePlaybackStop(seqId);
    }
  }
}

function showMore(label, scroll) {
  if (scroll === undefined) {
    scroll = true;
  }
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

function getSelectedInstruments(checkboxes) {
  return checkboxes.map((_, checkbox) => $(checkbox).val())
    .map((_, p) => isNaN(p) ? p : parseInt(p))
    .get();
}

export function exportPreset() {
  const dataCopy = {};
  for (const seqId in data) {
    dataCopy[seqId] = {};
    for (const key in data[seqId]) {
      if (!['player', 'visualizer', 'section', 'fullSequence'].includes(key)) {
        var value = data[seqId][key];
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

export function loadPreset(preset, staticMode) {
  if (staticMode === undefined) {
    staticMode = false;
  }

  // Make sure things are loaded in the correct order
  const seqIds = ['content', 'style', 'output', 'remix'];

  // Load full sequence data
  seqIds.forEach((seqId) => {
    // Convert NoteSequences from JSON
    const presetData = {};
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
  });

  // Restore control states
  $('input[type="radio"], input[type="checkbox"]').prop('checked', false);
  preset.controls.forEach((ctrl) => {
    document.getElementsByName(ctrl.name).forEach((e) => {
      if (['radio', 'checkbox'].includes(e.type)) {
        e.checked = true;
      } else {
        e.value = ctrl.value;
      }
    });
  });

  // Re-initialize controls if not in static mode
  if (!staticMode) {
    seqIds.forEach((seqId) => { initTrimControls($(data[seqId].section)); });
  }

  // Load the edited (filtered & remixed) sequences
  seqIds.forEach((seqId) => {
    updateSequence(seqId, data[seqId].sequence);

    // Also set filenames
    $(data[seqId].section).find('.custom-file label').text(data[seqId].sequence.filename);

    showMore(seqId + '-loaded', false);
  });
}

export function loadPresetFromUrl(url, contentName, styleName, staticMode) {
  stopAllPlayers();

  $('#loadingModal .loading-text').text('Loading…');
  $('#loadingModal').modal('show');

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
    }).catch(handleError).finally(() => $('#loadingModal').modal('hide'));
}

function ensureResponseOk(response) {
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

function handleError(error) {
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
