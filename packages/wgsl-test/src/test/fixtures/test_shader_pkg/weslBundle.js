export const weslBundle = {
  name: "test_shader_pkg",
  edition: "2026_pre",
  modules: {
    utils: `fn helper() -> u32 {
  return 43u;
}
`,
    math: `fn compute() -> u32 {
  return 59u;
}
`,
  },
};

export default weslBundle;
