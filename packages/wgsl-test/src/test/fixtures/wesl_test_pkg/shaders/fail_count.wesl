import wgsl_test::{expectEq, expectNear};

@test fn countsEveryFailure() {
  expectNear(1.0, 5.0); // fail 1; these values are reported
  expectEq(2u, 3u);     // fail 2
  expectNear(7.0, 7.0); // pass
  expectNear(4.0, 9.0); // fail 3
}
