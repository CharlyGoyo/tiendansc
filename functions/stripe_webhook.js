import Stripe from "stripe";
import { EmailMessage } from "cloudflare:email";

const CSV_HEADERS ="Referencia;Nombre del Remitente;Apellido del Remitente;Empresa Remitente;Direccion del Remitente 1;Direccion del Remitente 2;Codigo Postal Origen;Ciudad Origen;Estado Origen;Pais Origen;Telefono del Remitente;Email del Remitente;Nombre del Destinatario;Apellido del Destinatario;Empresa Destinataria;Direccion Envio 1;Direccion Envio 2;Codigo Postal Destino;Ciudad Destino;Estado Destino;Pais Destino;Telefono Destinatario;Email Destinatario;Seguro;Articulo;Valor;Ancho;Largo;Alto;Peso";

export async function onRequestPost({ request, env }) {
	const stripe = new Stripe(env.STRIPE_API_KEY);
	const rawBody = await request.text();
	const sigHeader = request.headers.get("stripe-signature");

	const event = await stripe.webhooks.constructEventAsync(
		rawBody,
		sigHeader,
		env.STRIPE_WEBHOOK_SECRET,
		undefined,
		Stripe.createSubtleCryptoProvider()
	);

	if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
		const reserved = JSON.parse(event.data.object.metadata?.items || "[]");
		for (const r of reserved) {
			await env.DB
				.prepare("UPDATE stock SET existencias = existencias + ? WHERE id = ?")
				.bind(r.qty, r.id)
				.run();
		}
		return Response.json({ received: true });
	}

	if (event.type !== "payment_intent.succeeded") {
		return Response.json({ received: true });
	}

	const meta = event.data.object.metadata || {};
	const reserved = JSON.parse(meta.items || "[]");
	const amountEur = ((event.data.object.amount ?? 0) / 100).toFixed(2);
	const ref = event.data.object.id;

	const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
	const csvRow = [
		ref,
		env.PACKLINK_SENDER_NAME || "",
		env.PACKLINK_SENDER_SURNAME || "",
		env.PACKLINK_SENDER_COMPANY || "",
		env.PACKLINK_SENDER_STREET1 || "",
		env.PACKLINK_SENDER_STREET2 || "",
		env.PACKLINK_SENDER_POSTAL || "",
		env.PACKLINK_SENDER_CITY || "",
		env.PACKLINK_SENDER_PROVINCE || "",
		env.PACKLINK_SENDER_COUNTRY || "ES",
		env.PACKLINK_SENDER_PHONE || "",
		env.PACKLINK_SENDER_EMAIL || "",
		meta.nombre || "",
		meta.apellidos || "",
		meta.empresa || "",
		meta.direccion1 || "",
		meta.direccion2 || "",
		meta.postal || "",
		meta.poblacion || "",
		meta.provincia || "",
		meta.region || "ES",
		meta.telefono || "",
		event.data.object.receipt_email || meta.email || "",
		"",
		JSON.stringify(reserved),
		amountEur,
		"",
		"",
		"",
		""
	].map(esc).join(";");

	const csvBase64 = btoa(unescape(encodeURIComponent(`\uFEFF${CSV_HEADERS}\n${csvRow}\n`)));
	const boundary = "----=_Part_NSC_E";
	const msgId = `<${ref}.${Date.now()}@nsc-e.local>`;
	const rawMime = [
		`From: <pedidos@imprentanacher.es>`,
		`To: <carlosnacherabeledo@proton.me>`,
		`Subject: Nuevo pedido - ${ref}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: ${msgId}`,
		`MIME-Version: 1.0`,
		`Content-Type: multipart/mixed; boundary="${boundary}"`,
		``,
		`--${boundary}`,
		`Content-Type: text/plain; charset="utf-8"`,
		``,
		`Adjunto CSV del pedido (${ref}).`,
		``,
		`--${boundary}`,
		`Content-Type: text/csv; charset="utf-8"; name="pedido.csv"`,
		`Content-Disposition: attachment; filename="pedido.csv"`,
		`Content-Transfer-Encoding: base64`,
		``,
		csvBase64,
		`--${boundary}--`
	].join("\r\n");

	await env.EMAIL.send(
		new EmailMessage(
			"carlosnacherabeledo@imprentanacher.es",
			"carlosnacherabeledo@proton.me",
			rawMime
		)
	);

	return Response.json({ received: true });
}
