export async function onRequestGet(context) {
  try {
    const { results } = await context.env.DB
      .prepare("SELECT id, nombre, precio, url, imagen, existencias FROM stock")
      .all();

    const data = results.map(({ existencias, ...rest }) => ({
      ...rest,
      hay_existencias: existencias > 0,
    }));

    return Response.json(data);
  } catch (err) {
    return Response.json(
      { error: "Error consultando stock", detalle: err.message },
      { status: 500 }
    );
  }
}
