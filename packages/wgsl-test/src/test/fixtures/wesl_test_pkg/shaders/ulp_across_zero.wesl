import wgsl_test::expectUlp;

// 1.5e-38 and -1.2e-38 are ~19.3M representable floats apart, but their
// bit patterns differ by ~2^31. ulpDiff must count floats, not bit distance.

@test fn ulpAcrossZeroWithin() {
  expectUlp(1.5e-38, -1.2e-38, 20000000u);
}

@test fn ulpAcrossZeroTooFar() {
  expectUlp(1.5e-38, -1.2e-38, 1000000u);
}
