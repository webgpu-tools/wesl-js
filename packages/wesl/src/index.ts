// The browser surface: everything in "wesl/core", plus the WebGPU layer.
// Importing this requires WebGPU types (DOM lib, or @webgpu/types).
export * from "./core.ts";
export * from "./gpu/ShaderModule.ts";
export * from "./gpu/WeslDevice.ts";
