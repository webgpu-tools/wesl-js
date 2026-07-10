import wgsl_test::{ expect, expectEq };

// Passes: no failures recorded.
@test fn allGood() {
  expect(true);
  expectEq(2u, 2u);
}

// One failing assertion: failCount == 1, so the message shows only
// actual/expected (no "first of N" line).
@test fn oneFailure() {
  expectEq(1u, 2u);
}

// Three failing assertions in a single test: failCount == 3. actual/expected
// report the FIRST failure, and the message appends "(first of 3 failed assertions)".
@test fn manyFailures() {
  expectEq(10u, 11u);
  expectEq(20u, 22u);
  expect(false);
}
