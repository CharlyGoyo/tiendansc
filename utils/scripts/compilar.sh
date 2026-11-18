#!/bin/sh

b=false
B=false
n=5
v=
i=

while getopts "bBhin:v" opt; do
	case "$opt" in 
		h)
			printf "Compila todo el html de /pages y /templates a /output

OPCIONES:
\t-h: Muestra este mensaje
\t-v: Modo verboso
"
			exit
			;;
		b)
			b=true
			;;
		B)
			B=true
			;;
		i)
			i="-i"
			;;
		n)
			n=$OPTARG
			;;
		v)
			v="-v"
			;;
	esac
done

# compila los artículos:
$b || saait -o output/articulos pages/articulos/*.cfg 
# compila el resto:
$b || saait pages/*.cfg
# compila los distintos idiomas:
$b || saait -o output/pt pages/pt/*.cfg
$b || saait -o output/en pages/en/*.cfg
$b || saait -o output/fr pages/fr/*.cfg
