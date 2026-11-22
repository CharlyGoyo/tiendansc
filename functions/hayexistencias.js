const MAX_PER_ITEM = 10;

// Normaliza nombres igual que carrito.js: æ/Æ -> ae/Ae, sin comas y sin espacios duplicados
const normalizeName = (raw) =>
	String(raw || "")
		.replace(/æ/g, "ae")
		.replace(/Æ/g, "Ae")
		.replace(/,/g, "")
		.replace(/\s+/g, " ")
		.trim();

const jsonResponse = (data, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store"
		}
	});

// Fuente de existencias:
// - Si vinculas un KV namespace (ej. `existencias` en wrangler.toml / Pages settings),
//   puede leer claves como "Camiseta Ave Crux Spes Unica XL" -> "true"/"false" o un número de stock.
// - Si no usas KV aún, cae al mapa por defecto `DEFAULT_STOCK`.
const DEFAULT_STOCK = {
	"Camiseta Ave Crux Spes Unica XS": true,
	"Camiseta Ave Crux Spes Unica S": true,
	"Camiseta Ave Crux Spes Unica M": true,
	"Camiseta Ave Crux Spes Unica L": true,
	"Camiseta Ave Crux Spes Unica XL": true,
	"Camiseta Ave Crux Spes Unica 2XL": false,
	"Camiseta Ave Crux Spes Unica 3XL": false,
	"Camiseta Introibo ad altare Dei": true,
	"Camiseta Laetare Mater Hispania tua est XL": true,
	"Camiseta Por la fe conquistaron reinos": true,
	"Chaqueta polar NSC-E": true,
	"Taza metalica": true
};

const checkSingleItem = async (name, env) => {
	const clean = normalizeName(name);
	if (!clean) return false;

	if (env && env.existencias && typeof env.existencias.get === "function") {
		const rawVal = await env.existencias.get(clean);
		if (rawVal !== null && rawVal !== undefined) {
			const trimmed = String(rawVal).trim().toLowerCase();
			if (trimmed === "true") return true;
			if (trimmed === "false") return false;
			const qty = parseInt(trimmed, 10);
			if (Number.isFinite(qty)) return qty > 0 && qty <= MAX_PER_ITEM;
		}
	}

	if (Object.prototype.hasOwnProperty.call(DEFAULT_STOCK, clean)) {
		return Boolean(DEFAULT_STOCK[clean]);
	}

	// Por defecto si no está en el mapa, true o false según prefieras
	return true;
};

export async function onRequestPost(context) {
	const { request, env } = context;

	let body = {};
	try {
		body = await request.json();
	} catch (_) {
		return jsonResponse({ error: "JSON inválido" }, 400);
	}

	const producto = normalizeName(body && body.producto);
	const variantes = Array.isArray(body && body.variantes)
		? body.variantes.map(normalizeName).filter(Boolean)
		: [];

	if (!producto && variantes.length === 0) {
		return jsonResponse({ error: "Falta producto" }, 400);
	}

	// Producto sin tallas -> devuelve boolean (true / false)
	if (variantes.length === 0) {
		const available = await checkSingleItem(producto, env);
		return jsonResponse(available, 200);
	}

	// Producto con tallas -> devuelve { "Nombre Talla": true/false }
	const result = {};
	for (const variantName of variantes) {
		result[variantName] = await checkSingleItem(variantName, env);
	}

	return jsonResponse(result, 200);
}

export async function onRequestOptions() {
	return new Response(null, {
		status: 204,
		headers: {
			Allow: "POST, OPTIONS"
		}
	});
}
