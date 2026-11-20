#!/bin/sh

v=

while getopts "hv" opt; do
	case "$opt" in 
		h)
			printf "Compila todo el html de /pages y /template* a /output
Utiliza /template-index para pages/producto/*.cfg.
Utiliza /templates para el resto.

OPCIONES:
\t-h: Muestra este mensaje.
\t-v: Modo verboso.
"
			exit
			;;
		v)
			v="-v"
			;;
	esac
done

saait -t template-index -o output/producto pages/producto/*.cfg
mv $v output/producto/index.html pages
saait pages/*.cfg
