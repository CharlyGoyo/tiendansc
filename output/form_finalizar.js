(() => {
	"use strict";

	const STORAGE_KEY = "nsc_carrito_v1";

	const getCartItems = () => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed.filter((it) => (parseInt(it.qty, 10) || 0) > 0);
		} catch (_) {
			return [];
		}
	};

	const hasCartItems = () => getCartItems().length > 0;

	const init = () => {
		const form = document.querySelector("#form1");
		const submitBtn = document.querySelector("#button1");
		if (!form || !submitBtn) return;

		const termsCheckbox = document.querySelector('input[name="terminos"]');

		const validateFields = () => {
			let valid = form.checkValidity();

			if (termsCheckbox && !termsCheckbox.checked) {
				valid = false;
			}

			if (!hasCartItems()) {
				valid = false;
			}

			submitBtn.disabled = !valid;
		};

		form.addEventListener("input", validateFields);
		form.addEventListener("change", validateFields);

		if (termsCheckbox) {
			termsCheckbox.addEventListener("change", validateFields);
		}

		window.addEventListener("storage", (e) => {
			if (e.key === STORAGE_KEY) {
				validateFields();
			}
		});

		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			validateFields();
			if (submitBtn.disabled) {
				form.reportValidity();
				return;
			}

			submitBtn.disabled = true;

			const fields = Object.fromEntries(new FormData(form).entries());
			const payload = {
				...fields,
				items: getCartItems()
			};

			try {
				const res = await fetch(form.getAttribute("action") || "/checkout", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload)
				});

				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}

				const data = await res.json();
				if (data && data.url) {
					window.location.href = data.url;
					return;
				}
				throw new Error("Respuesta sin URL de Stripe");
			} catch (err) {
				console.error("[checkout]", err);
				validateFields();
			}
		});

		validateFields();
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
