// Metro config extending the Expo default so the bundler treats ONNX model
// files as static assets. The wake-word engine loads three .onnx models
// (melspectrogram, embedding, and the custom "Hey Bex" classifier) from
// src/m-res-assistant/models via require(); without onnx in assetExts metro
// would try to parse them as source and the require() would fail.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Bundle ONNX classifier/feature models as assets.
config.resolver.assetExts.push("onnx");

module.exports = config;
