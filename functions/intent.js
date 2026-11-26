import Stripe from "stripe";

const SHIPPING_EUR = 5;
const CALENDAR_ID = 33;
const FREE_SHIPPING_QTY = 8;

export async function onRequestPost({ request, env }) {
	const body = await request.json();
	const rawItems = Array.isArray(body?.items) ? body.items : [];

	const normalized = rawItems.map((it) => ({
			id: Number(it?.id),
			qty: Math.max(0, Math.min(10, parseInt(it?.qty, 10) || 0))
		}))
		.filter((it) => Number.isInteger(it.id) && it.id > 0 && it.qty > 0);

	if (normalized.length === 0) {
		return Response.json({ error: "Carrito vacío" }, { status: 400 });
	}

	const ids = [...new Set(normalized.map((it) => it.id))];
	const placeholders = ids.map(() => "?").join(", ");
	const { results } = await env.DB
		.prepare(`SELECT id, nombre, precio, existencias FROM stock WHERE id IN (${placeholders})`)
		.bind(...ids)
		.all();

	const stockMap = new Map(results.map((row) => [Number(row.id), row]));

	let itemsCents = 0;
	const reserved = [];
	const updatedCart = [];
	let stockChanged = false;

	for (const item of normalized) {
		const row = stockMap.get(item.id);
		const available = Math.max(0, Number(row?.existencias ?? 0));
		const qty = Math.min(item.qty, available);

		if (qty < item.qty) stockChanged = true;

		if (qty > 0) {
			const upd = await env.DB
				.prepare("UPDATE stock SET existencias = existencias - ? WHERE id = ? AND existencias >= ?")
				.bind(qty, item.id, qty)
				.run();

			if (upd.meta.changes > 0) {
				itemsCents += Math.round(Number(row.precio) * 100) * qty;
				reserved.push({ id: item.id, qty });
				updatedCart.push({ id: item.id, qty });
			} else {
				stockChanged = true;
			}
		}
	}

	if (reserved.length === 0) {
		return Response.json({ error: "Sin stock disponible", items: [] }, { status: 429 });
	}

	if (stockChanged) {
		for (const r of reserved) {
			await env.DB
				.prepare("UPDATE stock SET existencias = existencias + ? WHERE id = ?")
				.bind(r.qty, r.id)
				.run();
		}
		return Response.json(
			{ error: "El stock ha cambiado, revisa el carrito", items: updatedCart },
			{ status: 429 }
		);
	}

	const calendarQty = reserved
		.filter((r) => r.id === CALENDAR_ID)
		.reduce((acc, r) => acc + r.qty, 0);
	const shippingEur = calendarQty >= FREE_SHIPPING_QTY ? 0 : SHIPPING_EUR;
	const amountCents = itemsCents + shippingEur * 100;
	const stripe = new Stripe(env.STRIPE_API_KEY);

	try {
		const required = ["nombre", "apellidos", "direccion1", "postal", "poblacion", "provincia", "telefono", "correo"];
		if (required.some((k) => !String(body[k] ?? "").trim())) {
			return Response.json({ error: "Faltan datos obligatorios" }, { status: 400 });
		}

		const intent = await stripe.paymentIntents.create({
			amount: amountCents,
			currency: "eur",
			automatic_payment_methods: { enabled: true },
			receipt_email: body.correo.trim(),
			metadata: {
				tipo: "tienda",
				items: JSON.stringify(reserved),
				nombre: body.nombre.trim(),
				apellidos: body.apellidos.trim(),
				direccion1: body.direccion1.trim(),
				direccion2: String(body.direccion2 ?? "").trim(),
				postal: body.postal.trim(),
				poblacion: body.poblacion.trim(),
				provincia: body.provincia.trim(),
				region: String(body.region ?? "ES").trim(),
				telefono: body.telefono.trim(),
				notas: String(body.notas ?? "").trim()
			}
		});
		return Response.json({
			clientSecret: intent.client_secret,
			amount: amountCents
		});

	} catch (err) {
		for (const r of reserved) {
			await env.DB
				.prepare("UPDATE stock SET existencias = existencias + ? WHERE id = ?")
				.bind(r.qty, r.id)
				.run();
		}
		return Response.json({ error: "Error creando el intento de pago" }, { status: 500 });
	}
}
