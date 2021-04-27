#!/bin/bash
set -ex

yarn run clean
yarn run build
rsync -avzH --exclude=/data/checkpoints/ --delete _site/* _site/.htaccess groove2groove:www/
rsync -rvH --exclude=/data/checkpoints/ --delete --existing --ignore-existing _site/ groove2groove:www/
