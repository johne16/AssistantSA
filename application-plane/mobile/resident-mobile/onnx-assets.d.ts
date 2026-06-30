// ONNX model files are bundled as static assets (see metro.config.js). require()
// of one resolves to a metro asset module id, the same shape as an image asset.
declare module "*.onnx" {
  const asset: number;
  export = asset;
}
