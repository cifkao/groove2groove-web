import './common';

import {saveAs} from 'file-saver';
import * as mm from '@magenta/music/es6/core';
import {NoteSequence, INoteSequence} from '@magenta/music/es6/protobuf';
import {instrumentByPatchID} from '@tonejs/midi/dist/InstrumentMaps';
import {getReasonPhrase} from 'http-status-codes';
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
  (s) => s
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\(.*\)/, (m) => m.toLowerCase()));

const AMADEUS_GIF = '<video width="640" height="340" autoplay loop muted playsinline poster="https://j.gifs.com/71Zzm8.jpg" class="modal-meme">' +
                    '<source src="https://j.gifs.com/71Zzm8.mp4" type="video/mp4">' +
                    '</video>';
new Image().src = 'https://j.gifs.com/71Zzm8.jpg';  // Preload image

interface ErrorMessage {
  title: string;
  body: string;
}
const ERROR_MESSAGES = {
  'CONTENT_INPUT_TOO_LONG': {
    title: 'Content input too long',
    body: 'Your <strong>content input</strong> is too long. Please use the ‘Start beat’ and ‘End beat’ fields to reduce its length.' +
          AMADEUS_GIF
  },
  'STYLE_INPUT_TOO_LONG': {
    title: 'Style input too long',
    body: 'Your <strong>style input</strong> is too long. Please use the ‘Start beat’ and ‘End beat’ fields to select an 8-bar (32-beat) section.' +
          AMADEUS_GIF
  },
  'CONTENT_INPUT_TOO_MANY_NOTES': {
    title: 'Too many notes',
    body: 'Your <strong>content input</strong> contains too many notes for us to process. Try reducing its length or deselecting some instruments.' +
          AMADEUS_GIF
  },
  'STYLE_INPUT_TOO_MANY_NOTES': {
    title: 'Too many notes',
    body: 'Your <strong>style input</strong> contains too many notes for us to process. Try deselecting some instruments.' +
          AMADEUS_GIF
  },
  'STYLE_INPUT_TOO_MANY_INSTRUMENTS': {
    title: 'Too many instruments',
    body: 'The <strong>style input</strong> contains too many instruments. Please deselect some of them.' +
          AMADEUS_GIF
  },
  'MODEL_TIMEOUT': {
    title: 'Timed out',
    body: 'The model took too long to process your input. This may happen with certain inputs or when the server is overloaded. ' +
          'Try again later or with a different input.'
  },
  413: /* Request Entity Too Large */ {
    title: 'Input too large',
    body: 'Your inputs are too large for us to process. Please try reducing their length using the ' +
          '‘Start beat’ and ‘End beat’ fields or deselecting some instruments.' +
          AMADEUS_GIF
  },
  429: /* Too Many Requests */ {
    title: 'Too many requests',
    body: 'You have reached your limit. Please try again in a moment.'
  },
} as Record<string | number, ErrorMessage>;

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

setEnabled($('[disabled]'), false);  // set the disabled counter to 1
$('[data-show-in-advanced], .after-content-loaded, .after-style-loaded, .after-output-loaded').hide();
$(data['content'].section).hide();
$('#pageLoadingIndicator').hide();
$('main .content').fadeIn('fast');

// Load preset if requested by query parameter
if (typeof URLSearchParams !== 'undefined') {
  const presetUrl = new URLSearchParams(window.location.search).get('preset');
  if (presetUrl != null) {
    loadPresetFromUrl(presetUrl);
  }
}

$('#presetsButton').click(function() {
  $('#presetModal').modal('show');
});

$('button[data-preset-url]').click(function(event) {
  event.preventDefault();
  $('#presetModal').modal('hide');
  loadPresetFromUrl(this.dataset.presetUrl);
});

$('#advancedModeToggle').change(function() {
  const checked = $(this).prop('checked');
  setEnabled($('[data-enable-in-advanced]'), checked);
  if (checked) {
    $('[data-show-in-advanced]').show();
    $('[data-hide-in-advanced]').hide();
    $(data['content'].section).show();
  } else {
    $('[data-show-in-advanced]').hide();
    $('[data-hide-in-advanced]').show();

    if($('.after-output-loaded').not(':visible').length > 0) {
      // If some parts of the page are still hidden, hide everything again.
      $(data['content'].section).hide();
      $('.after-content-loaded, .after-style-loaded, .after-output-loaded').hide();
    }
  }
});

$('input.midi-input').on('change', function() {
  const el = this as HTMLInputElement;
  const file = el.files[0];
  if (!file) return;

  const section = $(el).closest('[data-sequence-id]');

  setSectionEnabled(section, false);
  section.find('.input-filename').text(el.files[0].name);

  mm.blobToNoteSequence(file).then(function(seq) {
    seq.filename = file.name;

    initSequence(section, seq);
    initTrimControls(section);

    showMore('.after-' + getSeqId(section) + '-loaded');
  }).catch(handleError).finally(() => setSectionEnabled(section, true));
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
    showWaiting(section, true);
    setSectionEnabled(section, false);
    data[seqId].player.loadSamples(data[seqId].sequence)
      .then(() => {
        // Change button icon and text
        $(this).find('.oi').removeClass('oi-media-play').addClass('oi-media-stop');
        $(this).find('.text').text('Stop');
        $(this).prop('title', 'Stop');

        // Enable bottom controls
        setEnabled(section.find('.card-footer button, .card-footer input'), true);
        setEnabled(section.find('.seek-slider'), true);

        // Start playback. Allow the UI to update first to avoid a playback glitch
        setTimeout(() => { data[seqId].player.start(data[seqId].sequence); }, 20);
      }).catch(handleError).finally(() => {
        showWaiting(section, false);
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

  setSectionEnabled(section, false);
  showWaiting(section, true);
  const remixSection = $('.section[data-sequence-id="remix"]');
  setSectionEnabled(remixSection, false);
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
      showMore('.after-output-loaded', true);
    })
    .catch(handleError)
    .finally(() => {
      setSectionEnabled(section, true);
      showWaiting(section, false);
      setSectionEnabled(remixSection, true);
      showWaiting(remixSection, false);
    });
});

$('#sharePresetButton').on('click', () => {
  const filename = data['output'].sequence.filename.replace(/\.mid$/, '.json');
  const file = new File([exportPreset()], filename);
  $('#sharePresetModal .preset-filename').text(filename);
  $('#presetDownloadButton').off();
  $('#presetDownloadButton').on('click', () => {
    saveAs(file);
  });
  $('#uploadedPresetUrl').val('');
  $('#presetShareUrl').val('');
  $('#sharePresetModal').modal('show');
});

$('#uploadedPresetUrl').on('input change', ({currentTarget}) => {
  const url = (currentTarget as HTMLInputElement).value;
  const paramString = new URLSearchParams({'preset': url}).toString();
  $('#presetShareUrl').val('https://groove2groove.telecom-paris.fr/demo.html?' + paramString);
});

$('#presetShareUrl').on('focus', ({currentTarget}) => {
  (currentTarget as HTMLInputElement).select();
});

$('#savePreset').on('click', function() {
  saveAs(new File([exportPreset()], data['output'].sequence.filename.replace(/\.mid$/, '.json')));
});

function getSeqId(section: JQuery) {
  return section.data('sequence-id') as SequenceId;
}

function initSequence(section: JQuery, seq: INoteSequence, visualizerConfig?: mm.VisualizerConfig, staticMode = false) {
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
  initVisualizer(seqId, true);

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

function initVisualizer(seqId: SequenceId, reset = false) {
  const section = $(data[seqId].section);
  const container = section.find('.visualizer-container');
  const svg = container.find('svg')[0];
  const beatBar = container.find('.beat-bar')[0];

  data[seqId].visualizer = new mm.PianoRollSVGVisualizer(data[seqId].sequence, svg, data[seqId].visualizerConfig);

  beatBar.innerHTML = '';
  const beatTimes = data[seqId].beats;
  if (beatTimes != null) {
    const pixelsPerSecond = data[seqId].visualizerConfig.pixelsPerTimeStep;
    const startBeat = reset ? 0 : parseInt(section.find('.start-time').val() as string);
    const endBeat = reset ? beatTimes.length - 1 : parseInt(section.find('.end-time').val() as string);
    let lastI = startBeat;
    for (let i = startBeat + 1; i <= endBeat; i++) {
      const beatElement = document.createElement('span');
      const width = pixelsPerSecond * (beatTimes[i] - beatTimes[lastI]);
      beatElement.style.flexBasis = String(width) + 'px';
      beatElement.style.maxWidth = String(width) + 'px';
      beatElement.classList.add('beat');
      if ((i - 1 - startBeat) % 4 == 0) {
        beatElement.classList.add('downbeat');
        beatElement.innerText = String(lastI);
      }
      beatBar.appendChild(beatElement);
      lastI = i;
    }
  }

  container.scrollLeft(0);
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

  showWaiting(section, true);
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
  }).finally(() => showWaiting(section, false));
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
  minPitch -= 2;
  maxPitch += 1;

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

function setSectionEnabled(section: JQuery, enabled: boolean) {
  setEnabled(section.find('input, button, select').not('#sharePresetButton'), enabled);
}

function handlePlaybackStop(seqId: SequenceId) {
  const section = $(data[seqId].section);
  const button = section.find('.play-button');

  button.find('.oi').removeClass("oi-media-stop").addClass("oi-media-play");
  button.find('.text').text('Play');
  button.prop('title', 'Play');

  setSectionEnabled(section, true);
  setEnabled(section.find('.seek-slider'), false);
}

function stopAllPlayers() {
  for (const seqId of SEQ_IDS) {
    if (data[seqId].player && data[seqId].player.isPlaying()) {
      data[seqId].player.stop();
      handlePlaybackStop(seqId);
    }
  }
}

function showMore(selector: string, scroll = false) {
  const elements = $(selector).not(':visible');
  elements.fadeIn(
    'fast',
    () => {
      elements.find('.seek-slider').prop('disabled', true);  // Workaround for Bootstrap range
      if (scroll) {
        elements.filter('.section, .visualizer-card').first().each((_, e) => {
          e.scrollIntoView();
        });
      }
    });
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
    version: 1,
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
    $(data[seqId].section).find('.input-filename').text(data[seqId].sequence.filename);

    showMore('.after-' + seqId + '-loaded');
  }
  showMore('.section', true);
}

export function loadPresetFromUrl(url: string, contentName?: string, styleName?: string, staticMode?: boolean) {
  stopAllPlayers();

  $('#loadingModal .loading-text').text('Loading…');
  $('#loadingModal').modal('show');
  showWaiting($('body'), true);

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
      $('.section[data-sequence-id="content"]')[0].scrollIntoView();
    }).catch(handleError).finally(() => {
      $('#loadingModal').modal('hide');
      showWaiting($('body'), false);
    });
}

function ensureResponseOk(response: Response) {
  if (!response.ok) {
    const contentType = response.headers.get('Content-Type');
    if (contentType && contentType.startsWith('application/json')) {
      return response.json().then((json) => {
        json.headers = response.headers;
        return Promise.reject(json);
      });
    } else {
      return Promise.reject(getReasonPhrase(response.status));
    }
  }
  return response;
}

function handleError(error: any) {
  try {
    let text = 'Unknown error', code = null;
    if (error) {
      if (error.error) {
        text = error.error;
        code = error.code;
      } else if (typeof error.text === 'function') {
        text = error.text();
      } else {
        text = error.toString();
      }
    }
    let message = {body: text, title: 'Error'};
    message = ERROR_MESSAGES[text] || ERROR_MESSAGES[code] || message;
    $('#errorModal .modal-title').html('\u26a0 ' + message.title);
    $('#errorModal .error-text').html(message.body);
    $('#errorModal').modal('show');
  } finally {
    throw error;
  }
}

function setEnabled(controls: JQuery, enabled: boolean) {
  controls.each((_, element) => {
    $(element).prop('disabled', counterAttr(element, 'disabled', !enabled));
  });
}

function showWaiting(elements: JQuery, waiting: boolean) {
  elements.each((_, element) => {
    if (counterAttr(element, 'in-progress', waiting)) {
      $(element).addClass('cursor-progress');
    } else {
      $(element).removeClass('cursor-progress');
    }
  });
}

function counterAttr(element: HTMLElement, name: string, increment = true) {
  const e = $(element);
  if (increment) {
    e.data(name, (e.data(name) || 0) + 1);
    return true;
  } else {
    e.data(name, (e.data(name) || 1) - 1);
    return e.data(name) > 0;
  }
}

function delay(time = 0) {
  return new Promise(resolve => setTimeout(() => resolve(), time));
}
