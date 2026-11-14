const bbox = (process.env.DISPATCH_BBOX ?? "-84.13,42.07,-83.54,42.43").split(",").map(Number) as [number, number, number, number];

export const config = {
  port: Number(process.env.PORT ?? 8787),
  toolSecret: process.env.TOOL_SECRET ?? "",
  geminiKey: process.env.GEMINI_API_KEY ?? "",
  firmsKey: process.env.FIRMS_MAP_KEY ?? "",
  classifierUrl: process.env.CLASSIFIER_URL ?? "",
  mongoUri: process.env.MONGODB_URI ?? "",
  /** west, south, east, north */
  dispatchBbox: bbox,
};
