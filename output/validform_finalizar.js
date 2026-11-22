(() => {
	"use strict";

	const STORAGE_KEY = "nsc_carrito_v1";

	const hasCartItems = () => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return false;
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) && parsed.some((it) => (parseInt(it.qty, 10) || 0) > 0);
		} catch (_) {
			return false;
		}
	};

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

		form.addEventListener("submit", (e) => {
			validateFields();
			if (submitBtn.disabled) {
				e.preventDefault();
				form.reportValidity();
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
