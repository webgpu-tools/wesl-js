import wgsl_test::{expectWithin, expectWithinVec2, expectWithinVec3, expectWithinVec4};

@buffer var<storage, read_write> bits: array<u32, 1>;

@test fn nanAssertions() {
  bits[0] = 0x7fc00000u;
  let nanValue = bitcast<f32>(bits[0]);
  expectWithin(nanValue, 1.0, 0.0, 0.0);
  expectWithin(1.0, nanValue, 0.0, 0.0);
  expectWithinVec2(vec2f(1.0, nanValue), vec2f(1.0), 0.0, 0.0);
  expectWithinVec2(vec2f(1.0), vec2f(1.0, nanValue), 0.0, 0.0);
  expectWithinVec3(vec3f(1.0, 1.0, nanValue), vec3f(1.0), 0.0, 0.0);
  expectWithinVec3(vec3f(1.0), vec3f(1.0, 1.0, nanValue), 0.0, 0.0);
  expectWithinVec4(vec4f(1.0, 1.0, 1.0, nanValue), vec4f(1.0), 0.0, 0.0);
  expectWithinVec4(vec4f(1.0), vec4f(1.0, 1.0, 1.0, nanValue), 0.0, 0.0);
}
