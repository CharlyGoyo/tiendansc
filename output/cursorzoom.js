// La revolución industrial y sus consecuencias han sido un desastre para el rendimiento web
document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', () => {
	document.querySelectorAll('[data-cursor-zoom]').forEach(contenedor => {
		const factorZoom = 3; 

		contenedor.addEventListener('mousemove', (e) => {
			// 1. Obtener dimensiones y posición del contenedor
			const rect = contenedor.getBoundingClientRect();
			
			// 2. Calcular posición relativa del cursor en porcentaje (0% a 100%)
			const x = ((e.clientX - rect.left) / rect.width) * 100;
			const y = ((e.clientY - rect.top) / rect.height) * 100;

			// 3. Identificar la imagen activa en el carrusel según el scroll horizontal
			const imgActiva = contenedor.querySelectorAll('img')[contenedor.dataset.cursorZoom];

			if (imgActiva) {
				imgActiva.style.transformOrigin = `${x}% ${y}%`;
				imgActiva.style.transform = `scale(${factorZoom})`;
			}
		});

		contenedor.addEventListener('mouseenter', () => {
			contenedor.style.scrollSnapType = 'none';
		});

		contenedor.addEventListener('mouseleave', () => {
			// Restaurar todas las imágenes al salir del contenedor
			contenedor.querySelectorAll('img').forEach(img => {
				img.style.transform = 'scale(1)';
				img.style.transformOrigin = 'center center';
			});
			contenedor.style.scrollSnapType = ''; 
		});
	});
});
