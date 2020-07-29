#!/bin/bash
set -ex

yarn run clean
yarn run build
rsync -avzH --delete --exclude .htaccess _site/* groove2groove:www/
rsync -rvH --delete --existing --ignore-existing --exclude .htaccess _site/ groove2groove:www/
