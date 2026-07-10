import package::TestResult::testResult;

const relTol: f32 = 1e-3;
const absTol: f32 = 1e-6;

// Record an assertion failure. actual/expected keep the values from the
// first failing assertion; failCount counts every failure.
fn recordFailure(actual: vec4f, expected: vec4f) {
  testResult.passed = 0u;
  if (testResult.failCount == 0u) {
    testResult.actual = actual;
    testResult.expected = expected;
  }
  testResult.failCount += 1u;
}

fn expect(condition: bool) {
  if (!condition) {
    // no values to report; -999 matches the unwritten-slot sentinel
    recordFailure(vec4f(-999.0), vec4f(-999.0));
  }
}

fn expectEq(actual: u32, expected: u32) {
  if (actual != expected) {
    recordFailure(vec4f(f32(actual), 0.0, 0.0, 0.0), vec4f(f32(expected), 0.0, 0.0, 0.0));
  }
}

fn expectWithin(actual: f32, expected: f32, relTol: f32, absTol: f32) {
  let diff = abs(actual - expected);
  let tolerance = max(absTol, relTol * max(abs(actual), abs(expected)));
  if (diff > tolerance) {
    recordFailure(vec4f(actual, 0.0, 0.0, 0.0), vec4f(expected, 0.0, 0.0, 0.0));
  }
}

fn expectNear(actual: f32, expected: f32) {
  expectWithin(actual, expected, relTol, absTol);
}

fn expectWithinVec2(actual: vec2f, expected: vec2f, relTol: f32, absTol: f32) {
  let diff = abs(actual - expected);
  let tolerance = max(vec2f(absTol), relTol * max(abs(actual), abs(expected)));
  if (any(diff > tolerance)) {
    recordFailure(vec4f(actual, 0.0, 0.0), vec4f(expected, 0.0, 0.0));
  }
}

fn expectNearVec2(actual: vec2f, expected: vec2f) {
  expectWithinVec2(actual, expected, relTol, absTol);
}

fn expectWithinVec3(actual: vec3f, expected: vec3f, relTol: f32, absTol: f32) {
  let diff = abs(actual - expected);
  let tolerance = max(vec3f(absTol), relTol * max(abs(actual), abs(expected)));
  if (any(diff > tolerance)) {
    recordFailure(vec4f(actual, 0.0), vec4f(expected, 0.0));
  }
}

fn expectNearVec3(actual: vec3f, expected: vec3f) {
  expectWithinVec3(actual, expected, relTol, absTol);
}

fn expectWithinVec4(actual: vec4f, expected: vec4f, relTol: f32, absTol: f32) {
  let diff = abs(actual - expected);
  let tolerance = max(vec4f(absTol), relTol * max(abs(actual), abs(expected)));
  if (any(diff > tolerance)) {
    recordFailure(actual, expected);
  }
}

fn expectNearVec4(actual: vec4f, expected: vec4f) {
  expectWithinVec4(actual, expected, relTol, absTol);
}

// ULP (Units in Last Place) comparison - measures how many representable floats apart
fn ulpDiff(actual: f32, expected: f32) -> u32 {
  let aBits = bitcast<i32>(actual);
  let bBits = bitcast<i32>(expected);
  return u32(abs(aBits - bBits));
}

fn expectUlp(actual: f32, expected: f32, maxUlp: u32) {
  if (actual == expected) { return; }  // handles +0 == -0, exact match
  let diff = ulpDiff(actual, expected);
  if (diff > maxUlp) {
    recordFailure(vec4f(actual, 0.0, 0.0, 0.0), vec4f(expected, 0.0, 0.0, 0.0));
  }
}

fn expectUlpVec2(actual: vec2f, expected: vec2f, maxUlp: u32) {
  if (all(actual == expected)) { return; }
  let d0 = ulpDiff(actual.x, expected.x);
  let d1 = ulpDiff(actual.y, expected.y);
  if (d0 > maxUlp || d1 > maxUlp) {
    recordFailure(vec4f(actual, 0.0, 0.0), vec4f(expected, 0.0, 0.0));
  }
}

fn expectUlpVec3(actual: vec3f, expected: vec3f, maxUlp: u32) {
  if (all(actual == expected)) { return; }
  let d0 = ulpDiff(actual.x, expected.x);
  let d1 = ulpDiff(actual.y, expected.y);
  let d2 = ulpDiff(actual.z, expected.z);
  if (d0 > maxUlp || d1 > maxUlp || d2 > maxUlp) {
    recordFailure(vec4f(actual, 0.0), vec4f(expected, 0.0));
  }
}

fn expectUlpVec4(actual: vec4f, expected: vec4f, maxUlp: u32) {
  if (all(actual == expected)) { return; }
  let d0 = ulpDiff(actual.x, expected.x);
  let d1 = ulpDiff(actual.y, expected.y);
  let d2 = ulpDiff(actual.z, expected.z);
  let d3 = ulpDiff(actual.w, expected.w);
  if (d0 > maxUlp || d1 > maxUlp || d2 > maxUlp || d3 > maxUlp) {
    recordFailure(actual, expected);
  }
}
