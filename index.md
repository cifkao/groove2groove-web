---
layout: default
title: Groove2Groove – One-shot music style transfer
---

<header style="background-image: url('{{ "/assets/img/splash-vinyls.jpg" | relative_url }}')">
  <div class="container" style="padding: 100px 15px 70px 15px">
    <h1><a href="#">Groove2Groove</a></h1>
    <div class="subheading">
      One-shot style transfer for music accompaniments
    </div>
    <div style="margin-top: 35px;">
      <a href="#Paper" class="btn btn-outline-light m-1" role="button">
        <small><span class="oi oi-document" aria-hidden="true"></span></small>
        Paper
      </a>
      <a href="{{ "/demo.html" | relative_url }}" class="btn btn-outline-light m-1" role="button">
        <small><span class="oi oi-audio-spectrum" aria-hidden="true"></span></small>
        Demo
      </a>
      <a href="https://github.com/cifkao/groove2groove" target="_blank" class="btn btn-outline-light m-1" role="button">
        <small><span class="oi oi-code" aria-hidden="true"></span></small>
        Code
      </a>
      <a href="#Dataset" class="btn btn-outline-light m-1" role="button">
        <small><span class="oi oi-data-transfer-download" aria-hidden="true"></span></small>
        Data
      </a>
    </div>
  </div>
</header>

<main>
  <div class="container">
    <div class="row pt-2 pb-2">
      <div class="lead col-12" markdown="1">
**Groove2Groove** (Grv2Grv) is an AI system for music accompaniment style transfer.
Given two MIDI files – a **content input** and a **style input** – it generates a new accompaniment
for the first file in the style of the second one.
</div>
    </div>
  </div>

  <div class="container">
    <div class="row pt-4 pb-2">
      <div class="col-md-3 col-12 mb-3">
        <h3 id="Paper" class="anchor"><span class="mr-2">Paper</span><span class="badges">
          <a href="{{ "/data/paper.pdf" | relative_url }}" class="badge"><span class="oi oi-document" aria-hidden="true"></span>PDF</a>
          <a href="https://doi.org/10.1109/TASLP.2020.3019642" target="blank" class="badge"><span class="oi oi-double-quote-serif-right" aria-hidden="true"></span>DOI</a>
        </span></h3>
      </div>
      <div class="col-md-9 col-12">
        <p>The system is described in our paper:</p>
        <blockquote>
          <p class="mb-0">
            <a href="https://ondrej.cifka.com" target="_blank">O. Cífka</a>, <a href="https://perso.telecom-paristech.fr/simsekli/" target="_blank">U. Şimşekli</a> and <a href="https://perso.telecom-paristech.fr/grichard/" target="_blank">G. Richard</a>, "Groove2Groove: One-Shot Music Style Transfer with Supervision from Synthetic Data," in <em>IEEE/ACM Transactions on Audio, Speech, and Language Processing</em>, doi: <a href="https://doi.org/10.1109/TASLP.2020.3019642" target="_blank">10.1109/TASLP.2020.3019642</a>.
          </p>
        </blockquote>
      </div>
    </div>
  </div>

  <div class="container">
    <div class="row pt-4 pb-2">
      <div class="col-md-3 col-12 mb-3">
        <h3 id="Additional_resources" class="anchor"><span class="mr-2">Additional resources</span><span class="badges">
          <a href="https://github.com/cifkao/groove2groove" target="blank" class="badge"><span class="oi oi-code" aria-hidden="true"></span>GitHub</a>
        </span></h3>
      </div>
      <div class="col-md-9 col-12" markdown="1">
We provide the following resources to supplement the paper:
  - [Source code](https://github.com/cifkao/groove2groove){:target="_blank"} of the system and the evaluation metrics
  - [Configuration files](https://github.com/cifkao/groove2groove){:target="_blank"} with hyperparameter settings
  - [Style interpolation (blending) examples]({{ "/style-interpolation.html" | relative_url }})
  - [Dataset](#Dataset) used for training and evaluation
</div>
    </div>
  </div>

  <div class="container">
    <div class="row pt-4 pb-2">
      <div class="col-md-3 col-12 mb-3">
        <h3 id="Dataset" class="anchor"><span class="mr-2">Dataset</span><span class="badges">
          <span class="badge">Coming soon</span>
        </span></h3>
      </div>
      <div class="col-md-9 col-12" markdown="1">
The *Groove2Groove Dataset* is a parallel corpus of synthetic MIDI accompaniments in almost 3,000 different styles.
The accompaniments were created from chord charts using the commercial
[Band-in-a-Box](https://www.pgmusic.com){:target="_blank"}
accompaniment generation software as described in the paper.
Each chord chart is rendered in at least two different styles, providing pairs of examples for supervised training.

{% comment %}
A sample of the dataset is available [here]({{ "/data/groove2groove-data-v1.0-sample.tar.gz" | relative_url }});
if you use the dataset for your research, please <a href="#Paper">cite the paper</a>.
{% endcomment %}
The dataset will be released soon.

#### MIDI files
The `midi` directory contains one subdirectory for each part of the dataset:
- `train` contains 5744 MIDI files in 2872 styles (exactly 2 files per style). Each file contains
  252 measures (the Band-in-a-Box maximum) following a 2 measure count-in.
- `val` and `test` each contain 1200 files in 40 styles (exactly 30 files per style, 16 bars per
  file after the count-in). The sets of styles are disjoint from each other and from those in
  `train`.
- `itest` is generated from the same chord charts as `test`, but in 40 styles from the training set.

Each style is actually one of two substyles (meant for the A and B sections of a song) of a
Band-in-a-Box style. The two substyles are always in the same part of the dataset. More information
about the styles can be found in the file [`styles.tsv`]({{ "/data/styles.tsv" | relative_url}}).
The chord charts used to generate these MIDI files are described [below](#chord-charts).

Each set of MIDI files is provided in two versions, each in its own subdirectory:
- `raw` – the raw output of Band-in-a-Box.
- `fixed` – non-empty files only, fixed so that each track has the correct program number.
The filenames have the form `{chart_name}.{style}_{substyle}.mid`. The `charts_styles_substyles.tsv`
file lists the chord chart filenames along with the styles and substyles applied to each chord
chart.

#### Chord charts
The `charts/abc` and `charts/mgu` directories contain the corresponding chord charts in the ABC and
Band-in-a-Box (MGU) format, respectively. The MGU files are all in the default "ZZJAZZ" style. To
enable generation in the A and B substyles, we provide each MGU file in an A and B variant where the
entire chord chart is just one long A or B section, respectively.

The chord charts were generated using language models trained on the iRb corpus (see the paper
for further details). 5/6 of the chord charts are in major keys, the other 1/6 in minor keys
(approximately following the distribution of keys in iRb).
</div>
    </div>
  </div>
</main>
