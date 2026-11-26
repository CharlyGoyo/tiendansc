(() => {
	"use strict";

	const STORAGE_KEY = "carrito";
	const MAX_QTY = 10;
	const MAX_HISTORY = 10;
	const SHIPPING_EUR = 5;
	const STOCK_ENDPOINT = "/stock";
	const MOBILE_NAV_QUERY = "(max-width: 499.98px)";
	const VAT_RATE = 0.21;
	const CALENDAR_ID = 33;
	const FREE_SHIPPING_QTY = 8;

	let stockCatalog = null; // Array de objetos de /stock: { id, nombre, precio, url, imagen, existencias }
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

	const parseStockQty = (val) => {
		const n = Number(val);
		if (!Number.isFinite(n) || n <= 0) return 0;
		return Math.floor(n);
	};

	const clampQty = (val, maxAllowed = MAX_QTY) => {
		const upper = Math.max(0, Math.min(MAX_QTY, parseStockQty(maxAllowed)));
		const n = parseInt(val, 10);
		if (!Number.isFinite(n) || n < 0) return 0;
		return Math.min(upper, n);
	};

	const normalizeCartItem = (item) => {
		if (!item || item.id === undefined || item.id === null || item.id === "") return null;
		const existencias = parseStockQty(item.existencias);
		const qty = clampQty(item.qty, existencias > 0 ? existencias : MAX_QTY);
		if (qty <= 0) return null;
		return {
			id: Number.isFinite(Number(item.id)) && String(item.id).trim() !== "" ? Number(item.id) : String(item.id),
			nombre: String(item.nombre || ""),
			precio: parsePrice(item.precio),
			url: String(item.url || ""),
			imagen: String(item.imagen || ""),
			existencias,
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

	const getStockForId = (id) => {
		if (stockUnavailableFallback) return 0;
		const row = findStockItem(id);
		return row ? parseStockQty(row.existencias) : 0;
	};

	const getMaxSelectableQty = (id) => {
		if (stockUnavailableFallback || !Array.isArray(stockCatalog)) return 0;
		return Math.min(MAX_QTY, getStockForId(id));
	};

	// Ajusta o elimina del carrito los ítems según el stock actual devuelto por /stock
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
			const stockDisponible = row ? parseStockQty(row.existencias) : 0;
			if (!row || stockDisponible <= 0) {
				changed = true;
				return acc;
			}
			const clampedQty = Math.min(item.qty, stockDisponible, MAX_QTY);
			if (clampedQty <= 0) {
				changed = true;
				return acc;
			}
			const synced = {
				...item,
				nombre: row.nombre ?? item.nombre,
				precio: parsePrice(row.precio ?? item.precio),
				url: row.url ?? item.url,
				imagen: row.imagen ?? item.imagen,
				existencias: stockDisponible,
				qty: clampedQty
			};
			if (
				synced.nombre !== item.nombre ||
				synced.precio !== item.precio ||
				synced.url !== item.url ||
				synced.imagen !== item.imagen ||
				synced.existencias !== item.existencias ||
				synced.qty !== item.qty
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
			qtyInput.setAttribute("min", "0");
			qtyInput.setAttribute("max", "0");
			qtyInput.value = "0";
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

		const syncQtyInputBounds = (maxQty) => {
			if (!qtyInput) return;
			const safeMax = Math.max(0, Math.min(MAX_QTY, parseStockQty(maxQty)));
			qtyInput.setAttribute("min", "0");
			qtyInput.setAttribute("max", String(safeMax));

			if (safeMax <= 0) {
				qtyInput.value = "0";
				return;
			}

			const currentVal = parseInt(qtyInput.value, 10);
			if (!Number.isFinite(currentVal) || currentVal < 1) {
				qtyInput.value = "1";
			} else if (currentVal > safeMax) {
				qtyInput.value = String(safeMax);
			}
		};

		const refreshStockUI = () => {
			const prodId = getSelectedProductId();
			const isReady = Array.isArray(stockCatalog) || stockUnavailableFallback;

			if (!sizeSelect) {
				const maxQty = isReady ? getMaxSelectableQty(prodId) : 0;
				syncQtyInputBounds(maxQty);
				const ok = maxQty > 0 && (parseInt(qtyInput?.value, 10) || 0) >= 1;
				if (submitBtn) submitBtn.disabled = !ok;
				return;
			}

			const talla = String(sizeSelect.value || "").trim();
			if (!talla || !isReady) {
				sizeSelect.setCustomValidity("");
				syncQtyInputBounds(0);
				if (stockMsg) {
					stockMsg.textContent = "";
					stockMsg.style.color = "";
				}
				if (submitBtn) submitBtn.disabled = true;
				return;
			}

			const maxQty = getMaxSelectableQty(prodId);
			const available = maxQty > 0;
			sizeSelect.setCustomValidity(available ? "" : "No hay existencias.");
			syncQtyInputBounds(maxQty);

			if (stockMsg) {
				if (available) {
					stockMsg.textContent = "Hay existencias.";
					stockMsg.style.color = "green";
				} else {
					stockMsg.textContent = "No hay existencias.";
					stockMsg.style.color = "red";
				}
			}
			const chosenQty = qtyInput ? parseInt(qtyInput.value, 10) || 0 : 1;
			if (submitBtn) submitBtn.disabled = !(available && chosenQty >= 1);
		};

		if (sizeSelect) {
			sizeSelect.addEventListener("change", refreshStockUI);
		}

		if (qtyInput) {
			qtyInput.addEventListener("input", () => {
				if (qtyInput.value === "") return;
				const prodId = getSelectedProductId();
				const maxQty = Array.isArray(stockCatalog) || stockUnavailableFallback
					? getMaxSelectableQty(prodId)
					: 0;
				if (maxQty <= 0) {
					qtyInput.value = "0";
					if (submitBtn) submitBtn.disabled = true;
					return;
				}
				let val = parseInt(qtyInput.value, 10);
				if (!Number.isFinite(val) || val < 0) val = 0;
				if (val > maxQty) val = maxQty;
				qtyInput.value = String(val);
				if (submitBtn) submitBtn.disabled = val < 1;
			});

			qtyInput.addEventListener("change", () => {
				const prodId = getSelectedProductId();
				const maxQty = Array.isArray(stockCatalog) || stockUnavailableFallback
					? getMaxSelectableQty(prodId)
					: 0;
				if (maxQty <= 0) {
					qtyInput.value = "0";
					if (submitBtn) submitBtn.disabled = true;
					return;
				}
				let val = parseInt(qtyInput.value, 10);
				if (!Number.isFinite(val) || val < 0) val = 0;
				if (val > maxQty) val = maxQty;
				qtyInput.value = String(val);
				if (submitBtn) submitBtn.disabled = val < 1;
			});
		}

		form.addEventListener("submit", (e) => {
			e.preventDefault();
			const prodId = getSelectedProductId();
			const maxQty = getMaxSelectableQty(prodId);
			if (!prodId || maxQty <= 0) {
				refreshStockUI();
				return;
			}

			const addQty = qtyInput ? clampQty(qtyInput.value, maxQty) : 1;
			if (addQty < 1) {
				refreshStockUI();
				return;
			}

			const stockRow = findStockItem(prodId);
			const firstImg = document.querySelector("[data-carrusel-wrapper] img, .div3 img, .div2 img");
			const fallbackImg = firstImg ? firstImg.getAttribute("src") || "" : "";

			const items = loadCart();
			const existing = items.find((it) => String(it.id) === String(prodId));

			const itemData = {
				id: stockRow ? stockRow.id : prodId,
				nombre: getDisplayName(stockRow),
				precio: stockRow ? parsePrice(stockRow.precio) : 0,
				url: stockRow && stockRow.url ? stockRow.url : window.location.pathname,
				imagen: stockRow && stockRow.imagen ? stockRow.imagen : fallbackImg,
				existencias: maxQty,
				qty: addQty
			};

			if (existing) {
				existing.qty = Math.min(maxQty, existing.qty + addQty);
				existing.nombre = itemData.nombre;
				existing.precio = itemData.precio;
				if (itemData.imagen) existing.imagen = itemData.imagen;
				if (itemData.url) existing.url = itemData.url;
				existing.existencias = maxQty;
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

				const envioEl = document.querySelector("[data-envio]");

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
					const maxItemQty = Array.isArray(stockCatalog)
						? Math.min(MAX_QTY, getStockForId(item.id))
						: Math.min(MAX_QTY, parseStockQty(item.existencias) || MAX_QTY);
					qtyInput.min = "0";
					qtyInput.max = String(maxItemQty);
					qtyInput.value = String(Math.min(item.qty, maxItemQty));

					qtyInput.addEventListener("change", () => {
						const newQty = clampQty(qtyInput.value, maxItemQty);
						const current = loadCart();
						const updated = current
							.map((it) => (String(it.id) === String(item.id) ? { ...it, qty: newQty } : it))
							.filter((it) => it.qty > 0);
						commitState(updated, true);
					});
					if (envioEl) {
						const calQty = items
							.filter((it) => Number(it.id) === CALENDAR_ID)
							.reduce((acc, it) => acc + (parseInt(it.qty, 10) || 0), 0);
						envioEl.textContent = calQty >= FREE_SHIPPING_QTY ? "Envío gratuito" : "Envío: 5€";
					}

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
			const calendarQty = items
				.filter((it) => Number(it.id) === CALENDAR_ID)
				.reduce((acc, it) => acc + (parseInt(it.qty, 10) || 0), 0);
			const freeShipping = calendarQty >= FREE_SHIPPING_QTY;
			const shipping = items.length > 0 ? (freeShipping ? 0 : SHIPPING_EUR) : 0;
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
					items.length > 0
					? freeShipping
					? "Envío gratuito"
					: `Estándar: ${formatEur(SHIPPING_EUR)}`
					: formatEur(0);
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
