const SHIPPING_EUR = 5;

export async function onRequestPost({ request, env }) {
	const url = new URL(request.url).origin;

	let rawItems = [];
	const contentType = request.headers.get("content-type") || "";

	if (contentType.includes("application/json")) {
		const body = await request.json();
		rawItems = Array.isArray(body?.items) ? body.items : [];
	} else {
		const formData = await request.formData();
		const carritoJson = formData.get("carrito") || formData.get("items");
		if (carritoJson) {
			rawItems = JSON.parse(String(carritoJson));
		}
	}

	const normalized = rawItems
		.map((it) => ({
			id: Number(it?.id),
			qty: Math.max(0, Math.min(10, parseInt(it?.qty, 10) || 0))
		}))
		.filter((it) => Number.isInteger(it.id) && it.id > 0 && it.qty > 0);

	if (normalized.length === 0) {
		return Response.redirect(`${url}/carrito`, 303);
	}

	const ids = [...new Set(normalized.map((it) => it.id))];
	const placeholders = ids.map(() => "?").join(", ");
	const { results } = await env.DB
		.prepare(`SELECT id, nombre, precio, existencias FROM stock WHERE id IN (${placeholders})`)
		.bind(...ids)
		.all();

	const stockMap = new Map(results.map((row) => [Number(row.id), row]));

	const params = new URLSearchParams({
		mode: "payment",
		success_url: `${url}/finalizar-compra?success=true`,
		cancel_url: `${url}/finalizar-compra?success=false`,
		locale: "auto",
		"adaptive_pricing[enabled]": "true"
	});

	let lineIndex = 0;

	for (const item of normalized) {
		const row = stockMap.get(item.id);
		if (!row || row.existencias <= 0) continue;

		const qty = Math.min(item.qty, row.existencias);
		const unitAmountCents = Math.round(Number(row.precio) * 100);

		params.set(`line_items[${lineIndex}][quantity]`, String(qty));
		params.set(`line_items[${lineIndex}][price_data][currency]`, "eur");
		params.set(`line_items[${lineIndex}][price_data][unit_amount]`, String(unitAmountCents));
		params.set(`line_items[${lineIndex}][price_data][product_data][name]`, String(row.nombre));
		lineIndex++;
	}

	if (lineIndex === 0) {
		return Response.redirect(`${url}/carrito`, 303);
	}

	// Envío estándar de 5,00 €
	params.set(`line_items[${lineIndex}][quantity]`, "1");
	params.set(`line_items[${lineIndex}][price_data][currency]`, "eur");
	params.set(`line_items[${lineIndex}][price_data][unit_amount]`, String(SHIPPING_EUR * 100));
	params.set(`line_items[${lineIndex}][price_data][product_data][name]`, "Envío estándar");

	const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.STRIPE_API_KEY}`
		},
		body: params
	});

	const session = await res.json();
	console.log(session);
	
	return Response.json({ url: session.url });
}
