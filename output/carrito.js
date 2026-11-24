(() => {
	"use strict";

	const STORAGE_KEY = "nsc_carrito_v1";
	const MAX_QTY = 10;
	const MAX_HISTORY = 10;
	const SHIPPING_EUR = 5;
	const STOCK_ENDPOINT = "/stock";
	const MOBILE_NAV_QUERY = "(max-width: 499.98px)";
	const VAT_RATE = 0.21;

	let stockCatalog = null; // Array de objetos de /stock o null si aún no cargado / rate limited
	let stockUnavailableFallback = false; // true si falló la petición (distinto de 429)
	const stockListeners = new Set();

	const notifyStockListeners = () => {
		stockListeners.forEach((fn) => fn());
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

	const clampQty = (val) => {
		const n = parseInt(val, 10);
		if (!Number.isFinite(n) || n < 0) return 0;
		return Math.min(MAX_QTY, n);
	};

	// Estructura alineada con /stock: { id, nombre, precio, url, imagen, existencias, qty }
	const normalizeCartItem = (item) => {
		if (!item || item.id === undefined || item.id === null || item.id === "") return null;
		const qty = clampQty(item.qty);
		if (qty <= 0) return null;
		return {
			id: Number.isFinite(Number(item.id)) && String(item.id).trim() !== "" ? Number(item.id) : String(item.id),
			nombre: String(item.nombre || ""),
			precio: parsePrice(item.precio),
			url: String(item.url || ""),
			imagen: String(item.imagen || ""),
			existencias: Number(item.existencias),
			qty
		};
	};

	const loadCart = () => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed.map(normalizeCartItem).filter(Boolean);
		} catch (_) {
			return [];
		}
	};

	const saveCart = (items) => {
		const sanitized = items.map(normalizeCartItem).filter(Boolean);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
		updateNavbarTotal(sanitized);
		return sanitized;
	};

	const getCartTotal = (items = loadCart()) =>
		items.reduce((acc, item) => acc + item.precio * item.qty, 0);

	const updateNavbarTotal = (items = loadCart()) => {
		const cartLink = document.querySelector('nav a[href="/carrito"], nav a[href="/carrito.html"]');
		if (!cartLink) return;

		const isSmallScreen = window.matchMedia(MOBILE_NAV_QUERY).matches;
		let badge = cartLink.querySelector("[data-carrito-navbar-total]");

		if (isSmallScreen) {
			if (badge) badge.remove();
			return;
		}

		if (!badge) {
			badge = document.createElement("span");
			badge.setAttribute("data-carrito-navbar-total", "1");
			badge.style.marginLeft = "6px";
			badge.style.fontWeight = "500";
			cartLink.appendChild(badge);
		}
		badge.textContent = formatEur(getCartTotal(items));
	};

	const findStockItem = (id) => {
		if (!Array.isArray(stockCatalog) || id === null || id === undefined || id === "") {
			return null;
		}
		return stockCatalog.find((row) => String(row.id) === String(id)) || null;
	};

	const hasStockForId = (id) => {
		if (stockUnavailableFallback) return false;
		const row = findStockItem(id);
		return Boolean(row && row.hay_existencias);
	};

	// Elimina del carrito cualquier ítem sin existencias y sincroniza datos de /stock
	const reconcileCartWithStock = () => {
		if (!Array.isArray(stockCatalog) && !stockUnavailableFallback) return false;

		const current = loadCart();
		let changed = false;

		const next = current.reduce((acc, item) => {
			if (stockUnavailableFallback) {
				changed = true;
				return acc;
			}
			const row = findStockItem(item.id);
			if (!row || !row.hay_existencias) {
				changed = true;
				return acc;
			}
			const synced = {
				...item,
				nombre: row.nombre ?? item.nombre,
				precio: parsePrice(row.precio ?? item.precio),
				url: row.url ?? item.url,
				imagen: row.imagen ?? item.imagen,
				hay_existencias: Boolean(row.hay_existencias)
			};
			if (
				synced.nombre !== item.nombre ||
				synced.precio !== item.precio ||
				synced.url !== item.url ||
				synced.imagen !== item.imagen ||
				synced.hay_existencias !== item.hay_existencias
			) {
				changed = true;
			}
			acc.push(synced);
			return acc;
		}, []);

		if (changed) {
			saveCart(next);
		}
		return changed;
	};

	const fetchStock = () => {
		fetch(STOCK_ENDPOINT, { method: "GET", cache: "no-store" })
			.then((res) => {
				if (res.status === 429) {
					return null; // Rate limit: se ignora y se reintentará en otra navegación
				}
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}
				return res.json();
			})
			.then((data) => {
				if (data === null) return;
				stockCatalog = Array.isArray(data) ? data : [];
				stockUnavailableFallback = false;
				reconcileCartWithStock();
				notifyStockListeners();
			})
			.catch(() => {
				stockCatalog = null;
				stockUnavailableFallback = true;
				reconcileCartWithStock();
				notifyStockListeners();
			});
	};

	// --- PÁGINA DE PRODUCTO ---
	const initProductPage = () => {
		const form = document.getElementById("form2") || document.querySelector("form[data-producto], form form, main form");
		if (!form) return;

		const sizeSelect = form.querySelector('select[name="talla"]');
		const qtyInput = form.querySelector('input[name="cantidad"]');
		const submitBtn = form.querySelector('input[type="submit"], button[type="submit"]');

		if (qtyInput) {
			qtyInput.setAttribute("max", String(MAX_QTY));
			qtyInput.setAttribute("min", "1");
		}

		let stockMsg = null;
		if (sizeSelect) {
			stockMsg = document.createElement("p");
			stockMsg.setAttribute("data-carrito-stock-msg", "1");
			stockMsg.style.marginTop = "6px";
			stockMsg.style.fontSize = "0.9rem";
			stockMsg.style.fontWeight = "500";
			sizeSelect.insertAdjacentElement("afterend", stockMsg);
		}

		const getSelectedProductId = () => {
			if (sizeSelect) {
				const opt = sizeSelect.options[sizeSelect.selectedIndex];
				return opt ? String(opt.getAttribute("data-producto") || "").trim() : "";
			}
			return String(form.getAttribute("data-producto") || "").trim();
		};

		const getDisplayName = (stockRow) => {
			if (stockRow && stockRow.nombre) return String(stockRow.nombre);
			const heading = form.querySelector("h1, h2, h3, h4");
			const baseText = heading ? heading.textContent.trim() : "";
			const talla = sizeSelect ? String(sizeSelect.value || "").trim() : "";
			return talla ? `${baseText} ${talla}`.trim() : baseText;
		};

		const refreshStockUI = () => {
			const prodId = getSelectedProductId();
			const isReady = Array.isArray(stockCatalog) || stockUnavailableFallback;

			if (!sizeSelect) {
				const ok = isReady && hasStockForId(prodId);
				if (submitBtn) submitBtn.disabled = !ok;
				return;
			}

			const talla = String(sizeSelect.value || "").trim();
			if (!talla || !isReady) {
				if (stockMsg) {
					stockMsg.textContent = "";
					stockMsg.style.color = "";
				}
				if (submitBtn) submitBtn.disabled = true;
				return;
			}

			const available = hasStockForId(prodId);
			sizeSelect.setCustomValidity(available ? "" : "No hay existencias.");

			if (stockMsg) {
				if (available) {
					stockMsg.textContent = "Hay existencias.";
					stockMsg.style.color = "green";
				} else {
					stockMsg.textContent = "No hay existencias.";
					stockMsg.style.color = "red";
				}
			}
			if (submitBtn) submitBtn.disabled = !available;
		};

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
			const prodId = getSelectedProductId();
			if (!prodId || !hasStockForId(prodId)) {
				refreshStockUI();
				return;
			}

			const stockRow = findStockItem(prodId);
			const firstImg = document.querySelector("[data-carrusel-wrapper] img, .div3 img, .div2 img");
			const fallbackImg = firstImg ? firstImg.getAttribute("src") || "" : "";

			let addQty = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;
			if (addQty < 1) addQty = 1;
			if (addQty > MAX_QTY) addQty = MAX_QTY;

			const items = loadCart();
			const existing = items.find((it) => String(it.id) === String(prodId));

			const itemData = {
				id: stockRow ? stockRow.id : prodId,
				nombre: getDisplayName(stockRow),
				precio: stockRow ? parsePrice(stockRow.precio) : 0,
				url: stockRow && stockRow.url ? stockRow.url : window.location.pathname,
				imagen: stockRow && stockRow.imagen ? stockRow.imagen : fallbackImg,
				hay_existencias: true,
				qty: addQty
			};

			if (existing) {
				existing.qty = Math.min(MAX_QTY, existing.qty + addQty);
				existing.nombre = itemData.nombre;
				existing.precio = itemData.precio;
				if (itemData.imagen) existing.imagen = itemData.imagen;
				if (itemData.url) existing.url = itemData.url;
				existing.hay_existencias = true;
			} else {
				items.push(itemData);
			}

			saveCart(items);
		});

		stockListeners.add(refreshStockUI);
		refreshStockUI();
	};

	// --- PÁGINA DE CARRITO (/carrito o carrito.html) ---
	const initCartPage = () => {
		const path = window.location.pathname.replace(/\/+$/, "");
		const isCartPath = path === "/carrito" || path.endsWith("/carrito.html");
		if (!isCartPath) return;

		const table = document.querySelector("main table");
		if (!table) return;

		const tbody = table.querySelector("tbody") || table;
		const templateRow =
			tbody.querySelector("tr:not(thead tr):not(tfoot tr)") ||
			table.querySelector("tr:not(thead tr):not(tfoot tr)");
		if (!templateRow) return;

		const rowTemplateClone = templateRow.cloneNode(true);
		Array.from(tbody.querySelectorAll("tr")).forEach((tr) => tr.remove());

		const tfoot = table.querySelector("tfoot");
		const buttons = tfoot ? Array.from(tfoot.querySelectorAll("button")) : [];
		const undoBtn = buttons.find((b) => /deshacer/i.test(b.textContent || "")) || buttons[0] || null;
		const redoBtn = buttons.find((b) => /rehacer/i.test(b.textContent || "")) || buttons[1] || null;

		const totalHeading = document.querySelector("main .section1 h4");
		let totalAmountEl = totalHeading
			? totalHeading.querySelector("[data-carrito-subtotal-display]")
			: null;
		if (totalHeading && !totalAmountEl) {
			totalAmountEl = document.createElement("span");
			totalAmountEl.setAttribute("data-carrito-subtotal-display", "1");
			totalAmountEl.style.marginLeft = "8px";
			totalHeading.appendChild(totalAmountEl);
		}

		const history = [loadCart()];
		let historyIndex = 0;

		const syncHistoryButtons = () => {
			if (undoBtn) undoBtn.disabled = historyIndex <= 0;
			if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
		};

		const commitState = (nextItems, recordHistory = true) => {
			const saved = saveCart(nextItems);
			if (recordHistory) {
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

				const priceTd = tr.querySelector('td[data-label*="Precio"]') || tds[3] || null;
				const subtotalTd = tr.querySelector('td[data-label*="Subtotal"]') || tds[5] || null;

				const priceP = priceTd ? priceTd.querySelector("p") || priceTd : pEls[1];
				const subtotalP = subtotalTd ? subtotalTd.querySelector("p") || subtotalTd : pEls[2];

				if (imgEl) {
					imgEl.src = item.imagen || "";
					imgEl.alt = item.nombre;
				}

				if (linkEl) {
					linkEl.textContent = item.nombre;
					if (item.url) linkEl.href = item.url;
				} else if (pEls[0]) {
					pEls[0].textContent = item.nombre;
				}

				if (priceP) {
					priceP.textContent = formatEur(item.precio);
				}

				if (qtyInput) {
					qtyInput.min = "0";
					qtyInput.max = String(MAX_QTY);
					qtyInput.value = String(item.qty);

					qtyInput.addEventListener("change", () => {
						const newQty = clampQty(qtyInput.value);
						const current = loadCart();
						const updated = current
							.map((it) => (String(it.id) === String(item.id) ? { ...it, qty: newQty } : it))
							.filter((it) => it.qty > 0);
						commitState(updated, true);
					});
				}

				if (subtotalP) {
					subtotalP.textContent = formatEur(item.precio * item.qty);
				}

				if (removeBtn) {
					removeBtn.addEventListener("click", () => {
						const current = loadCart();
						const updated = current.filter((it) => String(it.id) !== String(item.id));
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

		stockListeners.add(() => {
			const latest = loadCart();
			renderTable(latest);
			syncHistoryButtons();
		});

		renderTable(loadCart());
		syncHistoryButtons();
	};

	// --- PÁGINA DE FINALIZAR COMPRA (/finalizar-compra o finalizar-compra.html) ---
	const initCheckoutSummary = () => {
		const path = window.location.pathname.replace(/\/+$/, "");
		const isCheckoutPath =
			path === "/finalizar-compra" || path.endsWith("/finalizar-compra.html");
		if (!isCheckoutPath) return;

		const summaryBox = document.querySelector("#div1 table tbody");
		if (!summaryBox) return;

		const rows = Array.from(summaryBox.querySelectorAll("tr"));
		if (rows.length < 4) return;

		const itemTemplateRow = rows[0].cloneNode(true);
		const subtotalRow = rows[rows.length - 3];
		const shippingRow = rows[rows.length - 2];
		const totalRow = rows[rows.length - 1];
		const staticTailRows = [subtotalRow, shippingRow, totalRow];

		const renderSummary = () => {
			Array.from(summaryBox.querySelectorAll("tr")).forEach((tr) => {
				if (!staticTailRows.includes(tr)) tr.remove();
			});

			const items = loadCart();
			const subtotal = getCartTotal(items);
			const shipping = items.length > 0 ? SHIPPING_EUR : 0;
			const total = subtotal + shipping;

			items.forEach((item) => {
				const tr = itemTemplateRow.cloneNode(true);
				const tds = tr.querySelectorAll("td");
				const nameP = tds[0] ? tds[0].querySelector("p") || tds[0] : null;
				const lineSubP = tds[1] ? tds[1].querySelector("p") || tds[1] : null;

				if (nameP) {
					nameP.innerHTML = "";
					nameP.appendChild(document.createTextNode(item.nombre));
					nameP.appendChild(document.createElement("br"));
					nameP.appendChild(document.createTextNode(`x${item.qty}`));
				}
				if (lineSubP) {
					lineSubP.textContent = formatEur(item.precio * item.qty);
				}

				summaryBox.insertBefore(tr, subtotalRow);
			});

			const subtotalValueEl =
				subtotalRow.querySelector("td:last-child p") || subtotalRow.querySelector("td:last-child");
			if (subtotalValueEl) subtotalValueEl.textContent = formatEur(subtotal);

			const shippingValueEl =
				shippingRow.querySelector("td:last-child em, td:last-child p") ||
				shippingRow.querySelector("td:last-child");
			if (shippingValueEl) {
				shippingValueEl.textContent =
					items.length > 0 ? `Estándar: ${formatEur(SHIPPING_EUR)}` : formatEur(0);
			}

			const vatIncluded = total - total / (1 + VAT_RATE);
			const totalValueEl =
				totalRow.querySelector("td:last-child p") || totalRow.querySelector("td:last-child");
			if (totalValueEl) {
				totalValueEl.innerHTML = "";
				totalValueEl.appendChild(document.createTextNode(`${formatEur(total)} `));
				const small = document.createElement("small");
				small.textContent = `(incluye ${formatEur(vatIncluded)} IVA)`;
				totalValueEl.appendChild(small);
			}
		};

		stockListeners.add(renderSummary);
		renderSummary();
	};

	const init = () => {
		updateNavbarTotal();
		window.matchMedia(MOBILE_NAV_QUERY).addEventListener("change", () => {
			updateNavbarTotal();
		});
		initProductPage();
		initCartPage();
		initCheckoutSummary();
		fetchStock();
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
