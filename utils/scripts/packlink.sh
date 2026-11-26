#!/bin/bash

g=false
i=
[ -z "$PACKLINK_API_KEY" ] && source .dev.vars ""

while getopts "hgi" opt; do
	case "$opt" in
		g)
			g=true
			;;
		h)
			printf 'Para interactuar con la API de packlink:
USO: packlink [opciones]

OPCIONES:
\t-g: devuelve todos los shipments
\t-h: muestra este mensaje.
\t-i: añade opción -i al curl
'
			exit
			;;
		I)
			I=-I
			;;

	esac
done

$g && curl $i -X GET "https://api.packlink.com/v1/shipments" -H "Authorization: $PACKLINK_API_KEY" -H "Content-Type: application/json" 
echo
