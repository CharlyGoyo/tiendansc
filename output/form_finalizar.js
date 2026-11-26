(() => {
	"use strict";

	const STORAGE_KEY = "carrito";

	const params = new URLSearchParams(window.location.search);

	const stripe = Stripe("pk_test_51UEw8wCNOpaMFlfCDyRbkzqTLjgg93t5GI14zJokS57xxdRfAOoLvlGzX6afI1k7NMtMmsAWISQEqGs9nVcNzQp900m3hw8J6Y");
	const elements = stripe.elements({
		mode: "payment",
		amount: 100,
		currency: "eur"
	});

	const paymentElement = elements.create("payment", {
		layout: {
			type: "accordion",
			defaultCollapsed: true,
			radios: "always",
			spacedAccordionItems: false
		},
		business: {
			name: "NSC-E"
		}
	});

	const getCartItems = () => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed.filter((it) => (parseInt(it.qty, 10) || 0) > 0) : [];
		} catch (_) {
			return [];
		}
	};

	const statusEl = document.querySelector("[data-stripe-status]");

	const setStatus = (msg, type) => {
		if (!msg) {
			statusEl.textContent = "";
			statusEl.hidden = true;
			return;
		}
		statusEl.textContent = msg;
		statusEl.style.color = type === "ok" ? "green" : "red";
		statusEl.hidden = false;
	};

	const init = () => {
		setStatus("");
		paymentElement.mount("#payment-element");

		const form = document.querySelector("#form1");
		const submitBtn = document.querySelector("#button1");
		if (!form || !submitBtn) return;

		const termsCheckbox = document.querySelector('input[name="terminos"]');

		const validateFields = () => {
			let valid = form.checkValidity();
			console.log(valid);
			if (termsCheckbox && !termsCheckbox.checked) valid = false;
			console.log(valid);
			if (getCartItems().length === 0) valid = false;
			console.log(valid);
			submitBtn.disabled = !valid;
			setStatus("");
		};

		form.addEventListener("input", validateFields);
		form.addEventListener("change", validateFields);
		termsCheckbox.addEventListener("change", validateFields);
		window.addEventListener("storage", (e) => {
			if (e.key === STORAGE_KEY) validateFields();
		});

		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			validateFields();
			if (submitBtn.disabled) {
				form.reportValidity();
				return;
			}

			submitBtn.disabled = true;

			const { error: submitError } = await elements.submit();
			if (submitError) {
				console.error("[elements.submit]", submitError);
				validateFields();
				return;
			}

			const payload = {
				...Object.fromEntries(new FormData(form).entries()),
				items: getCartItems()
			};

			try {
				const res = await fetch(form.getAttribute("action") || "/intent", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload)
				});

				const data = await res.json();
				if (!res.ok || !data?.clientSecret) {
					throw new Error(data?.error || `HTTP ${res.status}`);
				}

				if (typeof data.amount === "number") {
					await elements.update({ amount: data.amount });
				}

				const { error: confirmError } = await stripe.confirmPayment({
					elements,
					clientSecret: data.clientSecret,
					confirmParams: {
						return_url: `${window.location.origin}/finalizar-compra?success=true`
					}
				});

				if (confirmError) {
					console.error("[confirmPayment]", confirmError);
					setStatus(confirmError.message || "Error al procesar el pago", "error");
					validateFields();
				}
			} catch (err) {
				console.error("[checkout]", err);
				setStatus(err.message || "Error al procesar el pago", "error");
				validateFields();
			}
		});

		validateFields();
		if (params.get("redirect_status") === "succeeded" && params.get("success") === "true") {
			form.reset();
			if (termsCheckbox) termsCheckbox.checked = false;
			paymentElement.unmount();
			paymentElement.mount("#payment-element");
			localStorage.removeItem(STORAGE_KEY);
			validateFields();
			setStatus("Pago completado correctamente. Revise la bandeja de entrada de su correo electrónico.", "ok");
		}
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
