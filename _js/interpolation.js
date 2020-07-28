import './common';
import * as mm from '@magenta/music/es6/core';

$('#pageLoadingIndicator').hide();

const VIZ_CONFIG = {
  pixelsPerTimeStep: 40,
  noteHeight: 3,
  minPitch: 24,
  maxPitch: 90
};

const DATA = [
  {
    styleA: "Country Arpeggios",
    styleB: "“Hank Sr.” Classic Country Ballad",
    path: "Piano_Bass/09_ARPEGGIO_b_C~HNKSR1_b/00",
    vizConfig: {
      maxPitch: 80
    }
  },
  {
    styleA: "80s Rock Blues",
    styleB: "12/8 Blues",
    path: "Piano_Bass/16_Clashin1_b_BEEBSLO_b/00",
    comment: "In the 80s Rock Blues style, the “Piano” track actually contains an electric guitar, but we play it using a piano sound here."
  },
  {
    styleA: "“Eagles” Contemporary Country",
    styleB: "Salsa Guajira",
    path: "Piano_Bass/03_c_eagle2_a_Guajir2_b/00"
  },
  {
    styleA: "Bossa Lite",
    styleB: "“Creedence” 70s Funk Country Rock",
    path: "Bass/11_BosaLite_a_CREEDNCE_a/10",
    vizConfig: {
      maxPitch: 50
    }
  },
];

const EXAMPLE_TEMPLATE = $("#exampleTemplate").detach().removeAttr("id");

var activeVisualizer;

var player = new mm.SoundFontPlayer("https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus",
                                    undefined, null, null,
                                    {
                                      run: (note) => activeVisualizer && activeVisualizer.redraw(note),
                                      stop: playbackStopHandler
                                    });

function playbackStopHandler() {
  if (activeVisualizer) {
    activeVisualizer.redraw({});
    activeVisualizer = null;
  }
  $('.oi-media-stop').removeClass('oi-media-stop').addClass('oi-media-play');
}

DATA.forEach(function(item) {
  var e = EXAMPLE_TEMPLATE.clone(true);
  e.data("data", item);
  e.find("input, button").attr("disabled", true);
  e.find(".style-a").text(item.styleA);
  e.find(".style-b").text(item.styleB);
  if (item.comment)
    $("<p>").text(item.comment).insertAfter(e.find(".heading"));
  e.appendTo("#blendingExamples");
  Promise.all(
    (function() {
      var a = [];
      for (var i = 0; i <= 100; i += 1) {
        a.push(i / 100);
      }
      return a;
    })().map(function(alpha) {
      var url = "data/blending/" + item.path + "/" + alpha.toFixed(2) + ".mid";
      return mm.urlToNoteSequence(url)
    })
  ).then(function(result) {
    e.data("sequences", result);
    e.find(".alpha-range").trigger("input");
    e.find("input, button").attr("disabled", false);
    e.find(".loading-indicator").hide();
  });
});

$(".alpha-range").on("input", function() {
  var e = $(this).closest(".example");
  if (activeVisualizer && activeVisualizer == e.data("visualizer")) {
    player.stop();
    playbackStopHandler();
  }

  var alphaIndex = $(this).val();
  e.find(".alpha-value").text((alphaIndex / 100).toFixed(2));
  var svg = e.find(".piano-roll")[0];
  var vizConfig = Object.assign({}, VIZ_CONFIG, e.data("data").vizConfig);
  var visualizer = new mm.PianoRollSVGVisualizer(
      e.data("sequences")[alphaIndex], svg, vizConfig);
  visualizer.redraw({});
  e.data("visualizer", visualizer);
});

$(".play-button").click(function() {
  if(player.isPlaying()) {
    player.stop();
    playbackStopHandler();
    return;
  }

  $(this).find('.oi-media-play').removeClass('oi-media-play').addClass('oi-media-stop');

  activeVisualizer = $(this).closest(".example").data("visualizer");
  player.start(activeVisualizer.noteSequence);
});
