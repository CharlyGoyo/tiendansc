CREATE TABLE IF NOT EXISTS stock (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	nombre TEXT NOT NULL,
	precio REAL NOT NULL DEFAULT 0.0,
	url TEXT,
	imagen TEXT,
	existencias INTEGER NOT NULL DEFAULT 0,
	CHECK (precio >= 0),
	CHECK (existencias >= 0)
	);
