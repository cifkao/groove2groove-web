#!/bin/sh
rsync -avzH --delete --exclude .htaccess _site/ groove2groove:www/
