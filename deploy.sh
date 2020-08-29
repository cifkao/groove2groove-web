#!/bin/bash
set -ex

yarn run clean
yarn run build
rsync -avzH --delete _site/* _site/.htaccess groove2groove:www/
rsync -rvH --delete --existing --ignore-existing _site/ groove2groove:www/
