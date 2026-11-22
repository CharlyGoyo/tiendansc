(() => {
	"use strict";

	const STORAGE_KEY = "nsc_carrito_v1";
	const MAX_QTY = 10;
	const MAX_HISTORY = 10;
	const STOCK_ENDPOINT = "/hayexistencias";

	// Normaliza nombres: respeta el texto de index.html y reemplaza æ/Æ por ae/Ae
	const normalizeProductName = (rawName) =>
		String(rawName || "")
			.replace(/æ/g, "ae")
			.replace(/,/g, "")
			.replace(/\s+/g, " ")
			.trim();

	const buildVariantId = (baseName, talla) => {
		const cleanBase = normalizeProductName(baseName);
		const cleanTalla = String(talla || "").trim();
		return cleanTalla ? `${cleanBase} ${cleanTalla}` : cleanBase;
	};

	const formatEur = (amount) => {
		const num = Number.isFinite(amount) ? amount : 0;
		return `${num.toFixed(2).replace(".", ",")} €`;
	};

	const parsePrice = (val) => {
		const normalized = String(val ?? "0").replace(",", ".").trim();
		const num = parseFloat(normalized);
		return Number.isFinite(num) && num >= 0 ? num : 0;
	};

	// Lectura/escritura segura de localStorage
	const loadCart = () => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed
				.map((item) => ({
					id: String(item.id || ""),
					name: normalizeProductName(item.name || item.id || ""),
					baseName: normalizeProductName(item.baseName || ""),
					talla: String(item.talla || "").trim(),
					price: parsePrice(item.price),
					qty: Math.max(0, Math.min(MAX_QTY, parseInt(item.qty, 10) || 0)),
					image: String(item.image || ""),
					url: String(item.url || "")
				}))
				.filter((item) => item.id && item.qty > 0);
		} catch (_) {
			return [];
		}
	};

	const saveCart = (items) => {
		const sanitized = items
			.map((item) => ({
				id: String(item.id),
				name: normalizeProductName(item.name),
				baseName: normalizeProductName(item.baseName || ""),
				talla: String(item.talla || ""),
				price: parsePrice(item.price),
				qty: Math.max(0, Math.min(MAX_QTY, parseInt(item.qty, 10) || 0)),
				image: String(item.image || ""),
				url: String(item.url || "")
			}))
			.filter((item) => item.id && item.qty > 0);

		localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
		updateNavbarTotal(sanitized);
		return sanitized;
	};

	const getCartTotal = (items = loadCart()) =>
		items.reduce((acc, item) => acc + item.price * item.qty, 0);

	// Actualiza el importe total en el navbar a la derecha del icono del carrito
	const updateNavbarTotal = (items = loadCart()) => {
		const cartLink = document.querySelector('nav a[href="/carrito"], nav a[href="/carrito.html"]');
		if (!cartLink) return;

		let badge = cartLink.querySelector("[data-carrito-navbar-total]");
		if (!badge) {
			badge = document.createElement("span");
			badge.setAttribute("data-carrito-navbar-total", "1");
			badge.style.marginLeft = "6px";
			badge.style.fontWeight = "500";
			cartLink.appendChild(badge);
		}
		badge.textContent = formatEur(getCartTotal(items));
	};

	// --- PÁGINA DE PRODUCTO ---
	const initProductPage = () => {
		const form = document.querySelector("form[data-carrito-producto]");
		if (!form) return;

		const baseName = normalizeProductName(form.getAttribute("data-carrito-producto"));
		const price = parsePrice(form.getAttribute("data-carrito-precio"));
		const productUrl = form.getAttribute("data-carrito-url") || window.location.pathname;

		const firstImg = document.querySelector(
			"[data-carrusel-wrapper] img, .div3 img, .div2 img"
		);
		const productImage = firstImg ? firstImg.getAttribute("src") || "" : "";

		const sizeSelect = form.querySelector('select[name="talla"]');
		const qtyInput = form.querySelector('input[name="cantidad"]');
		const submitBtn = form.querySelector('input[type="submit"], button[type="submit"]');

		if (qtyInput) {
			qtyInput.setAttribute("max", String(MAX_QTY));
			qtyInput.setAttribute("min", "1");
		}

		// Mensaje de existencias justo debajo del selector de tallas
		let stockMsg = null;
		if (sizeSelect) {
			stockMsg = document.createElement("p");
			stockMsg.setAttribute("data-carrito-stock-msg", "1");
			stockMsg.style.marginTop = "6px";
			stockMsg.style.fontSize = "0.9rem";
			stockMsg.style.fontWeight = "500";
			sizeSelect.insertAdjacentElement("afterend", stockMsg);
		}

		let stockData = null; // true/false o mapa { [nombreProducto]: boolean }
		let stockLoaded = false;

		const getSelectedVariantName = () => {
			if (!sizeSelect) return baseName;
			const talla = String(sizeSelect.value || "").trim();
			return talla ? buildVariantId(baseName, talla) : "";
		};

		const isVariantAvailable = () => {
			if (!stockLoaded) return false;
			if (!sizeSelect) {
				if (typeof stockData === "boolean") return stockData;
				if (stockData && typeof stockData === "object") {
					return Boolean(stockData[baseName]);
				}
				return false;
			}
			const talla = String(sizeSelect.value || "").trim();
			if (!talla) return false;
			const fullName = buildVariantId(baseName, talla);
			if (typeof stockData === "boolean") return stockData;
			if (stockData && typeof stockData === "object") {
				if (Object.prototype.hasOwnProperty.call(stockData, fullName)) {
					return Boolean(stockData[fullName]);
				}
				if (Object.prototype.hasOwnProperty.call(stockData, talla)) {
					return Boolean(stockData[talla]);
				}
			}
			return false;
		};

		const refreshStockUI = () => {
			if (!sizeSelect) {
				const ok = isVariantAvailable();
				if (submitBtn) submitBtn.disabled = !ok;
				return;
			}

			const talla = String(sizeSelect.value || "").trim();
			if (!talla || !stockLoaded) {
				if (stockMsg) {
					stockMsg.textContent = "";
					stockMsg.style.color = "";
				}
				if (submitBtn) submitBtn.disabled = true;
				return;
			}

			const available = isVariantAvailable();
			if (stockMsg) {
				if (available) {
					stockMsg.textContent = "hay existencias";
					stockMsg.style.color = "green";
				} else {
					stockMsg.textContent = "no hay existencias";
					stockMsg.style.color = "red";
				}
			}
			if (submitBtn) {
				submitBtn.disabled = !available;
			}
		};

		// POST a /hayexistencias al cargar la página de producto
		const sizesList = sizeSelect
			? Array.from(sizeSelect.options)
					.map((opt) => String(opt.value || "").trim())
					.filter(Boolean)
					.map((talla) => buildVariantId(baseName, talla))
			: [];

		fetch(STOCK_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				producto: baseName,
				variantes: sizesList
			})
		})
			.then((res) => res.json())
			.then((data) => {
				stockData = data;
				stockLoaded = true;
				refreshStockUI();
			})
			.catch(() => {
				stockData = false;
				stockLoaded = true;
				refreshStockUI();
			});

		if (sizeSelect) {
			sizeSelect.addEventListener("change", refreshStockUI);
		}

		if (qtyInput) {
			qtyInput.addEventListener("input", () => {
				let val = parseInt(qtyInput.value, 10);
				if (!Number.isFinite(val) || val < 1) val = 1;
				if (val > MAX_QTY) val = MAX_QTY;
				qtyInput.value = String(val);
			});
		}

		form.addEventListener("submit", (e) => {
			e.preventDefault();
			if (!isVariantAvailable()) {
				refreshStockUI();
				return;
			}

			const talla = sizeSelect ? String(sizeSelect.value || "").trim() : "";
			if (sizeSelect && !talla) return;

			const variantName = getSelectedVariantName();
			let addQty = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;
			if (addQty < 1) addQty = 1;
			if (addQty > MAX_QTY) addQty = MAX_QTY;

			const items = loadCart();
			const existing = items.find((it) => it.id === variantName);

			if (existing) {
				existing.qty = Math.min(MAX_QTY, existing.qty + addQty);
				existing.price = price;
				if (productImage) existing.image = productImage;
				if (productUrl) existing.url = productUrl;
			} else {
				items.push({
					id: variantName,
					name: variantName,
					baseName,
					talla,
					price,
					qty: addQty,
					image: productImage,
					url: productUrl
				});
			}

			saveCart(items);
		});

		refreshStockUI();
	};

	// --- PÁGINA DE CARRITO (/carrito o carrito.html) ---
	const initCartPage = () => {
		const path = window.location.pathname.replace(/\/+$/, "");
		const isCartPath = path === "/carrito" || path.endsWith("/carrito.html");
		const table = document.querySelector("main table");
		if (!isCartPath && !table) return;
		if (!table) return;

		const tbody = table.querySelector("tbody") || table;
		const templateRow =
			tbody.querySelector("tr:not(thead tr):not(tfoot tr)") ||
			table.querySelector("tr:not(thead tr):not(tfoot tr)");
		if (!templateRow) return;

		const rowTemplateClone = templateRow.cloneNode(true);
		// Elimina filas de plantilla iniciales del tbody
		Array.from(tbody.querySelectorAll("tr")).forEach((tr) => tr.remove());

		const tfoot = table.querySelector("tfoot");
		const buttons = tfoot ? Array.from(tfoot.querySelectorAll("button")) : [];
		const undoBtn = buttons.find((b) => /deshacer/i.test(b.textContent || "")) || buttons[0] || null;
		const redoBtn = buttons.find((b) => /rehacer/i.test(b.textContent || "")) || buttons[1] || null;

		const totalHeading = document.querySelector("main h4");
		const totalSection = totalHeading ? totalHeading.closest("section") : null;
		let totalAmountEl = totalSection
			? totalSection.querySelector("[data-carrito-subtotal-display]")
			: null;
		if (totalHeading && !totalAmountEl) {
			totalAmountEl = document.createElement("span");
			totalAmountEl.setAttribute("data-carrito-subtotal-display", "1");
			totalAmountEl.style.marginLeft = "8px";
			totalHeading.appendChild(totalAmountEl);
		}

		// Historial en memoria (solo mientras dure esta visita en /carrito)
		const history = [loadCart()];
		let historyIndex = 0;

		const syncHistoryButtons = () => {
			if (undoBtn) undoBtn.disabled = historyIndex <= 0;
			if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
		};

		const commitState = (nextItems, recordHistory = true) => {
			const saved = saveCart(nextItems);
			if (recordHistory) {
				// Corta ramas futuras si se había deshecho antes
				history.splice(historyIndex + 1);
				history.push(saved.map((it) => ({ ...it })));
				if (history.length > MAX_HISTORY) {
					history.shift();
				} else {
					historyIndex++;
				}
			}
			renderTable(saved);
			syncHistoryButtons();
		};

		const updateTotalsDisplay = (items) => {
			if (totalAmountEl) {
				totalAmountEl.textContent = formatEur(getCartTotal(items));
			}
		};

		const renderTable = (items) => {
			Array.from(tbody.querySelectorAll("tr")).forEach((tr) => tr.remove());

			items.forEach((item) => {
				const tr = rowTemplateClone.cloneNode(true);
				const tds = tr.querySelectorAll("td");

				const removeBtn = tr.querySelector("button");
				const imgEl = tr.querySelector("img");
				const linkEl = tr.querySelector("a");
				const qtyInput = tr.querySelector('input[type="number"]');
				const pEls = Array.from(tr.querySelectorAll("p"));

				// Identifica celdas de precio y subtotal por orden o data-label
				const priceTd =
					tr.querySelector('td[data-label*="Precio"]') || tds[3] || null;
				const subtotalTd =
					tr.querySelector('td[data-label*="Subtotal"]') || tds[5] || null;

				const priceP = priceTd ? priceTd.querySelector("p") || priceTd : pEls[1];
				const subtotalP = subtotalTd
					? subtotalTd.querySelector("p") || subtotalTd
					: pEls[2];

				if (imgEl) {
					imgEl.src = item.image || "";
					imgEl.alt = item.name;
				}

				if (linkEl) {
					linkEl.textContent = item.name;
					if (item.url) linkEl.href = item.url;
				} else if (pEls[0]) {
					pEls[0].textContent = item.name;
				}

				if (priceP) {
					priceP.textContent = formatEur(item.price);
				}

				if (qtyInput) {
					qtyInput.min = "0";
					qtyInput.max = String(MAX_QTY);
					qtyInput.value = String(item.qty);

					qtyInput.addEventListener("change", () => {
						let newQty = parseInt(qtyInput.value, 10);
						if (!Number.isFinite(newQty) || newQty < 0) newQty = 0;
						if (newQty > MAX_QTY) newQty = MAX_QTY;

						const current = loadCart();
						const updated = current
							.map((it) => (it.id === item.id ? { ...it, qty: newQty } : it))
							.filter((it) => it.qty > 0);
						commitState(updated, true);
					});
				}

				if (subtotalP) {
					subtotalP.textContent = formatEur(item.price * item.qty);
				}

				if (removeBtn) {
					removeBtn.addEventListener("click", () => {
						const current = loadCart();
						const updated = current.filter((it) => it.id !== item.id);
						commitState(updated, true);
					});
				}

				tbody.appendChild(tr);
			});

			updateTotalsDisplay(items);
		};

		if (undoBtn) {
			undoBtn.addEventListener("click", () => {
				if (historyIndex <= 0) return;
				historyIndex--;
				const snapshot = history[historyIndex].map((it) => ({ ...it }));
				commitState(snapshot, false);
			});
		}

		if (redoBtn) {
			redoBtn.addEventListener("click", () => {
				if (historyIndex >= history.length - 1) return;
				historyIndex++;
				const snapshot = history[historyIndex].map((it) => ({ ...it }));
				commitState(snapshot, false);
			});
		}

		renderTable(loadCart());
		syncHistoryButtons();
	};

	const init = () => {
		updateNavbarTotal();
		initProductPage();
		initCartPage();
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
