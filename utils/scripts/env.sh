while getopts "h" opt; do
	case "$opt" in 
		h)
			printf "Exporta algunas variables de entorno útiles:

- HTML_EDITABLES: Archivos .html que no se sobreescriben durante la compilación. Los que se pueden editar.
"
			exit
			;;
	esac
done

shopt -s extglob
export HTML_EDITABLES='pages/!(index).html pages/producto/*.html templates/page/*.html template-index/index.html/*.html utils/html/*.html'
