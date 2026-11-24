export async function onRequestGet(context) {
  try {
    const { results } = await context.env.DB
      .prepare("SELECT id, nombre, precio, url, imagen, existencias FROM stock")
      .all();

    return Response.json(results);
  } catch (err) {
    return Response.json(
      { error: "Error consultando stock", detalle: err.message },
      { status: 500 }
    );
  }
}
